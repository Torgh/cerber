import { NextResponse, type NextRequest } from "next/server";

const LOCAL = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** "127.0.0.1:3200" → "127.0.0.1", "[::1]:3200" → "[::1]". */
function hostname(host: string): string {
  return host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
}

/**
 * The API answers only requests addressed to this computer. A web page on a domain that resolves to
 * 127.0.0.1 (DNS rebinding) sends its own name as Host, so it cannot read your cases or scans.
 */
export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOCAL.has(hostname(host).toLowerCase())) return new NextResponse("Cerber działa tylko lokalnie.", { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
