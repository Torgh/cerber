import "server-only";
import { NextResponse } from "next/server";
import { OpError } from "../ops";

/**
 * The app listens on 127.0.0.1 only, but a web page open in the same browser could still post to it.
 * Changes are accepted only from the app's own origin.
 */
export function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return;
  const host = new URL(origin).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") throw new OpError("Niedozwolone źródło żądania.", 403);
}

export async function handle(fn: () => Promise<unknown>): Promise<NextResponse> {
  try {
    const out = await fn();
    return out instanceof NextResponse ? out : NextResponse.json(out ?? { ok: true });
  } catch (err) {
    const status = err instanceof OpError ? err.status : 500;
    if (status === 500) console.error(err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
