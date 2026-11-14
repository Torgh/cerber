import { describe, expect, it } from "vitest";
import { sampleMsg, samplePdf } from "../testUtils";
import { CompoundFile, htmlToText, msgText, parseMsg } from "./msg";

describe("Outlook .msg", () => {
  it("reads headers, body, recipients and attachments", () => {
    const big = new Uint8Array(9000).map((_, i) => i % 251);
    const m = parseMsg(
      sampleMsg({
        subject: "Zgłoszenie – przeciek",
        body: "Szanowni Państwo,\nproszę o naprawę.",
        fromName: "Jan Kowalski",
        fromEmail: "jan@example.com",
        to: "Administracja",
        date: "2026-09-07T15:09:42Z",
        recipients: [
          { name: "Administracja", email: "adm@example.com", type: 1 },
          { name: "Zarząd", email: "zarzad@example.com", type: 2 },
        ],
        attachments: [
          { name: "pismo.pdf", data: samplePdf("Odpowiedz") },
          { name: "zdjecie.jpg", data: big },
          { name: "image001.png", data: new Uint8Array(10), contentId: "logo" },
        ],
      }),
    );
    expect(m).toMatchObject({ subject: "Zgłoszenie – przeciek", fromName: "Jan Kowalski", fromEmail: "jan@example.com", date: "2026-09-07T15:09:42.000Z" });
    expect(m.body).toContain("proszę o naprawę");
    expect(m.recipients).toEqual([
      { name: "Administracja", email: "adm@example.com", kind: "to" },
      { name: "Zarząd", email: "zarzad@example.com", kind: "cc" },
    ]);
    expect(m.attachments.map((a) => a.name)).toEqual(["pismo.pdf", "zdjecie.jpg", "image001.png"]);
    expect(m.attachments[1].data).toEqual(big); // a stream above the mini-stream cutoff
    expect(new TextDecoder().decode(m.attachments[0].data).startsWith("%PDF")).toBe(true);
    expect(m.attachments[2].inline).toBe(true);

    const t = msgText(m);
    expect(t).toContain("Od: Jan Kowalski <jan@example.com>");
    expect(t).toContain("Do: Administracja <adm@example.com>");
    expect(t).toContain("DW: Zarząd <zarzad@example.com>");
    expect(t).toContain("7.09.2026, 17:09:42");
    expect(t).toContain("zdjecie.jpg (9 KB)");
    expect(t).toContain("image001.png (0 KB, w treści)");
  });

  it("falls back to the HTML body and copes with missing headers", () => {
    const m = parseMsg(sampleMsg({ html: "<html><head><style>p{}</style></head><body><p>Dzień&nbsp;dobry</p>Linia&amp;2</body></html>" }));
    expect(m.body).toBe("Dzień dobry\nLinia&2");
    const t = msgText(m);
    expect(t).toContain("Od: (nieznany)");
    expect(t).toContain("Temat: (brak)");
    expect(msgText({ recipients: [], attachments: [] })).toContain("(brak treści)");
  });

  it("rejects other files", () => {
    expect(() => new CompoundFile(samplePdf("x"))).toThrow(".msg");
    expect(htmlToText("a<br>b &lt;c&gt; &#261;")).toBe("a\nb <c> ą");
  });
});
