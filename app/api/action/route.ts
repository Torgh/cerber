import { today } from "@/lib/dates";
import * as ops from "@/lib/ops";
import { mutate } from "@/lib/server/db";
import { deleteStored } from "@/lib/server/files";
import { checkOrigin, handle } from "@/lib/server/http";
import type { Db, FileRef } from "@/lib/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Changes without files, as { op, args }. The ops are the same ones the MCP server uses. A switch,
 * not a lookup by name, so a request can never reach anything but these operations.
 */
function run(db: Db, op: unknown, a: any): unknown {
  switch (op) {
    case "createCase":
      return ops.createCase(db, a);
    case "updateCase":
      return ops.updateCase(db, a.caseId, a.patch);
    case "deleteCase":
      return ops.deleteCase(db, a.caseId);
    case "linkCases":
      return ops.linkCases(db, a.caseId, a.otherCaseId, a.unlink);
    case "updateEvent":
      return ops.updateEvent(db, a.caseId, a.eventId, a.patch);
    case "deleteEvent":
      return ops.deleteEvent(db, a.caseId, a.eventId);
    case "shareEvent":
      return ops.shareEvent(db, a.caseId, a.eventId, a.otherCaseId, a.replyDeadline);
    case "linkEvents":
      return ops.linkEvents(db, a.caseId, a.eventId, a.otherCaseId, a.otherEventId);
    case "removeFile":
      return ops.removeFile(db, a.caseId, a.eventId, a.fileId);
    case "addDeadline":
      return ops.addDeadline(db, a.caseId, a.deadline, today());
    case "updateDeadline":
      return ops.updateDeadline(db, a.caseId, a.deadlineId, a.patch);
    case "deleteDeadline":
      return ops.deleteDeadline(db, a.caseId, a.deadlineId);
    case "deleteDraft":
      return ops.deleteDraft(db, a.caseId, a.draftId);
    case "deleteRules":
      return ops.deleteRules(db, a.id);
    case "setDeadlineRule":
      return ops.setDeadlineRule(db, a.category, a.days, a.source);
    case "savePerson":
      return ops.savePerson(db, a);
    case "deletePerson":
      return ops.deletePerson(db, a.id);
    default:
      throw new ops.OpError(`Nieznana operacja ${typeof op === "string" ? op : typeof op}.`);
  }
}

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
    const { op, args } = (await req.json()) as { op: unknown; args: any };
    // An unknown operation throws inside mutate, before anything is written.
    const { result, gone } = await mutate((db: Db) => {
      const result = run(db, op, args ?? {});
      return { result, gone: ops.unreferenced(db, released(String(op), result)) };
    });
    for (const f of gone) await deleteStored(f);
    return { ok: true, result };
  });
}
