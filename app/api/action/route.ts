import { today } from "@/lib/dates";
import * as ops from "@/lib/ops";
import { mutate } from "@/lib/server/db";
import { deleteStored } from "@/lib/server/files";
import { checkOrigin, handle } from "@/lib/server/http";
import type { FileRef } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Changes without files, as { op, args }. The ops are the same ones the MCP server uses. */
const ACTIONS: Record<string, (db: any, a: any) => unknown> = {
  createCase: (db, a) => ops.createCase(db, a),
  updateCase: (db, a) => ops.updateCase(db, a.caseId, a.patch),
  deleteCase: (db, a) => ops.deleteCase(db, a.caseId),
  updateEvent: (db, a) => ops.updateEvent(db, a.caseId, a.eventId, a.patch),
  deleteEvent: (db, a) => ops.deleteEvent(db, a.caseId, a.eventId),
  removeFile: (db, a) => ops.removeFile(db, a.caseId, a.eventId, a.fileId),
  addDeadline: (db, a) => ops.addDeadline(db, a.caseId, a.deadline, today()),
  updateDeadline: (db, a) => ops.updateDeadline(db, a.caseId, a.deadlineId, a.patch),
  deleteDeadline: (db, a) => ops.deleteDeadline(db, a.caseId, a.deadlineId),
  deleteDraft: (db, a) => ops.deleteDraft(db, a.caseId, a.draftId),
  deleteRules: (db, a) => ops.deleteRules(db, a.id),
  setDeadlineRule: (db, a) => ops.setDeadlineRule(db, a.category, a.days, a.source),
};

export async function POST(req: Request) {
  return handle(async () => {
    checkOrigin(req);
    const { op, args } = (await req.json()) as { op: string; args: any };
    const fn = ACTIONS[op];
    if (!fn) throw new ops.OpError(`Nieznana operacja ${op}.`);
    const result = await mutate((db) => fn(db, args ?? {}));
    // Files of what was deleted go too.
    const gone: FileRef[] =
      op === "deleteEvent"
        ? (result as FileRef[])
        : op === "removeFile"
          ? [result as FileRef]
          : op === "deleteCase"
            ? (result as { events: { files: FileRef[] }[] }).events.flatMap((e) => e.files)
            : op === "deleteRules" && (result as { file?: FileRef }).file
              ? [(result as { file: FileRef }).file]
              : [];
    for (const f of gone) await deleteStored(f);
    return { ok: true, result };
  });
}
