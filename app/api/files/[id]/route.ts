import { NextResponse } from "next/server";
import { OpError } from "@/lib/ops";
import { readDb } from "@/lib/server/db";
import { readStored } from "@/lib/server/files";
import { handle } from "@/lib/server/http";
import type { FileRef } from "@/lib/types";

/** A stored scan, shown in the browser (PDF and images inline). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    const db = await readDb();
    let ref: FileRef | undefined;
    for (const c of db.cases) for (const e of c.events) ref ??= e.files.find((f) => f.id === id);
    ref ??= db.rules.find((r) => r.file?.id === id)?.file;
    if (!ref) throw new OpError("Nie ma takiego pliku.", 404);
    const data = await readStored(ref);
    return new NextResponse(Buffer.from(data), {
      headers: {
        "Content-Type": ref.mime,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(ref.name)}`,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
