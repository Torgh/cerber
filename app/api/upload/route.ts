import * as ops from "@/lib/ops";
import { mutate } from "@/lib/server/db";
import { deleteStored, readStored, storeFile } from "@/lib/server/files";
import { checkOrigin, handle } from "@/lib/server/http";
import { pdfText } from "@/lib/server/pdf";
import type { FileRef } from "@/lib/types";

/**
 * Changes with files, as multipart form data: "op" (addEvent | attachFiles | addRules), "args" (JSON)
 * and the files under "files".
 */
export async function POST(req: Request) {
  return handle(async () => {
    checkOrigin(req);
    const form = await req.formData();
    const op = String(form.get("op"));
    const args = JSON.parse(String(form.get("args") ?? "{}"));
    const stored: FileRef[] = [];
    try {
      for (const f of form.getAll("files")) {
        if (f instanceof File && f.size) stored.push(await storeFile(f.name, new Uint8Array(await f.arrayBuffer())));
      }
      if (op === "addEvent") {
        return await mutate((db) => ops.addEvent(db, args.caseId, { ...args.event, files: stored }));
      }
      if (op === "attachFiles") {
        if (!stored.length) throw new ops.OpError("Nie wybrano plików.");
        return await mutate((db) => ops.attachFiles(db, args.caseId, args.eventId, stored));
      }
      if (op === "addRules") {
        const file = stored[0];
        let text: string = args.text ?? "";
        if (!text && file) {
          const data = await readStored(file);
          if (file.mime === "application/pdf") text = (await pdfText(data)).join("\n\n");
          else if (file.mime.startsWith("text/")) text = new TextDecoder().decode(data);
        }
        if (text.replace(/\s/g, "").length < 200)
          throw new ops.OpError(
            "Ten plik nie ma warstwy tekstowej (to skan). Wklej tekst albo poproś Claude'a: „wczytaj regulamin z <ścieżka>” – przeczyta skan przez MCP.",
          );
        return await mutate((db) => ops.addRules(db, { ...args, text, file }));
      }
      throw new ops.OpError(`Nieznana operacja ${op}.`);
    } catch (err) {
      for (const f of stored) await deleteStored(f);
      throw err;
    }
  });
}
