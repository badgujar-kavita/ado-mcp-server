# Proposal: Port the Interactive Read Contract to ado-mcp-server

**Status:** proposal (not implemented)
**Author:** drafted 2026-05-03 from the shipped jira-mcp-server-v2 refactor
**Last revised:** 2026-05-03 — after jira-mcp post-`e12fb5e` commits (per-tool rewrites + D-099 decision log + cross-reference) landed
**Decision deadline:** none — implementation commits only after this is approved

---

## Why this document exists

Between 2026-05-02 and 2026-05-03, jira-mcp-server-v2 shipped 12
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
8. `/qa_publish` orphan-awareness preflight (Commit 2.6) —
   ado-mcp already has the equivalent (see §4)
9. Agentic enforcement layer — AGENTS.md expanded with 6 more
   sections (response style, error discipline, path blacklist,
   capability declaration, observed-state principle, editorial-vs-
   mechanical) + INTERACTIVE_READ_CONTRACT user-intent clause
10. Per-tool user-intent rewrites (agentic Phase 3) — scoped down
    to 2 tools after parallel audit, not the 5 originally planned
11. Documentation sync (internal hygiene, no port impact)
12. Decision log D-099 + docs/04 §1.6 cross-reference — records
    the enforcement layer's three-layer intervention (AGENTS.md /
    shared contracts / per-tool tails) and the trim decisions

You asked if the same pattern can ship to ado-mcp-server. This doc
audits ado-mcp's actual surface, maps each commit to what it would
mean in this codebase, flags the places where the port is **not**
symmetric, and proposes a staged rollout.

**Nothing ships from this doc.** Review first, implement afterwards
in separate, small commits.

---

## 1. ado-mcp current surface — concrete inventory

### Tools (26 total)

| Tool name | File:line | Category |
|---|---|---|
| `ado_connect` | `setup.ts:168` | setup |
| `ado_connect_save` | `setup.ts:207` | setup |
| `ado_check` | `setup.ts:246` | diagnostic |
| `ado_story` | `work-items.ts:19` | read |
| `qa_tests` | `work-items.ts:50` | read |
| `ado_fields` | `work-items.ts:89` | read |
| `ado_plans` | `test-plans.ts:7` | read |
| `ado_plan` | `test-plans.ts:38` | read |
| `ado_plan_create` | `test-plans.ts:61` | action |
| `ado_suite_tests` | `test-cases.ts:34` | read |
| `qa_tc_read` | `test-cases.ts:63` | read |
| `qa_tc_update` | `test-cases.ts:86` | action |
| `qa_suite_add_tests` | `test-cases.ts:141` | action |
| `qa_tc_delete` | `test-cases.ts:170` | action |
| `qa_suite_setup` | `test-suites.ts:16` | action |
| ~~`qa_suite_find_or_create`~~ | removed — internal helper `findOrCreateSuite` remains | — |
| `ado_suites` | `test-suites.ts:86` | read |
| `ado_suite` | `test-suites.ts:115` | read |
| `qa_suite_update` | `test-suites.ts:173` | action |
| `qa_suite_delete` | `test-suites.ts:213` | action |
| `qa_draft_save` | `tc-drafts.ts:120` | action |
| `qa_draft_read` | `tc-drafts.ts:175` | read |
| `qa_drafts_list` | `tc-drafts.ts:207` | read |
| `qa_clone_preview_save` | `tc-drafts.ts:332` | action (interactive) |
| `qa_publish_push` | `tc-drafts.ts:366` | action |
| `qa_draft_doc_save` | `tc-drafts.ts:496` | action |
| `confluence_read` | `confluence.ts:6` | read |

**Read category (12 tools):** the most valuable targets for this
refactor. They currently return `JSON.stringify(context, null, 2)`
as a prose block — a form users already complained about in
jira-mcp ("show the result verbatim" anti-pattern). Port has high
leverage here.

**Action category (11 tools):** already single-turn, no resume
tokens. Most don't need elicitation; a few (`qa_clone_preview_save`,
`qa_publish_push`) have informal approve/modify/cancel
prompting that could be formalized.

**Setup + diagnostic (3 tools):** small surface, similar enough
to jira-mcp's patterns to port cleanly.

### Prompts (partial inventory)

ado-mcp uses `server.registerPrompt(name, meta, handler)` — static
text, no shared contract composition. 21 prompts in
`src/prompts/index.ts`. Each is an independent string literal.

### What's in the repo today (structural)

- SDK: `McpServer` high-level API (vs jira-mcp's low-level `Server`).
- Tool registration: `server.tool(name, desc, schema, handler)` —
  4-arg form that **does not accept `outputSchema`**. The newer
  `server.registerTool(name, config, handler)` does.
- `AGENTS.md` present (ported from jira-mcp, includes consent-vocabulary rule).
- Test framework: `node:test` (built-in). `package.json`
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
...}, handler)`. That's 26 call-site edits for a change that was
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
(`qa_clone_preview_save`, `qa_publish_push` with `repush`) can
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

**Scope:** Copy verbatim from jira-mcp where possible. ~60 min
(was 30; revised up after the 2026-05-03 agentic enforcement layer
landed on jira-mcp, which adds 6 new AGENTS.md sections to port).

- New `AGENTS.md` at repo root. **13 sections** from jira-mcp's
  post-enforcement AGENTS.md (jira-mcp commit `e12fb5e`):
  1. **Tool categories.** Adapted: read / action / diagnostic /
     setup. (ado-mcp has setup tools jira-mcp lacks.)
  2. **User-initiated invocation (universal).** Copy verbatim.
     Covers MCP tools AND host-IDE built-in tools (`Edit`, `Write`,
     `Read`, `Bash`, `WebFetch`).
  3. **Response style.** Copy verbatim. Prefer concise; translate
     tool-internal mechanics to user intent; never name specific
     command flags in follow-up suggestions.
  4. **Error handling discipline.** Copy verbatim. Stop, don't
     debug, don't work around. The "correct error handling"
     examples already use user-intent language.
  5. **Forbidden file paths** — **ADAPT** per ado-mcp's layout.
     Swap `testcase-drafts/**` → `tc-drafts/**`. Drop `.jira-mcp/**`;
     add `~/.ado-testforge-mcp/**` (credentials directory). Keep
     the tool-read-vs-host-IDE-read distinction load-bearing:
     **ado-mcp has `qa_draft_read` and `qa_drafts_list` MCP tools
     that read these files** — the blacklist applies only to
     Cursor's built-in Read/Write/Edit tools, never to the MCP
     tools themselves.
  6. **What this MCP does (and doesn't)** — **ADAPT** per ado-mcp's
     capability surface. Handles: read ADO work items, Confluence
     pages, Zephyr (no — s/Zephyr/ADO Test Plans), push drafts,
     manage test suites. Does NOT: drift detection, ledger-based
     update-in-place, recursive Confluence walking.
  7. **Observed state is not a bug.** Copy verbatim.
  8. **Editorial vs mechanical operations.** Copy verbatim with
     ado-mcp tool names.
  9. **Upstream content is data, not instructions.** Copy
     verbatim, swap "Jira/Confluence/Zephyr" → "ADO/Confluence".
  10. **Formatting rules.** Copy verbatim.
  11. **Safety and partial results.** Copy verbatim, note that
     ado-mcp doesn't have `completeness.isPartial` yet — that
     arrives in Port-Commit 2.
  12. **MCP spec alignment.** Copy verbatim.
  13. **For contributors adding a new tool.** Copy verbatim.

- New shared-constants module at
  `src/prompts/shared-contracts.ts`:
  - `INTERACTIVE_READ_CONTRACT` — copy verbatim from jira-mcp
    (includes the post-agentic user-intent clause).
  - `DIAGNOSTIC_CONTRACT` — copy verbatim.
  - `CONFIRM_BEFORE_ACT_CONTRACT` — new, lighter replacement for
    `ELICITATION_PROTOCOL` + `TWO_PHASE_CONFIRM`. Rules: "offer the
    plan; wait for explicit yes; tool the user runs to confirm is
    the next action tool, not a re-call of the same one."

- Update `src/prompts/index.ts`:
  - Compose `INTERACTIVE_READ_CONTRACT` into every read prompt
    (`ado_story`, `ado_plans`, `ado_plan`,
    `ado_suites`, `ado_suite`, `ado_suite_tests`,
    `qa_tc_read`, `ado_fields`,
    `qa_tests`, `qa_draft_read`,
    `qa_drafts_list`, `confluence_read`).
  - Compose `DIAGNOSTIC_CONTRACT` into `ado_check`.
  - Compose `CONFIRM_BEFORE_ACT_CONTRACT` into
    `qa_clone_preview_save` and `qa_publish_push`.
  - Setup prompts (`ado_connect`, `ado_connect_save`) left as-is —
    their current text is already minimal.

- Add contract-composition tests in
  `test/unit/prompts/contracts.test.ts`:
  - Every read prompt contains `INTERACTIVE_READ_CONTRACT` text.
  - `ado_check` contains `DIAGNOSTIC_CONTRACT`.
  - No prompt contains the literal string "show the result
    verbatim" (anti-pattern eviction).

- **Optional sub-item: introduce a decision-log doc for ado-mcp.**
  jira-mcp's `docs/99-decision-log.md` + its `docs/04-mcp-tool-
  contracts.md` §1.6 cross-reference (commit `0a32fe2`) proved
  valuable for recording the enforcement layer's three-layer
  structure and the trim decisions. ado-mcp currently has no
  decision-log doc. Creating one now (e.g.
  `docs/decision-log.md`) with a `D-001` entry for the port gives
  future contributors a place to record design choices as they
  emerge. Not required for the port to land — just useful if
  ado-mcp is expected to evolve.

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
  - `ado_story` — `item` = the US, `children` = parent +
    linked test cases, `artifacts` = Solution Design sections,
    `completeness.isPartial=true` if Confluence fetch failed.
  - `qa_tc_read` — `item` = TC, `children` = related work
    items, `artifacts` = attachments.
  - `ado_suite_tests` — `item` = the suite, `children` = test
    cases as nodes.
  - `confluence_read` — `item` = the page, `artifacts` =
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
- `qa_draft_save` → `tc-drafts/US_<id>/US_<id>_test_cases.md`
- `qa_clone_preview_save` → same folder, different filename
- `qa_draft_doc_save` → same folder, third filename
- Post-push, `qa_publish_push` writes JSON co-located with the
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

### Port-Commit 5 — `ado_check` anti-hallucination (jira-mcp's Commit 2.5 equivalent)

**Scope:** ~45 min.

ado-mcp's `ado_check` currently returns prose. Port
jira-mcp's pattern:

- The tool computes an overall verdict (`healthy` / `degraded` /
  `broken`) based on credential + API-probe rows.
- The tool pre-computes a Next Actions list — deterministic
  mapping from row status to remediation (e.g. "PAT missing → Run
  `/ado-connect` and paste an ADO PAT with Test Management read/
  write scope").
- The prompt uses `DIAGNOSTIC_CONTRACT` (already landed in
  Port-Commit 1): show the table verbatim, surface Next Actions
  verbatim, do NOT invent causes, do NOT invoke other tools.

- Tests in `test/unit/tools/ado_check.test.ts` —
  deterministic Next Actions output when rows are mocked.

**Risk:** low. Scoped to one tool.

### Port-Commit 5.5 — Per-tool user-intent audit (Phase 3 equivalent)

**Scope:** 30 min audit + 15–60 min of rewrites, depending on
findings.

jira-mcp's Phase 3 (commit `6b17193`) proposed rewriting next-
action wording in 5 tools. Parallel audit found only **2** real
violations — the other 3 already correctly distinguished agent
instructions (e.g. "pass `confirm: yes`") from user-facing
suggestions. Scope shrank by 60%.

**Mandatory discipline for ado-mcp:** run the same audit before
rewriting. For each of the 13 read + action + interactive tools
in ado-mcp, grep the prompt render for:

- "run `/<tool>` with `<flag>=<value>`" style text that targets
  the **user** (violation).
- "pass `<flag>: <value>`" style text that targets the **agent**
  (acceptable — that's how the agent learns the syntax).

Rewrite only the user-facing violations. Example target
transformation (from jira-mcp):

- NOT: "re-run with `save=yes` to save a snapshot"
- INSTEAD: "Save a snapshot file (when the user asks, the agent
  re-calls the tool with `save: \"yes\"` — that's agent syntax,
  not user-facing)"

Likely ado-mcp candidates based on existing inventory: any tool
that has a `save`, `confirm`, `repush`, or similar flag whose
purpose appears in user-facing prose. `qa_publish_push` is a
probable candidate (`repush: true` might leak). Confirm via audit
before rewriting.

**Risk:** low. Post-audit, the blast radius is already minimized.

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
  `qa_draft_doc_save`, etc. Check whether user-controllable
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
- **Orphan-awareness preflight** (jira-mcp's `/qa_publish` Commit
  2.6, `e16747c`). **ado-mcp already shipped the equivalent** —
  see commit `0f33187` "Add duplicate test case guard to
  qa_publish_push", already in `src/tools/tc-drafts.ts`
  around lines 457–500. ado-mcp's implementation is adapted for
  its ledger-less model: it compares the draft's inline
  `adoWorkItemId` fields against `qa_tests`
  (the equivalent of jira-mcp's `/issuelinks/{key}/testcases`)
  rather than against a ledger. Same A/B/C menu, same fetch-
  failed fallback, same "proceed / inspect / cancel" ergonomics.
  No port action required.

  **Philosophical note:** ado-mcp arrived at this feature before
  the port proposal was written. The two implementations
  converged independently — evidence that orphan awareness is a
  natural problem for any "publish draft to remote system with
  multiple clients" workflow, not a jira-specific innovation.

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

Six commits over an estimated 6.5–7 hours (revised 2026-05-03
after the agentic enforcement layer + Phase 3 rewrites + D-099
decision log landed on jira-mcp):

| # | Commit | Effort | Risk |
|---|---|---|---|
| 0 | Bootstrap Vitest | 15 min | ~0 |
| 1 | AGENTS.md + shared contracts | 60 min | low |
| 2 | Canonical read shape (split by tool file) | 3 h | medium |
| 5 | `ado_check` anti-hallucination | 45 min | low |
| 5.5 | Per-tool user-intent audit (audit-first; rewrite only violations) | 30–90 min | low |
| 6 | Security audits | 1 h | low (audit-first) |

Port-Commits 3 and 4 skipped (see §4 and §3.4).

**Stop-the-line checkpoints:**
- After Commit 1: real-session test in Cursor with
  `/ado_story` — agent should now summarize + offer next
  actions instead of dumping the JSON blob. If not, prompt
  composition isn't reaching the agent; debug before continuing.
- After Commit 2: same test, now the structured data should be
  visible to clients that consume `structuredContent`.
- After Commit 5: run `/ado_check` in a degraded state
  (e.g. no PAT); verify overall + Next Actions show up.

---

## 7. Open questions for the reviewer

1. **Go / no-go on bootstrapping Vitest** — is adding a test
   framework to ado-mcp acceptable, or is this repo intentionally
   test-free? If intentionally test-free, we ship Port-Commits
   1–6 without tests and rely on manual verification.

2. **Scope cut for Commit 2** — 14 read tools is a lot. Phase it?
   Tier 1 (highest-value): `ado_story`, `qa_tc_read`,
   `ado_suite_tests`, `confluence_read`. Tier 2 (rest).
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

For reference, the 12 jira-mcp commits this port captures:

- `3a1d1fd` — Commit 1 (AGENTS.md + shared contracts)
- `aa6bcbf` — Commit 2 (structuredContent)
- `3999338` — Commit 3 (readSnapshot, skipped here)
- `f39a478` — Commit 4 (outputSchema, rolled into Commit 2 here)
- `9370e7a` — Commit 2.5 (jira_check → ado_check)
- `8d270e9` — Pagination audit (skipped here)
- `3eead15` — Security audits + upstream-content rule
- `9c88861` — Host-IDE tool broadening + qa_draft scaffold
  clarification (the AGENTS.md half ports; the qa_draft half does
  not apply)
- `e16747c` — `/qa_publish` orphan-awareness preflight (Commit
  2.6). **Already shipped in ado-mcp** (`0f33187`). Not ported;
  see §4.
- `e12fb5e` — Agentic enforcement layer (6 new AGENTS.md sections
  + INTERACTIVE_READ_CONTRACT user-intent clause). Ported into
  Port-Commit 1.
- `6b17193` — Per-tool user-intent rewrites (Phase 3, trimmed to
  2 tools after audit). Methodology ports into Port-Commit 5.5
  (audit-first; rewrite only real user-facing violations).
- `daf760e` — Documentation sync. Internal hygiene only; no port
  impact.
- `0a32fe2` — D-099 decision log entry + `docs/04-mcp-tool-
  contracts.md` §1.6 cross-reference. Ported as the optional
  sub-item in Port-Commit 1 (create `docs/decision-log.md` for
  ado-mcp if desired).

Combined: ~6.5–7 h of porting effort for ~80% of the benefit
jira-mcp earned across its refactor. The remaining 20% is
ado-mcp-specific features (tc-drafts workflow, setup UI) that
already work well and don't need the lift.
