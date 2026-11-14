import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

/** Points CERBER_DATA_DIR at a fresh temporary folder for each test – never the real ~/.cerber. */
export function withTempDataDir(): () => string {
  let dir = "";
  const before = process.env.CERBER_DATA_DIR;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cerber-test-"));
    process.env.CERBER_DATA_DIR = dir;
  });
  afterEach(() => {
    if (before === undefined) delete process.env.CERBER_DATA_DIR;
    else process.env.CERBER_DATA_DIR = before;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return () => dir;
}

/** A one-page PDF with a text layer. */
export function samplePdf(text: string): Uint8Array {
  const content = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf +=
    `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

/**
 * A minimal Outlook .msg (MS-CFB v3, 512-byte sectors) for tests: streams under the cutoff go to the
 * mini stream, bigger ones to regular sectors, so both paths of the reader are exercised.
 */
export function sampleMsg(m: {
  subject?: string;
  body?: string;
  html?: string;
  fromName?: string;
  fromEmail?: string;
  to?: string;
  date?: string;
  recipients?: { name: string; email: string; type: 1 | 2 }[];
  attachments?: { name: string; data: Uint8Array; contentId?: string }[];
}): Uint8Array {
  type Node = { name: string; data?: Uint8Array; children?: Node[] };
  const utf16 = (s: string) => {
    const b = new Uint8Array(s.length * 2 + 2);
    for (let i = 0; i < s.length; i++) new DataView(b.buffer).setUint16(i * 2, s.charCodeAt(i), true);
    return b;
  };
  const hex = (id: number) => id.toString(16).toUpperCase().padStart(4, "0");
  const str = (id: number, s?: string): Node[] => (s === undefined ? [] : [{ name: `__substg1.0_${hex(id)}001F`, data: utf16(s) }]);
  const props = (header: number, entries: { tag: number; value: (v: DataView) => void }[]): Node => {
    const b = new Uint8Array(header + entries.length * 16);
    entries.forEach((e, i) => {
      new DataView(b.buffer).setUint32(header + i * 16, e.tag, true);
      e.value(new DataView(b.buffer, header + i * 16 + 8, 8));
    });
    return { name: "__properties_version1.0", data: b };
  };
  const filetime = (iso: string) => (BigInt(Date.parse(iso)) + 11_644_473_600_000n) * 10_000n;
  const root: Node[] = [
    ...str(0x0037, m.subject),
    ...str(0x1000, m.body),
    ...str(0x0c1a, m.fromName),
    ...str(0x0c1f, m.fromEmail),
    ...str(0x0e04, m.to),
    ...(m.html ? [{ name: "__substg1.0_10130102", data: new TextEncoder().encode(m.html) }] : []),
    props(32, m.date ? [{ tag: 0x00390040, value: (v) => v.setBigUint64(0, filetime(m.date!), true) }] : []),
  ];
  (m.recipients ?? []).forEach((r, i) =>
    root.push({
      name: `__recip_version1.0_#${String(i).padStart(8, "0")}`,
      children: [...str(0x3001, r.name), ...str(0x39fe, r.email), props(8, [{ tag: 0x0c150003, value: (v) => v.setUint32(0, r.type, true) }])],
    }),
  );
  (m.attachments ?? []).forEach((a, i) =>
    root.push({
      name: `__attach_version1.0_#${String(i).padStart(8, "0")}`,
      children: [...str(0x3707, a.name), ...str(0x3712, a.contentId), { name: "__substg1.0_37010102", data: a.data }, props(8, [])],
    }),
  );

  // Directory: the root first, then every node breadth-first; siblings chained through "right".
  type Entry = { node: Node; type: number; child: number; right: number; start: number; size: number };
  const entries: Entry[] = [{ node: { name: "Root Entry", children: root }, type: 5, child: -1, right: -1, start: -2, size: 0 }];
  for (let i = 0; i < entries.length; i++) {
    let prev = -1;
    for (const k of entries[i].node.children ?? []) {
      const idx = entries.push({ node: k, type: k.children ? 1 : 2, child: -1, right: -1, start: -2, size: k.data?.byteLength ?? 0 }) - 1;
      if (prev < 0) entries[i].child = idx;
      else entries[prev].right = idx;
      prev = idx;
    }
  }

  const SECT = 512;
  const MINI = 64;
  const CUTOFF = 4096;
  const miniFat: number[] = [];
  const miniParts: Uint8Array[] = [];
  for (const e of entries) {
    if (e.type !== 2 || e.size >= CUTOFF) continue;
    const n = Math.max(1, Math.ceil(e.size / MINI));
    e.start = miniFat.length;
    for (let j = 0; j < n; j++) miniFat.push(j === n - 1 ? -2 : miniFat.length + 1);
    const b = new Uint8Array(n * MINI);
    b.set(e.node.data!);
    miniParts.push(b);
  }
  const mini = new Uint8Array(miniParts.reduce((s, p) => s + p.byteLength, 0));
  let mo = 0;
  for (const p of miniParts) {
    mini.set(p, mo);
    mo += p.byteLength;
  }

  // Regular sectors: FAT first, then directory, mini FAT, mini stream and the big streams.
  const bigs = entries.filter((e) => e.type === 2 && e.size >= CUTOFF);
  const counts = {
    dir: Math.ceil(entries.length / 4),
    miniFat: Math.ceil((miniFat.length * 4) / SECT),
    mini: Math.ceil(mini.byteLength / SECT),
    big: bigs.reduce((s, e) => s + Math.ceil(e.size / SECT), 0),
  };
  const rest = counts.dir + counts.miniFat + counts.mini + counts.big;
  let fatSectors = 1;
  while (fatSectors * 128 < fatSectors + rest) fatSectors++;
  const fat = new Array<number>(fatSectors * 128).fill(-1);
  for (let i = 0; i < fatSectors; i++) fat[i] = -3;
  let next = fatSectors;
  const alloc = (n: number) => {
    if (!n) return -2;
    const start = next;
    for (let j = 0; j < n; j++) fat[next + j] = j === n - 1 ? -2 : next + j + 1;
    next += n;
    return start;
  };
  const dirStart = alloc(counts.dir);
  const miniFatStart = alloc(counts.miniFat);
  entries[0].start = alloc(counts.mini);
  entries[0].size = mini.byteLength;
  for (const e of bigs) e.start = alloc(Math.ceil(e.size / SECT));

  const out = new Uint8Array(SECT * (1 + fatSectors + rest));
  const v = new DataView(out.buffer);
  const u32 = (o: number, x: number) => v.setUint32(o, x >>> 0, true);
  const at = (sector: number) => SECT * (sector + 1);
  out.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  v.setUint16(24, 0x3e, true);
  v.setUint16(26, 3, true);
  v.setUint16(28, 0xfffe, true);
  v.setUint16(30, 9, true);
  v.setUint16(32, 6, true);
  u32(44, fatSectors);
  u32(48, dirStart);
  u32(56, CUTOFF);
  u32(60, miniFatStart);
  u32(64, counts.miniFat);
  u32(68, -2);
  for (let i = 0; i < 109; i++) u32(76 + i * 4, i < fatSectors ? i : -1);
  fat.forEach((x, i) => u32(at(0) + i * 4, x));
  entries.forEach((e, i) => {
    const o = at(dirStart) + i * 128;
    const name = utf16(e.node.name);
    out.set(name, o);
    v.setUint16(o + 64, name.byteLength, true);
    out[o + 66] = e.type;
    out[o + 67] = 1;
    u32(o + 68, -1);
    u32(o + 72, e.right);
    u32(o + 76, e.child);
    u32(o + 116, e.start);
    u32(o + 120, e.size);
  });
  miniFat.forEach((x, i) => u32(at(miniFatStart) + i * 4, x));
  if (mini.byteLength) out.set(mini, at(entries[0].start));
  for (const e of bigs) out.set(e.node.data!, at(e.start));
  return out;
}
