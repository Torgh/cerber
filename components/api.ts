"use client";
import type { Db } from "@/lib/types";

async function parse(res: Response) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Błąd ${res.status}`);
  return body;
}

export async function action<T = unknown>(op: string, args: unknown): Promise<T> {
  const res = await fetch("/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, args }) });
  return (await parse(res)).result as T;
}

export async function upload<T = unknown>(op: string, args: unknown, files: File[]): Promise<T> {
  const form = new FormData();
  form.set("op", op);
  form.set("args", JSON.stringify(args));
  for (const f of files) form.append("files", f);
  return parse(await fetch("/api/upload", { method: "POST", body: form }));
}

export async function loadState(since?: string): Promise<{ db: Db; today: string } | null> {
  const res = await fetch(`/api/state${since ? `?since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
  if (res.status === 204) return null;
  return parse(res);
}

export const fileUrl = (id: string) => `/api/files/${id}`;

export async function demo(load: boolean): Promise<{ first?: number }> {
  return parse(await fetch("/api/demo", { method: load ? "POST" : "DELETE" }));
}
