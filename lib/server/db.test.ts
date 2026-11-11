import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as ops from "../ops";
import { samplePdf, withTempDataDir } from "../testUtils";
import { mutate, readDb } from "./db";
import { deleteStored, filePath, mimeOf, readStored, storeFile, storeFromPath } from "./files";
import { imageForClaude, pdfPageCount, pdfPageImages, pdfText } from "./pdf";

const dir = withTempDataDir();

describe("JSON database", () => {
  it("starts empty and keeps changes", async () => {
    expect((await readDb()).cases).toEqual([]);
    const c = await mutate((db) => ops.createCase(db, { title: "Przeciek", category: "defect" }));
    expect(c.id).toBe(1);
    const db = await readDb();
    expect(db.cases[0].title).toBe("Przeciek");
    expect(fs.existsSync(path.join(dir(), "cerber.json"))).toBe(true);
  });

  it("serialises concurrent changes – none is lost", async () => {
    await Promise.all(Array.from({ length: 8 }, (_, i) => mutate((db) => ops.createCase(db, { title: `Sprawa ${i}`, category: "other" }))));
    const db = await readDb();
    expect(db.cases).toHaveLength(8);
    expect(new Set(db.cases.map((c) => c.id)).size).toBe(8);
  });

  it("does not write when the change fails", async () => {
    await mutate((db) => ops.createCase(db, { title: "A", category: "other" }));
    await expect(mutate((db) => ops.getCase(db, 99))).rejects.toThrow("Nie ma sprawy #99");
    expect((await readDb()).cases).toHaveLength(1);
    expect(fs.existsSync(path.join(dir(), "cerber.lock"))).toBe(false);
  });

  it("makes a daily backup of the previous file", async () => {
    await mutate((db) => ops.createCase(db, { title: "A", category: "other" }));
    await mutate((db) => ops.createCase(db, { title: "B", category: "other" }));
    const backups = fs.readdirSync(path.join(dir(), "backups"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^cerber-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it("takes over a lock left by a crashed process", async () => {
    fs.mkdirSync(dir(), { recursive: true });
    const lock = path.join(dir(), "cerber.lock");
    fs.writeFileSync(lock, "1 old");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    await mutate((db) => ops.createCase(db, { title: "A", category: "other" }));
    expect((await readDb()).cases).toHaveLength(1);
  });
});

describe("stored files", () => {
  it("stores, reads and deletes a file", async () => {
    const ref = await storeFile("skan.PDF", samplePdf("Odpowiedz"));
    expect(ref.mime).toBe("application/pdf");
    expect(ref.pages).toBe(1);
    expect((await readStored(ref)).byteLength).toBe(ref.size);
    await deleteStored(ref);
    expect(fs.existsSync(filePath(ref))).toBe(false);
  });

  it("copies a file from disk and refuses missing ones", async () => {
    const src = path.join(dir(), "notatka.txt");
    fs.writeFileSync(src, "treść");
    const ref = await storeFromPath(src);
    expect(ref).toMatchObject({ name: "notatka.txt", mime: "text/plain" });
    await expect(storeFromPath(path.join(dir(), "brak.pdf"))).rejects.toThrow("Nie ma pliku");
  });

  it("never builds a path from a foreign id", () => {
    expect(() => filePath({ id: "../../etc", name: "x.pdf" })).toThrow();
    expect(mimeOf("a.jpeg")).toBe("image/jpeg");
    expect(mimeOf("a.xyz")).toBe("application/octet-stream");
  });
});

describe("PDF and images for Claude", () => {
  it("reads the text layer and renders pages", async () => {
    const pdf = samplePdf("Spoldzielnia odpowiada");
    expect(await pdfPageCount(pdf)).toBe(1);
    expect(await pdfText(pdf)).toEqual(["Spoldzielnia odpowiada"]);
    const [img] = await pdfPageImages(pdf, [1, 5]);
    expect(img.mime).toBe("image/jpeg");
    expect(img.data.length).toBeGreaterThan(1000);
    const again = await imageForClaude(Buffer.from(img.data, "base64"));
    expect(again.mime).toBe("image/jpeg");
  });
});
