# Proposal: Port the Interactive Read Contract to ado-mcp-server

**Status:** proposal (not implemented)
**Author:** drafted 2026-05-03 from the shipped jira-mcp-server-v2 refactor
**Decision deadline:** none — implementation commits only after this is approved

---

## Why this document exists

Between 2026-05-02 and 2026-05-03, jira-mcp-server-v2 shipped 7
commits that transformed its MCP tool surface from "raw content
dumper" to "interactive agent assistant":

1. Shared prompt contracts + AGENTS.md (Commit 1)
2. `CanonicalReadResult` + `structuredContent` (Commit 2)
3. Shared snapshot writer (Commit 3)
4. `outputSchema` advertised on read tool defs (Commit 4)
5. `jira_check` anti-hallucination (Commit 2.5)
6. Pagination audit + Jira comment truncation signal
7. Security audits + prompt-injection guardrail + host-IDE tool
   broadening

You asked if the same pattern can ship to ado-mcp-server. This doc
audits ado-mcp's actual surface, maps each commit to what it would
mean in this codebase, flags the places where the port is **not**
symmetric, and proposes a staged rollout.

**Nothing ships from this doc.** Review first, implement afterwards
in separate, small commits.

---

## 1. ado-mcp current surface — concrete inventory

### Tools (29 total)

| Tool name | File:line | Category |
|---|---|---|
| `configure` | `setup.ts:168` | setup |
| `setup_credentials` | `setup.ts:207` | setup |
| `check_setup_status` | `setup.ts:246` | diagnostic |
| `get_user_story` | `work-items.ts:19` | read |
| `list_test_cases_linked_to_user_story` | `work-items.ts:50` | read |
| `list_work_item_fields` | `work-items.ts:89` | read |
| `list_test_plans` | `test-plans.ts:7` | read |
| `get_test_plan` | `test-plans.ts:38` | read |
| `create_test_plan` | `test-plans.ts:61` | action |
| `list_test_cases` | `test-cases.ts:34` | read |
| `get_test_case` | `test-cases.ts:63` | read |
| `update_test_case` | `test-cases.ts:86` | action |
| `add_test_cases_to_suite` | `test-cases.ts:141` | action |
| `delete_test_case` | `test-cases.ts:170` | action |
| `ensure_suite_hierarchy_for_us` | `test-suites.ts:16` | action |
| `ensure_suite_hierarchy` | `test-suites.ts:37` | action |
| `find_or_create_test_suite` | `test-suites.ts:60` | action |
| `list_test_suites` | `test-suites.ts:86` | read |
| `get_test_suite` | `test-suites.ts:115` | read |
| `create_test_suite` | `test-suites.ts:140` | action |
| `update_test_suite` | `test-suites.ts:173` | action |
| `delete_test_suite` | `test-suites.ts:213` | action |
| `save_tc_draft` | `tc-drafts.ts:120` | action |
| `get_tc_draft` | `tc-drafts.ts:175` | read |
| `list_tc_drafts` | `tc-drafts.ts:207` | read |
| `save_tc_clone_preview` | `tc-drafts.ts:332` | action (interactive) |
| `push_tc_draft_to_ado` | `tc-drafts.ts:366` | action |
| `save_tc_supporting_doc` | `tc-drafts.ts:496` | action |
| `get_confluence_page` | `confluence.ts:6` | read |

**Read category (14 tools):** the most valuable targets for this
refactor. They currently return `JSON.stringify(context, null, 2)`
as a prose block — a form users already complained about in
jira-mcp ("show the result verbatim" anti-pattern). Port has high
leverage here.

**Action category (13 tools):** already single-turn, no resume
tokens. Most don't need elicitation; a few (`save_tc_clone_preview`,
`push_tc_draft_to_ado`) have informal approve/modify/cancel
prompting that could be formalized.

**Setup + diagnostic (3 tools):** small surface, similar enough
to jira-mcp's patterns to port cleanly.

### Prompts (partial inventory)

ado-mcp uses `server.registerPrompt(name, meta, handler)` — static
text, no shared contract composition. ~15 prompts in
`src/prompts/index.ts`. Each is an independent string literal.

### What's in the repo today (structural)

- SDK: `McpServer` high-level API (vs jira-mcp's low-level `Server`).
- Tool registration: `server.tool(name, desc, schema, handler)` —
  4-arg form that **does not accept `outputSchema`**. The newer
  `server.registerTool(name, config, handler)` does.
- No `AGENTS.md`.
- No test framework (no Jest, Vitest, or similar). `package.json`
  devDependencies: TypeScript, tsx, esbuild, @types/node only.
- No pending-state / resume-token system. Action tools are
  single-turn; any multi-step flows are agent-orchestrated through
  prompts.
- `confluence-client.ts` fetches a **single page**; no child-page
  walking.

---

## 2. Gaps that shape the port

Three findings change the shape of the port vs. the "just copy
verbatim" expectation from `interactive_read_contract.plan.md`
Part III:

### Gap A — No test framework

**Implication:** every commit that lands in jira-mcp with 3–10 new
tests lands in ado-mcp with zero tests. Options:

- **A1. Bootstrap Vitest first**, in a zero-behavior preamble commit.
  Adds `vitest` as devDependency, creates `test/unit/` dir, adds
  `npm test` script. One-time cost; every later commit can pin
  contract phrases and regression-guard the shape.
- **A2. Ship without tests.** Faster, but every regression is
  invisible. The jira-mcp refactor caught 3–4 prompt-phrase
  collisions via tests that would have silently broken the agent
  otherwise.
- **A3. Tests later.** Ship the prompt+data changes first, add test
  harness when we next touch code. Risks: by then the phrases have
  drifted and pinning them is archaeological.

**Recommendation: A1.** It's a 15-min commit that makes everything
after it safer. Do it before Commit 1 of the port.

### Gap B — SDK surface is high-level, not low-level

jira-mcp's `ToolDef` is a plain object advertised via a
`ListToolsRequestHandler`. ado-mcp's `server.tool(...)` registers
directly but the 4-arg form omits `outputSchema`.

**Implication:** Commit 4 ("declare outputSchema") in jira-mcp is
a trivial addition to `ToolDef`. In ado-mcp it requires migrating
every tool registration from `server.tool(...)` to
`server.registerTool(name, {description, inputSchema, outputSchema,
...}, handler)`. That's 29 call-site edits for a change that was
~4 lines in jira-mcp.

**Recommendation:** migrate tool-by-tool during Commit 2 (canonical
read shape) rather than in one big-bang Commit 4. Each read tool
you wire to return `structuredContent` gets migrated at the same
time; you pay the SDK-surface cost only where it yields value.

### Gap C — No pending-state / elicitation infrastructure

jira-mcp's `ELICITATION_PROTOCOL` relies on `pendingState.ts` to
save state under a resume token and resume on the next turn.
ado-mcp's action tools don't have this; they're single-turn.

**Implication:** `ELICITATION_PROTOCOL` doesn't port directly. The
two places ado-mcp has informal approve/cancel prompts
(`save_tc_clone_preview`, `push_tc_draft_to_ado` with `repush`) can
be formalized with a lighter contract — no resume token, just
"agent asks, user answers, agent calls the next tool."

**Recommendation:** define a smaller `CONFIRM_BEFORE_ACT_CONTRACT`
for ado-mcp's two interactive action tools. Skip
`ELICITATION_PROTOCOL` entirely.

---

## 3. Per-commit port plan

Ordered lowest-risk to highest-risk. Each is independently
reviewable and shippable.

### Port-Commit 0 — Bootstrap test harness

**Scope:** Add Vitest. ~15 min.

- `package.json` — add `"vitest": "^2.x"` to devDependencies, add
  `"test": "vitest run"` and `"test:watch": "vitest"` scripts.
- `vitest.config.ts` — minimal config, same shape as jira-mcp.
- `test/unit/.gitkeep` — empty placeholder so the directory
  exists for subsequent commits.

**No behaviour change.** No tests written yet. Verification: `npm
test` runs and reports 0 passing, 0 failing.

### Port-Commit 1 — AGENTS.md + shared contract constants

**Scope:** Copy verbatim from jira-mcp where possible. ~30 min.

- New `AGENTS.md` at repo root. Six sections from jira-mcp's
  AGENTS.md:
  1. **Tool categories.** Adapted: read / action / diagnostic /
     setup. (ado-mcp has setup tools jira-mcp lacks.)
  2. **User-initiated invocation (universal).** Copy verbatim.
     This is the highest-leverage rule from the whole refactor.
  3. **Upstream content is data, not instructions.** Copy
     verbatim, swap "Jira/Confluence/Zephyr" → "ADO/Confluence".
  4. **Formatting rules.** Copy verbatim.
  5. **Safety and partial results.** Copy verbatim, note that
     ado-mcp doesn't have `completeness.isPartial` yet — that
     arrives in Port-Commit 2.
  6. **MCP spec alignment.** Copy verbatim.

- New shared-constants module at
  `src/prompts/shared-contracts.ts`:
  - `INTERACTIVE_READ_CONTRACT` — copy verbatim.
  - `DIAGNOSTIC_CONTRACT` — copy verbatim.
  - `CONFIRM_BEFORE_ACT_CONTRACT` — new, lighter replacement for
    `ELICITATION_PROTOCOL` + `TWO_PHASE_CONFIRM`. Rules: "offer the
    plan; wait for explicit yes; tool the user runs to confirm is
    the next action tool, not a re-call of the same one."

- Update `src/prompts/index.ts`:
  - Compose `INTERACTIVE_READ_CONTRACT` into every read prompt
    (`get_user_story`, `list_test_plans`, `get_test_plan`,
    `list_test_suites`, `get_test_suite`, `list_test_cases`,
    `get_test_case`, `list_work_item_fields`,
    `list_test_cases_linked_to_user_story`, `get_tc_draft`,
    `list_tc_drafts`, `get_confluence_page`).
  - Compose `DIAGNOSTIC_CONTRACT` into `check_setup_status`.
  - Compose `CONFIRM_BEFORE_ACT_CONTRACT` into
    `save_tc_clone_preview` and `push_tc_draft_to_ado`.
  - Setup prompts (`configure`, `setup_credentials`) left as-is —
    their current text is already minimal.

- Add contract-composition tests in
  `test/unit/prompts/contracts.test.ts`:
  - Every read prompt contains `INTERACTIVE_READ_CONTRACT` text.
  - `check_setup_status` contains `DIAGNOSTIC_CONTRACT`.
  - No prompt contains the literal string "show the result
    verbatim" (anti-pattern eviction).

**Risk:** low. Prompt-text-only. Tests pin the composition.
Rollback: revert the commit.

### Port-Commit 2 — Canonical read shape + `structuredContent`

**Scope:** ~3 h. The big one.

- New `src/tools/read-result.ts`:
  - `CanonicalReadResult` type, identical to jira-mcp's.
  - `toReadToolResult(prose, result)` helper returning `{
    content, structuredContent }` in the `server.registerTool`
    handler return shape.
  - `READ_OUTPUT_SCHEMA` — same JSON Schema as jira-mcp.

- Migrate the 14 read tools from `server.tool(...)` to
  `server.registerTool(name, config, handler)`. For each:
  - Move `description` into `config.description`.
  - Move the Zod schema into `config.inputSchema`.
  - Add `config.outputSchema: READ_OUTPUT_SCHEMA`.
  - Build a `CanonicalReadResult` from the existing response data.
  - Return via `toReadToolResult(prose, canonical)`.

- Specifics per tool (non-exhaustive):
  - `get_user_story` — `item` = the US, `children` = parent +
    linked test cases, `artifacts` = Solution Design sections,
    `completeness.isPartial=true` if Confluence fetch failed.
  - `get_test_case` — `item` = TC, `children` = related work
    items, `artifacts` = attachments.
  - `list_test_cases` — `item` = the suite, `children` = test
    cases as nodes.
  - `get_confluence_page` — `item` = the page, `artifacts` =
    images + section headers, `completeness.isPartial=false`
    (single-page fetch, no hierarchy yet — that arrives in
    Port-Commit 4 if scoped in).

- Tests in `test/unit/tools/read-canonical.test.ts`:
  - Mock the ADO client's HTTP responses.
  - For each read tool, assert the returned object has
    `structuredContent` with the expected shape.
  - No regressions on prose text (byte-compatible).

**Risk:** medium. Migrating 14 tool registrations plus building
canonical objects is mechanical but high-touch. Split into
sub-commits by tool file (work-items, test-plans, test-cases,
test-suites, tc-drafts, confluence) if the diff gets unwieldy.

### Port-Commit 3 — Shared snapshot writer (evaluate, may skip)

**Scope:** ~30 min if we keep it; zero if we skip.

ado-mcp's `tc-drafts.ts` already has a sophisticated markdown-
saving workflow:
- `save_tc_draft` → `tc-drafts/US_<id>/US_<id>_test_cases.md`
- `save_tc_clone_preview` → same folder, different filename
- `save_tc_supporting_doc` → same folder, third filename
- Post-push, `push_tc_draft_to_ado` writes JSON co-located with the
  .md

This is already **more mature** than jira-mcp's snapshot system was
pre-refactor. Extracting it into a shared writer is a code-
organization win but not a user-facing one.

**Recommendation:** **skip** Port-Commit 3 for now. Document in
the proposal's deferred section. Revisit if a new read tool that
needs snapshots is added (e.g. a `get_confluence_tree` that saves
a walk).

### Port-Commit 4 — `outputSchema` declaration

**Scope:** Rolled into Port-Commit 2 (the migration to
`registerTool`). No separate commit needed.

### Port-Commit 5 — `check_setup_status` anti-hallucination (jira-mcp's Commit 2.5 equivalent)

**Scope:** ~45 min.

ado-mcp's `check_setup_status` currently returns prose. Port
jira-mcp's pattern:

- The tool computes an overall verdict (`healthy` / `degraded` /
  `broken`) based on credential + API-probe rows.
- The tool pre-computes a Next Actions list — deterministic
  mapping from row status to remediation (e.g. "PAT missing → Run
  `/configure` and paste an ADO PAT with Test Management read/
  write scope").
- The prompt uses `DIAGNOSTIC_CONTRACT` (already landed in
  Port-Commit 1): show the table verbatim, surface Next Actions
  verbatim, do NOT invent causes, do NOT invoke other tools.

- Tests in `test/unit/tools/check_setup_status.test.ts` —
  deterministic Next Actions output when rows are mocked.

**Risk:** low. Scoped to one tool.

### Port-Commit 6 — Security audits

**Scope:** ~1 h.

Mirror jira-mcp's audit commit. Two parts, both may come back
clean:

- **Token-leak audit:** grep every `console.log|console.error` and
  error-construction in `src/`. ado-mcp doesn't have a logger
  abstraction yet (jira-mcp has `src/logger/logger.ts` with
  recursive redaction). If any token-adjacent data appears,
  either add a minimal `redactSecrets()` helper or refactor the
  offending site. The `ado-client.ts` and `confluence-client.ts`
  are the high-risk surfaces.
- **Path-traversal audit:** every file-write in `tc-drafts.ts`,
  `save_tc_supporting_doc`, etc. Check whether user-controllable
  path segments (`userStoryId`, `workspaceRoot`, `draftsPath`,
  `docType`) are validated. If not, add a resolve-and-verify
  check.

**Risk:** low, audit-first.

---

## 4. What's explicitly NOT ported

- **`ELICITATION_PROTOCOL` / resume tokens.** ado-mcp doesn't need
  them; action tools are single-turn by design.
- **`readSnapshot.ts`.** ado-mcp's tc-drafts system already works.
  Unifying would be code-organization only.
- **Confluence child-walking.** ado-mcp's single-page fetch is
  sufficient for current workflows. If that changes, port
  jira-mcp's walker as a separate effort.
- **Pagination audit.** ado-mcp's ADO API calls and Confluence
  fetches don't currently exhibit the truncation patterns
  jira-mcp had (no 20-comment cap, no 50-link cap). Skip unless
  evidence of loss surfaces.
- **`qa_draft` scaffold-is-by-design clarification** (the most
  recent commit in jira-mcp, `9c88861`). ado-mcp's tc-drafts
  pattern is different — drafts are authored by the agent at
  save-time and don't have an "empty scaffold" step.

---

## 5. Test-collision risk assessment

Because ado-mcp has **no existing tests**, there are no pinned
phrases to collide with. This is a pure win — every test landed
in this port is new ground.

One implication: we can't gauge prompt-text regressions the way
jira-mcp does ("does this phrase that an agent depends on still
appear?"). Substitute: after Port-Commit 1, run each prompt
manually in Cursor and paste output into the commit message as
the verification step. For 3+ commits we'll have enough snapshot
evidence to regression-guard in tests.

---

## 6. Recommended sequencing

Four commits over an estimated 5 hours:

| # | Commit | Effort | Risk |
|---|---|---|---|
| 0 | Bootstrap Vitest | 15 min | ~0 |
| 1 | AGENTS.md + shared contracts | 30 min | low |
| 2 | Canonical read shape (split by tool file) | 3 h | medium |
| 5 | `check_setup_status` anti-hallucination | 45 min | low |
| 6 | Security audits | 1 h | low (audit-first) |

Port-Commits 3 and 4 skipped (see §4 and §3.4).

**Stop-the-line checkpoints:**
- After Commit 1: real-session test in Cursor with
  `/get_user_story` — agent should now summarize + offer next
  actions instead of dumping the JSON blob. If not, prompt
  composition isn't reaching the agent; debug before continuing.
- After Commit 2: same test, now the structured data should be
  visible to clients that consume `structuredContent`.
- After Commit 5: run `/check_setup_status` in a degraded state
  (e.g. no PAT); verify overall + Next Actions show up.

---

## 7. Open questions for the reviewer

1. **Go / no-go on bootstrapping Vitest** — is adding a test
   framework to ado-mcp acceptable, or is this repo intentionally
   test-free? If intentionally test-free, we ship Port-Commits
   1–6 without tests and rely on manual verification.

2. **Scope cut for Commit 2** — 14 read tools is a lot. Phase it?
   Tier 1 (highest-value): `get_user_story`, `get_test_case`,
   `list_test_cases`, `get_confluence_page`. Tier 2 (rest).
   Tier 1 alone captures ~80% of the user-facing benefit.

3. **`CONFIRM_BEFORE_ACT_CONTRACT`** — does it need to be a named
   constant, or is a single paragraph in `AGENTS.md` under "User-
   initiated invocation" enough for the two tools that need it?
   Named constant = more explicit. Paragraph = less machinery.

4. **Security-audit urgency** — jira-mcp found zero real
   leaks after audit. Should we still spend the 1 h on ado-mcp,
   or defer until after Tier-1 Commit 2 ships?

5. **Distribution impact** — ado-mcp has a whole install.sh +
   vercel.json + website/ pipeline. The port touches `src/` only,
   so distribution is unaffected. Confirm: no changes to
   `build-dist.mjs`, `install.sh`, or the deployed website
   expected. Correct?

6. **Timing** — implement all at once, or one commit per session
   with review gates between? My recommendation: gate between
   commits, especially after Commit 1 (first behaviour shift) and
   Commit 2 (largest code touch).

---

## 8. Appendix — commits this proposal replaces

For reference, the 7 jira-mcp commits this port captures:

- `3a1d1fd` — Commit 1 (AGENTS.md + shared contracts)
- `aa6bcbf` — Commit 2 (structuredContent)
- `3999338` — Commit 3 (readSnapshot, skipped here)
- `f39a478` — Commit 4 (outputSchema, rolled into Commit 2 here)
- `9370e7a` — Commit 2.5 (jira_check → check_setup_status)
- `8d270e9` — Pagination audit (skipped here)
- `3eead15` — Security audits + upstream-content rule
- `9c88861` — Host-IDE tool broadening + qa_draft scaffold
  clarification (the AGENTS.md half ports; the qa_draft half does
  not apply)

Combined: ~5 h of porting effort for ~80% of the benefit jira-mcp
earned across its refactor. The remaining 20% is
ado-mcp-specific features (tc-drafts workflow, setup UI) that
already work well and don't need the lift.
