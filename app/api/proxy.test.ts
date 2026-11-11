import { NextRequest } from "next/server";
import { expect, it } from "vitest";
import { proxy } from "@/proxy";

const req = (host: string) => new NextRequest("http://127.0.0.1:3200/api/state", { headers: { host } });

it("answers only requests addressed to this computer", () => {
  for (const host of ["127.0.0.1:3200", "localhost:3200", "LOCALHOST", "[::1]:3200"]) expect(proxy(req(host)).status, host).toBe(200);
  for (const host of ["evil.example", "evil.example:3200", "127.0.0.1.evil.example", ""]) expect(proxy(req(host)).status, host).toBe(403);
});
