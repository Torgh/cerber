import { NextResponse } from "next/server";
import { today } from "@/lib/dates";
import { handle } from "@/lib/server/http";
import { readDb } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** The whole database. With ?since=<updatedAt> answers 204 when nothing changed (the page polls it). */
export async function GET(req: Request) {
  return handle(async () => {
    const db = await readDb();
    const since = new URL(req.url).searchParams.get("since");
    if (since && since === db.updatedAt) return new NextResponse(null, { status: 204 });
    return NextResponse.json({ db, today: today() });
  });
}
