/**
 * Outlook .msg e-mails (most letters to the cooperative go out as e-mail and get saved this way).
 * A .msg is an OLE compound file (MS-CFB) holding MAPI properties (MS-OXMSG); this reads the few
 * that matter – sender, recipients, date, subject, body and attachments – without a dependency.
 */

const FREE = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;

interface DirEntry {
  name: string;
  type: number; // 1 storage, 2 stream, 5 root
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
}

/** A minimal MS-CFB reader: streams by path ("__attach_version1.0_#00000000/__substg1.0_37010102"). */
export class CompoundFile {
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly cutoff: number;
  private readonly fat: number[] = [];
  private readonly miniFat: number[] = [];
  private readonly entries: DirEntry[] = [];
  private readonly miniStream: Uint8Array;

  constructor(private readonly data: Uint8Array) {
    const sig = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    if (data.byteLength < 512 || sig.some((b, i) => data[i] !== b)) throw new Error("To nie jest plik Outlooka (.msg).");
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const u16 = (o: number) => this.view.getUint16(o, true);
    const u32 = (o: number) => this.view.getUint32(o, true);
    this.sectorSize = 1 << u16(30);
    this.miniSectorSize = 1 << u16(32);
    this.cutoff = u32(56);

    // FAT sectors: the first 109 are listed in the header, the rest in the DIFAT chain.
    const fatSectors: number[] = [];
    for (let i = 0; i < 109; i++) fatSectors.push(u32(76 + i * 4));
    let difat = u32(68);
    const perSector = this.sectorSize / 4;
    for (let guard = 0; difat !== END_OF_CHAIN && difat !== FREE && guard < 1_000_000; guard++) {
      const off = this.offset(difat);
      for (let i = 0; i < perSector - 1; i++) fatSectors.push(u32(off + i * 4));
      difat = u32(off + (perSector - 1) * 4);
    }
    for (const s of fatSectors.slice(0, u32(44))) {
      if (s === FREE || s === END_OF_CHAIN) continue;
      const off = this.offset(s);
      for (let i = 0; i < perSector; i++) this.fat.push(u32(off + i * 4));
    }

    const dir = this.chain(u32(48));
    for (let o = 0; o + 128 <= dir.byteLength; o += 128) {
      const v = new DataView(dir.buffer, dir.byteOffset + o, 128);
      const nameLen = Math.min(64, v.getUint16(64, true));
      this.entries.push({
        name: new TextDecoder("utf-16le").decode(dir.subarray(o, o + Math.max(0, nameLen - 2))),
        type: v.getUint8(66),
        left: v.getUint32(68, true),
        right: v.getUint32(72, true),
        child: v.getUint32(76, true),
        start: v.getUint32(116, true),
        size: v.getUint32(120, true),
      });
    }
    const root = this.entries[0];
    if (!root || root.type !== 5) throw new Error("Uszkodzony plik .msg (brak katalogu głównego).");
    const mf = this.chain(u32(60));
    for (let o = 0; o + 4 <= mf.byteLength; o += 4) this.miniFat.push(new DataView(mf.buffer, mf.byteOffset + o, 4).getUint32(0, true));
    this.miniStream = this.chain(root.start).subarray(0, root.size);
  }

  private offset(sector: number): number {
    const off = (sector + 1) * this.sectorSize;
    if (off + this.sectorSize > this.data.byteLength) throw new Error("Uszkodzony plik .msg (sektor poza plikiem).");
    return off;
  }

  private chain(start: number): Uint8Array {
    const parts: Uint8Array[] = [];
    const seen = new Set<number>();
    for (let s = start; s !== END_OF_CHAIN && s !== FREE; s = this.fat[s] ?? END_OF_CHAIN) {
      if (seen.has(s)) throw new Error("Uszkodzony plik .msg (pętla w łańcuchu sektorów).");
      seen.add(s);
      const off = this.offset(s);
      parts.push(this.data.subarray(off, off + this.sectorSize));
    }
    return concat(parts);
  }

  private miniChain(start: number, size: number): Uint8Array {
    const out = new Uint8Array(size);
    let pos = 0;
    const seen = new Set<number>();
    for (let s = start; s !== END_OF_CHAIN && s !== FREE && pos < size; s = this.miniFat[s] ?? END_OF_CHAIN) {
      if (seen.has(s)) throw new Error("Uszkodzony plik .msg (pętla w mini-łańcuchu).");
      seen.add(s);
      const chunk = this.miniStream.subarray(s * this.miniSectorSize, (s + 1) * this.miniSectorSize);
      out.set(chunk.subarray(0, size - pos), pos);
      pos += chunk.byteLength;
    }
    return out;
  }

  /** The entries directly inside a storage (entry index). */
  children(index = 0): { name: string; index: number; type: number }[] {
    const out: { name: string; index: number; type: number }[] = [];
    const walk = (i: number, depth: number) => {
      if (i === FREE || depth > 10_000) return;
      const e = this.entries[i];
      if (!e) return;
      walk(e.left, depth + 1);
      out.push({ name: e.name, index: i, type: e.type });
      walk(e.right, depth + 1);
    };
    walk(this.entries[index]?.child ?? FREE, 0);
    return out;
  }

  stream(index: number): Uint8Array {
    const e = this.entries[index];
    if (e.size < this.cutoff) return this.miniChain(e.start, e.size);
    return this.chain(e.start).subarray(0, e.size);
  }
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.byteLength;
  }
  return out;
}

export interface MsgAttachment {
  name: string;
  mime?: string;
  data?: Uint8Array;
  /** An e-mail attached inside the e-mail – listed, not opened. */
  embedded?: boolean;
  /** Has a content id: usually a picture in the body or the signature. */
  inline?: boolean;
}

export interface MsgRecipient {
  name?: string;
  email?: string;
  kind: "to" | "cc" | "bcc";
}

export interface MsgMail {
  subject?: string;
  fromName?: string;
  fromEmail?: string;
  /** ISO date-time the mail was sent (or delivered). */
  date?: string;
  to?: string;
  cc?: string;
  recipients: MsgRecipient[];
  body?: string;
  attachments: MsgAttachment[];
}

function decodeString(data: Uint8Array, type: number): string {
  if (type === 0x001f) return new TextDecoder("utf-16le").decode(data).replace(/\0+$/, "");
  try {
    return new TextDecoder("windows-1250").decode(data).replace(/\0+$/, "");
  } catch {
    return new TextDecoder().decode(data).replace(/\0+$/, "");
  }
}

/** Variable-size properties (strings, binary) of one storage, keyed by property id. */
function substgProps(cf: CompoundFile, storage: number): Map<number, { type: number; data: Uint8Array; index: number }> {
  const out = new Map<number, { type: number; data: Uint8Array; index: number }>();
  for (const ch of cf.children(storage)) {
    const m = /^__substg1\.0_([0-9A-F]{4})([0-9A-F]{4})$/i.exec(ch.name);
    if (!m) continue;
    const id = parseInt(m[1], 16);
    const type = parseInt(m[2], 16);
    out.set(id, { type, data: ch.type === 2 ? cf.stream(ch.index) : new Uint8Array(), index: ch.index });
  }
  return out;
}

/** Fixed-size properties (dates, numbers) from the __properties_version1.0 stream. */
function fixedProps(cf: CompoundFile, storage: number, headerSize: number): Map<number, DataView> {
  const out = new Map<number, DataView>();
  const ps = cf.children(storage).find((c) => c.name === "__properties_version1.0");
  if (!ps) return out;
  const data = cf.stream(ps.index);
  for (let o = headerSize; o + 16 <= data.byteLength; o += 16) {
    const v = new DataView(data.buffer, data.byteOffset + o, 16);
    out.set(v.getUint32(0, true) >>> 16, new DataView(data.buffer, data.byteOffset + o + 8, 8));
  }
  return out;
}

function fileTime(v: DataView | undefined): string | undefined {
  if (!v) return undefined;
  const ticks = v.getBigUint64(0, true);
  if (!ticks) return undefined;
  const ms = Number(ticks / 10_000n) - 11_644_473_600_000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

const ENTITIES: Record<string, string> = { nbsp: " ", lt: "<", gt: ">", quot: '"', amp: "&", apos: "'" };
/** Elements whose content is not text of the mail. */
const SKIP_CONTENT = new Set(["style", "script", "head", "title"]);
/** Elements that end a line. */
const LINE_BREAK = new Set(["br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6"]);

/**
 * The text of an HTML mail body, for Claude to read – never rendered as HTML. One pass over the
 * characters: a tag is everything from "<" to the next ">", so no part of a tag can survive, and
 * entities are decoded once, after the tags are gone.
 */
export function htmlToText(html: string): string {
  let out = "";
  let skipping: string | null = null;
  let i = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch !== "<") {
      if (!skipping) out += ch;
      i++;
      continue;
    }
    const end = html.indexOf(">", i + 1);
    if (end < 0) break; // an unclosed tag: drop the rest
    const tag = html.slice(i + 1, end).trim();
    i = end + 1;
    const closing = tag.startsWith("/");
    const name = (closing ? tag.slice(1) : tag).split(/[\s/]/, 1)[0].toLowerCase();
    if (skipping) {
      if (closing && name === skipping) skipping = null;
      continue;
    }
    if (!closing && SKIP_CONTENT.has(name) && !tag.endsWith("/")) skipping = name;
    else if (LINE_BREAK.has(name) && (closing || name === "br")) out += "\n";
  }
  return out
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] !== "#") return ENTITIES[e.toLowerCase()] ?? m;
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const P = {
  subject: 0x0037,
  submitTime: 0x0039,
  senderName: 0x0c1a,
  senderEmail: 0x0c1f,
  senderSmtp: 0x5d01,
  displayCc: 0x0e03,
  displayTo: 0x0e04,
  deliveryTime: 0x0e06,
  body: 0x1000,
  html: 0x1013,
  recipType: 0x0c15,
  displayName: 0x3001,
  emailAddress: 0x3003,
  smtpAddress: 0x39fe,
  attachData: 0x3701,
  attachShortName: 0x3704,
  attachLongName: 0x3707,
  attachMime: 0x370e,
  attachContentId: 0x3712,
};

export function parseMsg(data: Uint8Array): MsgMail {
  const cf = new CompoundFile(data);
  const props = substgProps(cf, 0);
  const fixed = fixedProps(cf, 0, 32);
  const str = (m: typeof props, id: number) => {
    const p = m.get(id);
    return p && (p.type === 0x001f || p.type === 0x001e) ? decodeString(p.data, p.type).trim() || undefined : undefined;
  };

  let body = str(props, P.body);
  if (!body) {
    const h = props.get(P.html);
    if (h) body = htmlToText(h.type === 0x0102 ? new TextDecoder().decode(h.data) : decodeString(h.data, h.type)) || undefined;
  }

  const recipients: MsgRecipient[] = [];
  const attachments: MsgAttachment[] = [];
  for (const ch of cf.children(0)) {
    if (ch.name.startsWith("__recip_version1.0_")) {
      const rp = substgProps(cf, ch.index);
      const rf = fixedProps(cf, ch.index, 8);
      const t = rf.get(P.recipType)?.getUint32(0, true);
      recipients.push({
        name: str(rp, P.displayName),
        email: str(rp, P.smtpAddress) ?? str(rp, P.emailAddress),
        kind: t === 2 ? "cc" : t === 3 ? "bcc" : "to",
      });
    } else if (ch.name.startsWith("__attach_version1.0_")) {
      const ap = substgProps(cf, ch.index);
      const raw = ap.get(P.attachData);
      const name = str(ap, P.attachLongName) ?? str(ap, P.attachShortName) ?? str(ap, P.displayName) ?? "załącznik";
      attachments.push({
        name,
        mime: str(ap, P.attachMime),
        data: raw?.type === 0x0102 ? raw.data : undefined,
        embedded: raw?.type === 0x000d || undefined,
        inline: !!str(ap, P.attachContentId) || undefined,
      });
    }
  }

  return {
    subject: str(props, P.subject),
    fromName: str(props, P.senderName),
    fromEmail: str(props, P.senderSmtp) ?? str(props, P.senderEmail),
    date: fileTime(fixed.get(P.submitTime)) ?? fileTime(fixed.get(P.deliveryTime)),
    to: str(props, P.displayTo),
    cc: str(props, P.displayCc),
    recipients,
    body,
    attachments,
  };
}

/** The mail as text for Claude: headers, body, list of attachments. */
export function msgText(m: MsgMail): string {
  const who = (kind: MsgRecipient["kind"], display?: string) => {
    const list = m.recipients.filter((r) => r.kind === kind).map((r) => (r.name && r.email && r.name !== r.email ? `${r.name} <${r.email}>` : (r.email ?? r.name)));
    return list.length ? list.join(", ") : display;
  };
  const from = m.fromName && m.fromEmail && m.fromName !== m.fromEmail ? `${m.fromName} <${m.fromEmail}>` : (m.fromEmail ?? m.fromName);
  const lines = [
    `Od: ${from ?? "(nieznany)"}`,
    `Do: ${who("to", m.to) ?? "(brak)"}`,
    ...(who("cc", m.cc) ? [`DW: ${who("cc", m.cc)}`] : []),
    `Data: ${m.date ? new Date(m.date).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }) : "(brak)"}`,
    `Temat: ${m.subject ?? "(brak)"}`,
  ];
  if (m.attachments.length)
    lines.push(
      `Załączniki: ${m.attachments
        .map((a) => `${a.name}${a.embedded ? " (załączona wiadomość)" : a.data ? ` (${Math.round(a.data.byteLength / 1024)} KB${a.inline ? ", w treści" : ""})` : ""}`)
        .join("; ")}`,
    );
  lines.push("", m.body ?? "(brak treści)");
  return lines.join("\n");
}
