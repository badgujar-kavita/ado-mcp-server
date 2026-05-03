# Decision Log

Chronological record of notable design and security decisions for
ado-mcp-server. New entries go at the top.

---

## 2026-05-03 — Security audit: token leaks and path traversal (clean)

**Scope:** Port-Commit 6 of the interactive-read-contract refactor (see
`docs/ado-mcp-port-proposal.md` § Port-Commit 6).

**Audit A — Token leaks.** Reviewed every `console.log|warn|error` and
`new Error(...)` construction in `src/**/*.ts` (tests excluded). High-
risk surfaces checked:

- `src/ado-client.ts` `mapError()` — embeds ADO response body in the
  thrown message. ADO does not echo `Authorization` headers in response
  bodies, so PAT does not leak.
- `src/confluence-client.ts` 401 hint message, `listAttachments`
  failure, and `fetchAttachmentBinary` failure — these embed status
  text and the target URL, but the URL is the API path (auth is header-
  only) and Confluence does not echo credentials.
- `src/tools/configure-ui.ts` connection-test error paths — embed
  `String(err)` from a `fetch()` rejection. Node's fetch rejections
  carry network-layer messages ("fetch failed", "ETIMEDOUT"), not
  request headers.
- `src/tools/setup.ts` credential validation — only paths and booleans
  surface, never the PAT/token values.
- `src/index.ts:59` `console.error("Fatal error:", err)` — fatal-path
  logging of a startup error. Credentials file is read by value before
  server startup; the loaded object is not embedded in the error.

**Result: no real leaks.** The `redactSecrets()` utility proposed in the
port plan is not needed. Revisit if a logger abstraction is added that
ever formats request objects / headers into prose.

**Audit B — Path traversal.** Reviewed every `writeFileSync`,
`mkdirSync`, and `readFileSync` across `src/**/*.ts`. User-controllable
path components:

- `userStoryId` — typed as `z.number().int().positive()` at every tool
  boundary. Cannot carry `..` or `/`.
- `draftsPath` / `workspaceRoot` — user-supplied strings used as the
  draft ROOT (`resolve(...)` or `join(resolve(...), "tc-drafts")`). By
  design the user chooses where their drafts live; "escape" is not
  meaningful because there is no trusted parent directory above it.
- `docType` — `z.enum(["solution_summary", "qa_cheat_sheet",
  "regression_tests"])`. Closed set.
- Attachment filenames (`src/helpers/ado-attachments.ts`,
  `src/helpers/confluence-attachments.ts`) — passed through
  `sanitizeFilename()`: `name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0,
  120)`. `/` is replaced with `_`, so a malicious `"../etc/passwd"`
  becomes `".._etc_passwd"` and is used as a LEAF within a known-safe
  prefix. No escape.
- Confluence `pageId` — extracted via `\d+` regex from URL path.
  Digits only.

**Result: no real path traversal vulnerabilities.** Current
`sanitizeFilename()` plus numeric-ID typing is sufficient defense in
depth. No resolve-and-verify check added.
