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
