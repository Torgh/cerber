/** PDF text and page images (for Claude to read scans), and resizing photos of letters. */
import sharp from "sharp";
import { extractText, getDocumentProxy, renderPageAsImage } from "unpdf";

export async function pdfPageCount(data: Uint8Array): Promise<number> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  return pdf.numPages;
}

/** The text layer, page by page. A scanner's PDF usually has none (empty strings). */
export async function pdfText(data: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((t) => t.trim());
}

/** Claude reads images up to about 1600 px on the long side well; bigger only costs more. */
const MAX_SIDE = 1800;

export interface PageImage {
  page: number;
  mime: "image/jpeg";
  data: string; // base64
}

async function toJpeg(input: Uint8Array): Promise<string> {
  const out = await sharp(input)
    .rotate() // phone photos: honour EXIF orientation
    .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toBuffer();
  return out.toString("base64");
}

export async function pdfPageImages(data: Uint8Array, pages: number[]): Promise<PageImage[]> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const out: PageImage[] = [];
  for (const page of pages) {
    if (page < 1 || page > pdf.numPages) continue;
    const png = await renderPageAsImage(pdf, page, { canvasImport: () => import("@napi-rs/canvas"), scale: 2 });
    out.push({ page, mime: "image/jpeg", data: await toJpeg(png as Uint8Array) });
  }
  return out;
}

export async function imageForClaude(data: Uint8Array): Promise<PageImage> {
  return { page: 1, mime: "image/jpeg", data: await toJpeg(data) };
}
