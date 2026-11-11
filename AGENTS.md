<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Cerber

- UI, MCP answers and README are Polish; code and comments are English.
- Every change to the data is a function in `lib/ops.ts`, run inside `mutate()` (`lib/server/db.ts`), so the web app and the MCP server follow the same rules.
- Deadlines: calendar days, moved past Saturdays, Sundays and holidays (`lib/dates.ts`). Never invent a default deadline – a case without one is flagged for the user.
- Tests use a temporary `CERBER_DATA_DIR`, never `~/.cerber`.
