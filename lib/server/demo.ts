/** Loads and removes the demo data, including a scan-like image of the cooperative's reply. */
import sharp from "sharp";
import { addDemo, demoScanLines, removeDemo } from "../demo";
import { today } from "../dates";
import type { Case, FileRef } from "../types";
import { mutate } from "./db";
import { deleteStored, storeFile } from "./files";

/** A4 at 150 dpi, slightly grey and tilted, with a received stamp – so it looks like a scan. */
async function renderScan(lines: string[]): Promise<Uint8Array> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const W = 1240;
  const H = 1754;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f3ef";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-0.006);
  ctx.translate(-W / 2, -H / 2);
  const font = 'Arial, "Liberation Sans", "DejaVu Sans", sans-serif';
  let y = 150;
  lines.forEach((line, i) => {
    ctx.fillStyle = i < 2 ? "#1f2a44" : "#262626";
    ctx.font = i === 0 ? `bold 34px ${font}` : i === 1 ? `22px ${font}` : `27px ${font}`;
    if (line.startsWith("Dotyczy:")) ctx.font = `bold 27px ${font}`;
    const x = line.startsWith("Miasto, dnia") || line.startsWith("Pan/Pani") || line.startsWith("Lokator") ? 700 : 130;
    ctx.fillText(line, x, y);
    y += line ? (i < 2 ? 44 : 40) : 26;
    if (i === 1) {
      ctx.strokeStyle = "#1f2a44";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(130, y - 18);
      ctx.lineTo(W - 130, y - 18);
      ctx.stroke();
      y += 20;
    }
  });
  // Signature scribble and the received stamp.
  ctx.strokeStyle = "#20307a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(140, y - 150);
  ctx.bezierCurveTo(200, y - 210, 240, y - 100, 300, y - 170);
  ctx.bezierCurveTo(330, y - 200, 360, y - 120, 420, y - 160);
  ctx.stroke();
  ctx.save();
  ctx.translate(960, y - 125);
  ctx.rotate(-0.12);
  ctx.strokeStyle = "rgba(170, 30, 40, 0.75)";
  ctx.fillStyle = "rgba(170, 30, 40, 0.75)";
  ctx.lineWidth = 4;
  ctx.strokeRect(-150, -55, 300, 110);
  ctx.font = `bold 24px ${font}`;
  ctx.textAlign = "center";
  ctx.fillText("SM „PRZYKŁADOWA”", 0, -15);
  ctx.font = `22px ${font}`;
  ctx.fillText("WYSŁANO – DEMO", 0, 25);
  ctx.restore();
  ctx.restore();
  const png = await canvas.encode("png");
  const jpg = await sharp(png).greyscale().modulate({ brightness: 0.98 }).jpeg({ quality: 70 }).toBuffer();
  return new Uint8Array(jpg);
}

export async function loadDemo(): Promise<Case[]> {
  const t = today();
  let scan: FileRef | undefined;
  try {
    scan = await storeFile("odpowiedz-domofon-skan.jpg", await renderScan(demoScanLines(t)));
  } catch (err) {
    // Without the native canvas the demo still loads, only without the scan.
    console.error("Demo scan:", err);
  }
  try {
    return await mutate((db) => addDemo(db, t, scan));
  } catch (err) {
    if (scan) await deleteStored(scan);
    throw err;
  }
}

export async function unloadDemo(): Promise<number> {
  const files = await mutate((db) => removeDemo(db));
  for (const f of files) await deleteStored(f);
  return files.length;
}
