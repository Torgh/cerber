import { NextResponse } from "next/server";
import { today } from "@/lib/dates";
import { getCase, OpError } from "@/lib/ops";
import { reportHtml, reportMarkdown, reportTitle } from "@/lib/report";
import { readDb } from "@/lib/server/db";
import { handle } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** The chronology of a case: a printable page, or Markdown with ?format=md (downloaded). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await ctx.params;
    if (!/^\d+$/.test(id)) throw new OpError("Nieprawidłowy numer sprawy.", 400);
    const db = await readDb();
    const c = getCase(db, Number(id));
    const t = today();
    if (new URL(req.url).searchParams.get("format") === "md") {
      const name = `${reportTitle(c).replace(/[^\p{L}\p{N} #-]+/gu, "").trim()}.md`;
      return new NextResponse(reportMarkdown(c, db, t), {
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return new NextResponse(reportHtml(c, db, t), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Static page: no scripts, nothing loaded from outside.
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "no-store",
      },
    });
  });
}
