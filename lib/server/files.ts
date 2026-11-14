/** Scans and documents attached to cases, stored as <data>/files/<id><ext>. */
import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type { FileRef } from "../types";
import { dataDir } from "./db";
import { pdfPageCount } from "./pdf";

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const MIME: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".msg": "application/vnd.ms-outlook",
};

export function mimeOf(name: string): string {
  return MIME[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

const filesDir = () => path.join(dataDir(), "files");

/** Only ids this module made – never a path a caller could steer. */
export function filePath(f: Pick<FileRef, "id" | "name">): string {
  if (!/^[\w-]{6,30}$/.test(f.id)) throw new Error("Nieprawidłowy identyfikator pliku.");
  return path.join(filesDir(), f.id + path.extname(f.name).toLowerCase().replace(/[^.a-z0-9]/g, ""));
}

export async function storeFile(name: string, data: Uint8Array): Promise<FileRef> {
  if (data.byteLength > MAX_FILE_BYTES) throw new Error(`Plik ${name} jest za duży (maks. 50 MB).`);
  const ref: FileRef = { id: nanoid(12), name: path.basename(name), mime: mimeOf(name), size: data.byteLength };
  if (ref.mime === "application/pdf") ref.pages = await pdfPageCount(data).catch(() => undefined);
  await fs.mkdir(filesDir(), { recursive: true });
  await fs.writeFile(filePath(ref), data);
  return ref;
}

/** Copies a file from the user's disk (the MCP server gets a path from Claude). */
export async function storeFromPath(p: string): Promise<FileRef> {
  const abs = path.resolve(p);
  const stat = await fs.stat(abs).catch(() => undefined);
  if (!stat?.isFile()) throw new Error(`Nie ma pliku: ${abs}`);
  if (stat.size > MAX_FILE_BYTES) throw new Error(`Plik ${abs} jest za duży (maks. 50 MB).`);
  return storeFile(path.basename(abs), new Uint8Array(await fs.readFile(abs)));
}

export async function readStored(f: FileRef): Promise<Uint8Array> {
  return new Uint8Array(await fs.readFile(filePath(f)));
}

export async function deleteStored(f: FileRef) {
  await fs.rm(filePath(f), { force: true });
}
