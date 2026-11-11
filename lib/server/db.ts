/**
 * The database is one JSON file, <data>/cerber.json, plus the scans in <data>/files. The web app and
 * the MCP server are separate processes, so every change takes a lock file, reads the current file,
 * applies the change and writes it atomically (temporary file + rename). Once a day the previous file
 * is copied to <data>/backups.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { emptyDb, type Db } from "../types";

export function dataDir(): string {
  return process.env.CERBER_DATA_DIR || path.join(os.homedir(), ".cerber");
}

const dbFile = () => path.join(dataDir(), "cerber.json");

const STALE_MS = 15_000;
const WAIT_MS = 10_000;
const KEEP_BACKUPS = 30;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readDb(): Promise<Db> {
  let raw: string;
  try {
    raw = await fs.readFile(dbFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyDb();
    throw err;
  }
  const db = { ...emptyDb(), ...(JSON.parse(raw) as Partial<Db>) };
  return db;
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  await fs.mkdir(dataDir(), { recursive: true });
  const lock = path.join(dataDir(), "cerber.lock");
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    try {
      await fs.writeFile(lock, `${process.pid} ${new Date().toISOString()}`, { flag: "wx" });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const stat = await fs.stat(lock).catch(() => undefined);
      if (stat && Date.now() - stat.mtimeMs > STALE_MS) {
        await fs.rm(lock, { force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error("Baza jest zajęta przez inny zapis – spróbuj ponownie.");
      await sleep(30 + Math.random() * 50);
    }
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lock, { force: true });
  }
}

async function backup() {
  const dir = path.join(dataDir(), "backups");
  const name = `cerber-${new Date().toISOString().slice(0, 10)}.json`;
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.copyFile(dbFile(), path.join(dir, name), fs.constants.COPYFILE_EXCL);
    const all = (await fs.readdir(dir)).filter((f) => f.startsWith("cerber-")).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) await fs.rm(path.join(dir, old), { force: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOENT") throw err;
  }
}

async function writeDb(db: Db) {
  const file = dbFile();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
  // On Windows a reader holding the file open makes rename fail for a moment.
  for (let i = 0; ; i++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (i >= 20 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await sleep(25);
    }
  }
}

/** Applies `fn` to the current data and saves it. Whatever `fn` returns is passed back. */
export async function mutate<T>(fn: (db: Db) => T | Promise<T>): Promise<T> {
  return withLock(async () => {
    const db = await readDb();
    const result = await fn(db);
    await backup();
    await writeDb(db);
    return result;
  });
}
