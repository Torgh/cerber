import { today } from "@/lib/dates";
import * as ops from "@/lib/ops";
import { mutate } from "@/lib/server/db";
import { deleteStored } from "@/lib/server/files";
import { checkOrigin, handle } from "@/lib/server/http";
import type { Db, FileRef } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Changes without files, as { op, args }. The ops are the same ones the MCP server uses. */
const ACTIONS: Record<string, (db: any, a: any) => unknown> = {
  createCase: (db, a) => ops.createCase(db, a),
  updateCase: (db, a) => ops.updateCase(db, a.caseId, a.patch),
  deleteCase: (db, a) => ops.deleteCase(db, a.caseId),
  linkCases: (db, a) => ops.linkCases(db, a.caseId, a.otherCaseId, a.unlink),
  updateEvent: (db, a) => ops.updateEvent(db, a.caseId, a.eventId, a.patch),
  deleteEvent: (db, a) => ops.deleteEvent(db, a.caseId, a.eventId),
  shareEvent: (db, a) => ops.shareEvent(db, a.caseId, a.eventId, a.otherCaseId, a.replyDeadline),
  linkEvents: (db, a) => ops.linkEvents(db, a.caseId, a.eventId, a.otherCaseId, a.otherEventId),
  removeFile: (db, a) => ops.removeFile(db, a.caseId, a.eventId, a.fileId),
  addDeadline: (db, a) => ops.addDeadline(db, a.caseId, a.deadline, today()),
  updateDeadline: (db, a) => ops.updateDeadline(db, a.caseId, a.deadlineId, a.patch),
  deleteDeadline: (db, a) => ops.deleteDeadline(db, a.caseId, a.deadlineId),
  deleteDraft: (db, a) => ops.deleteDraft(db, a.caseId, a.draftId),
  deleteRules: (db, a) => ops.deleteRules(db, a.id),
  setDeadlineRule: (db, a) => ops.setDeadlineRule(db, a.category, a.days, a.source),
  savePerson: (db, a) => ops.savePerson(db, a),
  deletePerson: (db, a) => ops.deletePerson(db, a.id),
};

/** Files the operation took out of the data (a linked letter may still use them elsewhere). */
function released(op: string, result: any): FileRef[] {
  switch (op) {
    case "deleteEvent":
    case "linkEvents":
      return result as FileRef[];
    case "removeFile":
      return [result as FileRef];
    case "deleteCase":
      return (result as { events: { files: FileRef[] }[] }).events.flatMap((e) => e.files);
    case "deleteRules":
      return result?.file ? [result.file as FileRef] : [];
    default:
      return [];
  }
}

export async function POST(req: Request) {
  return handle(async () => {
    checkOrigin(req);
    const { op, args } = (await req.json()) as { op: string; args: any };
    const fn = ACTIONS[op];
    if (!fn) throw new ops.OpError(`Nieznana operacja ${op}.`);
    const { result, gone } = await mutate((db: Db) => {
      const result = fn(db, args ?? {});
      return { result, gone: ops.unreferenced(db, released(op, result)) };
    });
    for (const f of gone) await deleteStored(f);
    return { ok: true, result };
  });
}
