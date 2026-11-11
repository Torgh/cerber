import { loadDemo, unloadDemo } from "@/lib/server/demo";
import { checkOrigin, handle } from "@/lib/server/http";

/** POST loads the demo data, DELETE removes it (only what is marked demo). */
export async function POST(req: Request) {
  return handle(async () => {
    checkOrigin(req);
    const cases = await loadDemo();
    return { ok: true, cases: cases.length, first: cases[0]?.id };
  });
}

export async function DELETE(req: Request) {
  return handle(async () => {
    checkOrigin(req);
    return { ok: true, files: await unloadDemo() };
  });
}
