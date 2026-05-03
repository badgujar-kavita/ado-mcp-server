---
name: ADO MCP Relabel to Hybrid Naming Convention
overview: "Rename all user-facing slash commands to kebab-case, rename all MCP tools to snake_case (matching prompt names 1:1), and rename 3 skills to the qa-* family. CLEAN BREAK — no deprecation aliases, because the MCP is not yet distributed to external users. Covers 23 user-facing prompts + 32 tools + 3 skills + every internal reference in tests, docs, skills, rules, prompt bodies, AGENTS.md, and the Vercel website."
todos:
  - id: phase1-prompts
    content: "Phase 1: Rename 23 prompt registrations in src/prompts/index.ts to kebab-case (clean rename, no aliases)"
    status: pending
  - id: phase1-tools
    content: "Phase 1: Rename 32 tool registrations across src/tools/*.ts to snake_case under the new hybrid convention (clean rename, no aliases)"
    status: pending
  - id: phase2-internal-refs
    content: "Phase 2: Update every internal reference to old tool/prompt names inside prompt bodies (src/prompts/index.ts text), tool descriptions, and tc-drafts tool descriptions"
    status: pending
  - id: phase3-skills-rename
    content: "Phase 3: Rename the 3 skill directories (draft-test-cases-salesforce-tpm, test-case-asset-manager, update-test-case-prerequisites) to the qa-* family and update SKILL.md content/cross-references"
    status: pending
  - id: phase3-skill-refs
    content: "Phase 3: Update every reference to the 3 old skill paths in prompts, rules, docs, and the README"
    status: pending
  - id: phase4-docs
    content: "Phase 4: Update docs/*.md, docs/changelog.md, README.md, AGENTS.md, and website/public/index.html (1 reference at line 951) to reflect new names"
    status: pending
  - id: phase4-5-test
    content: "Phase 4.5: Smoke-test — npm run build + npm test, restart MCP server, list prompts+tools via MCP client, verify exactly 23 prompts + 32 tools (no old names), run end-to-end workflow"
    status: pending
  - id: phase5-deploy
    content: "Phase 5: npm run deploy (per workspace rule), verify distribution bundle ships both sets of names; announce the rename in the release notes"
    status: pending
isProject: true
---

# ADO MCP Relabel to Hybrid Naming Convention

**Priority:** High — user-facing surface change. Blocks on /qa-publish muscle memory and cross-MCP consistency with jira-mcp-server-v2.
**Estimated Effort:** Medium — high file count, mostly string replacements. ~15 files touched across 5 phases.
**Scope:** Naming only. No behavioral changes. No new tools, no dropped tools, no merged tools.

---

## Problem Statement

The ADO MCP's current names were chosen ad-hoc before the team adopted naming conventions:

1. **Mixed styles on the user-facing surface:** `configure` (bare), `get_user_story` (snake), `ensure_suite_hierarchy_for_us` (verbose snake). New users can't predict command names.
2. **No shared convention with the companion MCP.** `jira-mcp-server-v2` has already shipped 9 cohesive slash commands (`/jira_connect`, `/qa_draft`, `/confluence_read`). ADO's names don't match, so QA engineers using both MCPs juggle two mental models.
3. **Skill names leak customer specifics.** `draft-test-cases-salesforce-tpm` carries a single-customer suffix in the name — unprofessional for external audiences.
4. **Under-specified verbs.** `create_test_cases` actually does draft-if-missing + review-gate + push-on-YES — the name describes neither the draft path nor the review gate.

The goal is to adopt a **hybrid industry-standard convention** that keeps surfaces consistent within themselves and parallel across surfaces.

## End-user Context

**Target audience (per previous decision):** QA community + technology leaders. Cross-product consistency matters — a leader evaluating both MCPs sees them as a coherent suite, not as two ad-hoc tools.

**Related decision (locked in prior conversation):** jira-mcp-server-v2 will follow later under the same convention. ADO goes first because its inconsistencies are more severe and it has fewer external users.

---

## Design Decisions (Locked In Before Implementation)

| Decision | Chosen | Rationale |
|---|---|---|
| Slash-command convention | **kebab-case** (`/qa-draft`, `/ado-connect`) | Matches Claude Code built-ins (`/security-review`), Cursor, GitHub CLI, every major CLI from the last 20 years. Slash commands are a user surface; underscores are an API-identifier artifact. |
| MCP tool convention | **snake_case** (`qa_draft`, `ado_connect`) | Matches ~80% of the MCP ecosystem (GitHub MCP, Filesystem MCP, Slack MCP). Tool names appear in permission rules, logs, error messages — snake_case is the API norm. |
| Skill convention | **kebab-case** | Already Claude Code's standard. Existing skills are kebab; only the names change. |
| Config JSON keys | **camelCase** — no change | Already the convention in `conventions.config.json`. JS/TS ecosystem default. |
| Prompt ↔ tool parallel | **1:1 name parity** (`qa-draft` prompt ↔ `qa_draft` tool) | The only transformation is case style. Makes it trivial for humans and LLMs to correlate. |
| Domain prefix rule | **`ado-*`** for raw ADO data access; **`qa-*`** for QA workflow; **`confluence-*`** for Confluence | See Design Decisions addendum below for the rule definition with examples. |
| Deprecation policy | **Clean break — no aliases** | The MCP is not yet distributed to external users. There are no in-flight scripts, no saved Cursor templates, no user muscle memory to protect. Dual-registration adds dead code with zero benefit. Rename atomically in one PR. |
| Tool-name scope | **All 32 tools**, not just the 23 slash-backed ones | Internal tools benefit equally from consistent naming for grep, permission rules, and logs. |
| Skill rename scope | **All 3 skills** | Customer-name leak in `draft-test-cases-salesforce-tpm` is the single biggest cleanup win; others align for consistency. |
| MCP server slug | **No change** (`ado-testforge-mcp` → `ado-testforge-mcp`) | User is still deciding; rename independently in a later plan if desired. |
| jira-mcp-server-v2 changes | **Out of scope** | Separate plan later. One step at a time. |

### Domain prefix rule (the `ado-*` vs `qa-*` call)

| Prefix | When to use | Examples |
|---|---|---|
| **`ado-*`** | Raw ADO read/write primitive with no QA-workflow semantics. Caller decides what to do with the result. | `/ado-story`, `/ado-fields`, `/ado-plans`, `/ado-connect`, `/ado-check` |
| **`qa-*`** | Part of the test-case lifecycle (draft → review → publish → maintain). Domain-neutral — reusable across Jira/GitHub/etc. | `/qa-draft`, `/qa-publish`, `/qa-tests`, `/qa-suite-setup-auto`, `/qa-tc-update` |
| **`confluence-*`** | Confluence-specific. | `/confluence-read` |

**Test:** if a command serves the QA test-case lifecycle, it's `qa-*`. If it exists to expose raw platform data regardless of purpose, it's `ado-*` or `confluence-*`.

---

## Scope — What This Plan Covers

### In scope
- 23 user-facing slash-command prompt renames (src/prompts/index.ts)
- 32 tool renames across `src/tools/*.ts` (including test files `src/**/*.test.ts`)
- 3 skill directory renames + SKILL.md body updates
- Every internal reference to old names in prompts, tools, docs, skills, rules, README, AGENTS.md
- One website example reference at `website/public/index.html:951`
- Rebuild of `dist-package/` via `npm run build:dist` (pre-built artifact, regenerates from source)
- Changelog entry documenting the rename
- Deploy step (mandatory per workspace rule)

### Explicitly out of scope
- **MCP server slug** (`ado-testforge-mcp` unchanged in this plan — separate decision)
- **jira-mcp-server-v2** — separate plan later
- **Any behavioral change** to existing tools/prompts — rename only, no new args, no new code paths
- **Source filenames** (`src/tools/*.ts`) — already kebab-case, no rename
- **Doc filenames** (`docs/*.md`) — already kebab-case, no rename
- **Plan filenames** (`.cursor/plans/*.plan.md`) — keep existing snake_case convention

---

## Current State (File Anchors)

| Concern | Path | Lines |
|---|---|---|
| All 23 prompt registrations | `src/prompts/index.ts` | Full file (~408 lines) |
| Tools — work items (3 tools) | `src/tools/work-items.ts` | 85, 128, 174 |
| Tools — test cases (5 tools) | `src/tools/test-cases.ts` | 43, 78, 110, 165, 194 |
| Tools — test plans (3 tools) | `src/tools/test-plans.ts` | 8, 39, 62 |
| Tools — test suites (7 tools) | `src/tools/test-suites.ts` | 17, 38, 61, 87, 116, 141, 174, 213 |
| Tools — tc-drafts (6 tools) | `src/tools/tc-drafts.ts` | 139, 194, 250, 375, 409, 585 |
| Tools — setup (3 tools) | `src/tools/setup.ts` | 289, 328, 367 |
| Tools — confluence (1 tool) | `src/tools/confluence.ts` | 38 |
| Skills | `.cursor/skills/draft-test-cases-salesforce-tpm/` `.cursor/skills/test-case-asset-manager/` `.cursor/skills/update-test-case-prerequisites/` | — |
| Rules | `.cursor/rules/deploy-after-changes.mdc` `.cursor/rules/test-case-draft-formatting.mdc` | no rename, body refs may need update |
| Docs with tool/prompt references | `docs/*.md`, `README.md` | multiple |

---

## Complete Rename Tables

### Table A1 — 23 slash-command prompts (user-facing, kebab-case)

| # | Current prompt | New slash command |
|---|---|---|
| 1 | `configure` | `/ado-connect` |
| 2 | `check_status` | `/ado-check` |
| 3 | `get_user_story` | `/ado-story` |
| 4 | `list_work_item_fields` | `/ado-fields` |
| 5 | `get_confluence_page` | `/confluence-read` |
| 6 | `list_test_plans` | `/ado-plans` |
| 7 | `get_test_plan` | `/ado-plan` |
| 8 | `list_test_suites` | `/ado-suites` |
| 9 | `get_test_suite` | `/ado-suite` |
| 10 | `list_test_cases` | `/ado-suite-tests` |
| 11 | `draft_test_cases` | `/qa-draft` |
| 12 | `create_test_cases` | `/qa-publish` |
| 13 | (none today — `list_test_cases_linked_to_user_story` is a tool only; add a matching prompt) | `/qa-tests` |
| 14 | `clone_and_enhance_test_cases` | `/qa-clone` |
| 15 | `ensure_suite_hierarchy_for_us` | `/qa-suite-setup-auto` |
| 16 | `ensure_suite_hierarchy` | `/qa-suite-setup-manual` |
| 17 | `create_test_suite` | `/qa-suite-create` |
| 18 | `update_test_suite` | `/qa-suite-update` |
| 19 | `delete_test_suite` | `/qa-suite-delete` |
| 20 | `get_test_case` | `/qa-tc-read` |
| 21 | `update_test_case` | `/qa-tc-update` |
| 22 | `delete_test_case` | `/qa-tc-delete` |
| 23 | `delete_test_cases` | `/qa-tc-bulk-delete` |

### Table A2 — 32 MCP tools (backend, snake_case)

**A2.1 — Tools backing slash commands (name = slash command with `-` → `_`):**

| # | Current tool | New tool |
|---|---|---|
| 1 | `configure` | `ado_connect` |
| 2 | `check_setup_status` | `ado_check` |
| 3 | `get_user_story` | `ado_story` |
| 4 | `list_work_item_fields` | `ado_fields` |
| 5 | `get_confluence_page` | `confluence_read` |
| 6 | `list_test_plans` | `ado_plans` |
| 7 | `get_test_plan` | `ado_plan` |
| 8 | `list_test_suites` | `ado_suites` |
| 9 | `get_test_suite` | `ado_suite` |
| 10 | `list_test_cases` | `ado_suite_tests` |
| 11 | `list_test_cases_linked_to_user_story` | `qa_tests` |
| 12 | `ensure_suite_hierarchy_for_us` | `qa_suite_setup_auto` |
| 13 | `ensure_suite_hierarchy` | `qa_suite_setup_manual` |
| 14 | `create_test_suite` | `qa_suite_create` |
| 15 | `update_test_suite` | `qa_suite_update` |
| 16 | `delete_test_suite` | `qa_suite_delete` |
| 17 | `get_test_case` | `qa_tc_read` |
| 18 | `update_test_case` | `qa_tc_update` |
| 19 | `delete_test_case` | `qa_tc_delete` |

**A2.2 — Internal tools (not exposed as slash commands):**

| # | Current tool | New tool | Called by |
|---|---|---|---|
| 20 | `setup_credentials` | `ado_connect_save` | configure UI POST handler |
| 21 | `save_tc_draft` | `qa_draft_save` | `/qa-draft`, `/qa-publish`, `/qa-clone` prompts |
| 22 | `get_tc_draft` | `qa_draft_read` | `/qa-publish` prompt |
| 23 | `list_tc_drafts` | `qa_drafts_list` | `/qa-publish` prompt |
| 24 | `save_tc_supporting_doc` | `qa_draft_doc_save` | `/qa-draft` prompt |
| 25 | `save_tc_clone_preview` | `qa_clone_preview_save` | `/qa-clone` prompt |
| 26 | `push_tc_draft_to_ado` | `qa_publish_push` | `/qa-publish` prompt |
| 27 | `find_or_create_test_suite` | `qa_suite_find_or_create` | internal helper for hierarchy setup |
| 28 | `add_test_cases_to_suite` | `qa_suite_add_tests` | `/qa-publish` internal |
| 29 | `create_test_plan` | `ado_plan_create` | standalone admin tool (no slash command today) |

**A2.3 — Remaining untracked tools:** if scan finds tools not in this table during Phase 1b, add them to the plan rather than renaming on the fly. The goal is zero surprises.

### Table B — 3 skills (kebab-case, already kebab, content rename)

| # | Current directory | New directory | Also update inside SKILL.md |
|---|---|---|---|
| 1 | `draft-test-cases-salesforce-tpm` | `qa-test-drafting` | Name, references to tool names, title heading, any salesforce-tpm strings in body that are now generic |
| 2 | `test-case-asset-manager` | `qa-test-assets` | Name, tool-name references, title heading |
| 3 | `update-test-case-prerequisites` | `qa-tc-prerequisites` | Name, tool-name references, title heading |

### Table C — NO renames

- `deploy-after-changes.mdc` rule — generic, keep as-is
- `test-case-draft-formatting.mdc` rule — content-specific, keep as-is
- All `src/tools/*.ts` filenames — already kebab-case, unchanged
- All `docs/*.md` filenames — already kebab-case, unchanged
- All config JSON keys — already camelCase, unchanged
- All plan filenames — snake_case convention preserved

---

## Phase 1 — Core Renames with Deprecation Aliases

### 1a. Rename 23 prompts (`src/prompts/index.ts`)

For each prompt in Table A1:
1. Change the `server.registerPrompt(...)` first-arg string to the new kebab-case name.
2. Inside the prompt's returned `text`, update any self-references (e.g. a prompt that says "use /ado-testforge/create_test_cases" now says "/qa-publish"; a prompt that says "call save_tc_draft" now says "call qa_draft_save").
3. No old-name registrations left behind. Clean replacement.

### 1b. Rename 32 tools (`src/tools/*.ts`)

For each tool in Table A2:
1. Change the `server.tool(...)` first-arg name string to the new snake_case name.
2. Update all cross-references in tool descriptions (e.g. `"Use find_or_create_test_suite"` → `"Use qa_suite_find_or_create"`).
3. Update tool-name mentions in error messages if any.
4. No change to Zod input schemas or handler bodies.
5. No old-name registrations left behind. Clean replacement.

### 1c. Add the one missing prompt

`/qa-tests` has no current prompt (today, `list_test_cases_linked_to_user_story` is a tool-only capability). Add a new prompt registration following the same pattern as other `list_*` prompts, wired to the renamed `qa_tests` tool.

---

## Phase 2 — Internal Reference Cleanup

### 2a. Test files (`src/**/*.test.ts`)

Any test that constructs `server.tool(...)` or asserts tool names by string (`expect(tool.name).toBe("draft_test_cases")` style) must update. The audit found **49 references across 8 test files** — main hotspots:
- `src/tools/tc-drafts.test.ts` (15 refs)
- `src/tools/read-canonical.test.ts` (7 refs)
- `src/tools/test-plans.test.ts` (7 refs)
- `src/tools/test-suites.test.ts` (8 refs)
- `src/tools/work-items.test.ts` (8 refs)
- `src/prompts/contracts.test.ts`
- `src/tools/setup.test.ts` (2 refs)

**Running tests before + after rename is the safety net** — any missed rename surfaces as a test failure.

### 2b. Inside prompt bodies (`src/prompts/index.ts`)

Many prompts reference other tools/prompts by name in their instruction text — these all need updating. Examples from current code:

- Line 232: `"10. Remind the user: 'Plan ID will be auto-derived from the User Story when you push. Provide feedback for revisions, or run /ado-testforge/create_test_cases when ready to push to ADO.'"` → `run /ado-testforge/qa-publish`
- Line 234: `"12. NEVER call push_tc_draft_to_ado from this prompt — that is only via create_test_cases."` → `NEVER call qa_publish_push from this prompt — that is only via /qa-publish.`
- Line 256: `"(a) call save_tc_draft for main test cases..."` → `"(a) call qa_draft_save for main test cases..."`
- Line 258, 259, 261: every `push_tc_draft_to_ado` reference → `qa_publish_push`
- Line 375, 383, 385: clone prompt references → updated tool names
- Line 149: `"Use ensure_suite_hierarchy_for_us"` → `"Use qa_suite_setup_auto"`
- Every reference to `save_tc_supporting_doc` → `qa_draft_doc_save`
- Every reference to `get_tc_draft` / `list_tc_drafts` → `qa_draft_read` / `qa_drafts_list`

**Strategy:** grep every tool name in `src/prompts/index.ts`, cross-check against Table A2, replace.

### 2c. Inside tool descriptions

Some tool descriptions cross-reference other tools (e.g. `create_test_suite` says "Use find_or_create_test_suite if you need to find-or-create"). Update all such cross-references in `src/tools/*.ts`:

- `src/tools/test-suites.ts:142` — `"Use find_or_create_test_suite if you need to find-or-create."` → `"Use qa_suite_find_or_create if you need to find-or-create."`
- Any other tool description that names another tool — sweep with grep.

### 2d. Tool handler error messages

Some handlers include the old tool name in error text. Update so errors reference the new canonical name.

### 2e. `AGENTS.md` (33 references)

Top-level agent guidance file referencing tools and prompts by name. Full sweep + replace against Tables A1 and A2.

---

## Phase 3 — Skill Renames

### 3a. Rename directories

```bash
mv .cursor/skills/draft-test-cases-salesforce-tpm   .cursor/skills/qa-test-drafting
mv .cursor/skills/test-case-asset-manager           .cursor/skills/qa-test-assets
mv .cursor/skills/update-test-case-prerequisites    .cursor/skills/qa-tc-prerequisites
```

### 3b. Update SKILL.md content

For each renamed skill:
1. Update the top-level `name:` / `title:` in YAML frontmatter (if any).
2. Update any prose self-reference.
3. Update tool-name references in the body (e.g. "Call `save_tc_draft`" → "Call `qa_draft_save`").
4. For `qa-test-drafting`: strip residual `salesforce-tpm` / `Salesforce-TPM` references from the body — the skill should read as a **generic QA drafting skill** with Salesforce examples, not as a Salesforce-only skill. Any project-specific terminology moves to a configurable section.

### 3c. Update skill-path references elsewhere

Places that reference the old skill paths:
- `src/prompts/index.ts` — prompts reference skills like `.cursor/skills/draft-test-cases-salesforce-tpm/SKILL.md`. Update all paths.
- `docs/*.md` — scan for old skill names.
- `README.md` — skill references.
- `.cursor/rules/*.mdc` — if any rule references a skill path.
- `AGENTS.md` / `CLAUDE.md` (if present) — scan.

---

## Phase 4 — Docs + Rollout Communication

### 4a. Update `docs/*.md` and `README.md`

Replace every old name with its new name across (reference counts from audit):
- `docs/implementation.md` (70 refs) — tool usage examples
- `docs/setup-guide.md` (39 refs) — setup commands (`/configure` → `/ado-connect`)
- `docs/testing-guide.md` (62 refs) — the "tool quick-reference table" is a key target; rewrite with new names
- `docs/changelog.md` (79 refs) — historical entries reference old names; update where they describe capabilities, leave truly historical references intact
- `docs/distribution-guide.md` — any slash-command examples
- `docs/user-setup-guide.md` — user-facing commands
- `docs/version-management.md` — changelog pointers
- `docs/repush-workflow.md` — workflow docs
- `docs/tc-style-guide-and-consistency-strategy.md` — references
- `docs/plan-enhanced-context-and-interactive-workflow.md` — references
- `docs/ado-mcp-port-proposal.md` — references
- `docs/test-case-pattern-analysis-gpt-dhub.md`, `docs/test-case-writing-style-reference.md` — references
- `README.md` (9 refs) — top command table + install example

### 4b. `website/public/index.html` (1 reference)

Line 951 contains `/ado-testforge/get_user_story US-12345` as an example. Update to `/ado-testforge/ado-story US-12345`.

### 4c. `docs/changelog.md` — Rename entry

Single entry, **not** flagged as Breaking (pre-distribution — no users to break):

```markdown
## vX.Y.0 — Naming Convention Overhaul

All 23 slash commands and 32 MCP tools have been renamed to a new hybrid
convention:
- **Slash commands:** kebab-case (`/qa-draft`, `/ado-connect`)
- **MCP tools:** snake_case (`qa_draft`, `ado_connect`)
- **Skills:** kebab-case with the `qa-*` family for QA-workflow skills
- **Prefixes:** `ado-*` for raw ADO primitives, `qa-*` for QA lifecycle, `confluence-*` for Confluence

Prompt and tool names stay in 1:1 parity (`qa-draft` prompt ↔ `qa_draft` tool).

This is a clean rename — the MCP was not yet distributed, so no backward-
compatibility aliases were needed.

### Added
- `/qa-tests` slash command (previously tool-only as `list_test_cases_linked_to_user_story`).

### Renamed — prompts
[See full Table A1 in ado_mcp_relabel_to_hybrid_convention.plan.md]

### Renamed — tools
[See full Tables A2.1 and A2.2 in the plan]

### Renamed — skills
- `draft-test-cases-salesforce-tpm` → `qa-test-drafting` (also: body rewrite to remove customer-specific references)
- `test-case-asset-manager` → `qa-test-assets`
- `update-test-case-prerequisites` → `qa-tc-prerequisites`
```

### 4d. Rebuild `dist-package/`

```bash
npm run build:dist
```

`dist-package/` is a pre-built artifact. Running this regenerates `dist/index.js`, copies renamed skills, copies updated docs. Any old-name references inside `dist-package/` are resolved by the rebuild — do not hand-edit files inside `dist-package/`.

---

## Phase 4.5 — Smoke Test

Before deploying, verify the rename end-to-end:

1. `npm run build` — TypeScript compiles cleanly; no missing-tool references.
2. `npm test` — all existing tests pass. Any old-name string assertion that wasn't renamed surfaces here.
3. Restart the MCP server (stop / start in Cursor).
4. Via MCP client:
   - `listPrompts()` — confirm exactly 23 entries (no old names present).
   - `listTools()` — confirm exactly 32 entries (no old names present).
   - Call `/qa-draft` on a known US → produces the same draft output as the pre-rename `/draft_test_cases` did.
   - Attempt to call `/draft_test_cases` — should return "Unknown prompt" (verifies clean break).
   - Call a renamed skill path from a prompt — verify it resolves.
5. Grep pass: `git grep -nE '(draft_test_cases|create_test_cases|push_tc_draft_to_ado|save_tc_draft|ensure_suite_hierarchy|get_user_story|list_test_plans|get_test_plan|ensure_suite_hierarchy_for_us)' -- ':!.cursor/plans/'` should return ZERO matches (plans are historical records, excluded).
6. Run a known end-to-end workflow: `/qa-draft <ID>` → review → `/qa-publish <ID>` → confirm test cases land in ADO identically to pre-rename.

**If the smoke test reveals leftover old references:** fix before deploy. Don't ship a partial rename.

**Rollback plan:** single `git revert` of the rename commit — no schema migrations, no data changes, no keychain migrations.

---

## Phase 5 — Deploy

### 5a. Bundle + deploy

```bash
npm run build:dist
npm run deploy
```

Per `.cursor/rules/deploy-after-changes.mdc` — mandatory after touching any MCP tool, prompt, or skill.

### 5b. Release notes

In the Vercel install page or distribution artifact README, document the new command names clearly for first-time users.

---

## Guardrails (Cross-Cutting)

| Concern | Rule |
|---|---|
| Scope discipline | Rename-only. No bug fixes, tool merges, param changes, or new features ride along. If you find a bug during the rename, log it and fix in a separate PR. |
| Atomicity | Everything ships in ONE commit / one PR. A half-renamed codebase compiles fine but produces runtime "Unknown tool" errors inside prompt-driven workflows. |
| Case consistency | kebab-case for human surfaces (slash commands, skill dirs, file names); snake_case for tool names; camelCase for config keys. These are the ONLY three cases used. |
| Idempotency of this plan | Re-running the rename on an already-renamed codebase should be a no-op. Plan must not introduce double-renames. |
| Skill content-parity | Rename the skill directory AND update cross-references in the same commit — no "half-renamed skill" state. |
| Docs lag | Docs update in Phase 4 happens in the SAME PR as the code rename. |
| Historical plans | Do NOT rename names inside `.cursor/plans/*.plan.md`. Plans are historical design records — rewriting them revises history. Grep verification excludes `.cursor/plans/`. |
| Rollback | `git revert` of the single rename commit. No schema migrations, no data changes, no keychain migrations. |

---

## Impact

**Pre-distribution status:** The ADO MCP has not yet been distributed to external users. No in-flight scripts, no saved Cursor templates, no user muscle memory to protect. This is why a clean break is the right call — deprecation aliases are dead code when no one's depending on the old names.

**What changes on this PR:**
- 23 slash commands → new kebab-case names. Old names stop working immediately.
- 32 tools → new snake_case names. Old names stop working immediately.
- 3 skills → new directory names. Old paths stop resolving.
- Zero behavioral changes — same drafts, same push behavior, same folder layouts, same error messages, same config.

**What does NOT change:**
- `conventions.config.json` — zero old-name references; config untouched.
- `tc-drafts/US_<id>/` folder format — preserved bit-for-bit.
- `install.sh` / `uninstall.sh` — audit found no tool-name references.
- `vercel.json` — audit found no tool-name references (only the `ado-testforge.tar.gz` artifact name, which is the server slug — a separate open decision).
- Historical plans in `.cursor/plans/` — intentionally preserved as design history.

---

## Runtime Discovery — No Manual Prerequisites

All the names live inside the codebase. No ADO / Confluence / third-party call needs a prior inventory step. The one thing that IS discoverable via REST (ADO's `list_work_item_fields` → `ado_fields`) keeps the same on-disk behavior under its new name.

---

## Files Changed Across All Phases

| File | Change |
|---|---|
| `src/prompts/index.ts` | 23 prompts renamed; internal text self-references updated; 1 new prompt added (`/qa-tests`) |
| `src/tools/work-items.ts` | 3 tools renamed |
| `src/tools/test-cases.ts` | 5 tools renamed |
| `src/tools/test-plans.ts` | 3 tools renamed |
| `src/tools/test-suites.ts` | 7 tools renamed (incl. `find_or_create_test_suite` cross-reference update) |
| `src/tools/tc-drafts.ts` | 6 tools renamed + ~10 tool-description cross-references |
| `src/tools/setup.ts` | 3 tools renamed |
| `src/tools/confluence.ts` | 1 tool renamed |
| `.cursor/skills/qa-test-drafting/SKILL.md` | Directory rename + body content rewrite (generic-ify, remove salesforce-tpm strings) |
| `.cursor/skills/qa-test-assets/SKILL.md` | Directory rename + body references |
| `.cursor/skills/qa-tc-prerequisites/SKILL.md` | Directory rename + body references |
| `docs/implementation.md` | Tool-name references |
| `docs/setup-guide.md` | Setup-command references (`/configure` → `/ado-connect`) |
| `docs/testing-guide.md` | Tool quick-reference table rewrite |
| `docs/distribution-guide.md` | Slash-command example updates |
| `docs/user-setup-guide.md` | User-facing command references |
| `docs/changelog.md` | Breaking-change entry |
| `AGENTS.md` | ~33 tool/prompt references updated |
| `website/public/index.html` | 1 example at line 951 updated |
| `src/**/*.test.ts` (8 files) | ~49 test references updated — safety net for the rename |
| `README.md` | Top command table + install example |
| `npm run build:dist` + `npm run deploy` | Per workspace rule |

---

## Relationship to Other Plans

This plan is **independent**.
- `all_fields_and_embedded_images_support.plan.md` is about data payloads — no naming conflict.
- `jira-mcp-server-v2` rename to the same convention will happen in a separate plan later; no inter-dependency with this plan.
- No changes to the MCP server slug (`ado-testforge-mcp`) — separate decision.

Older context/QA plans referenced by name (`enhanced_context_interactive_qa_v2.plan.md`, etc.) are outdated and not active commitments; they don't block this rename.

---

## Open Questions

1. **Who lands `/qa-tests` as a new prompt?** — Phase 1c. The prompt's text should match the tone of the other list-style prompts in `src/prompts/index.ts`.
2. **Should `ado_plan_create` get a `/ado-plan-create` slash command?** — today it's tool-only. Adding the slash command is a small additional decision, not required for this rename. Recommend deferring to a follow-up plan if needed.
3. **MCP server slug (`ado-testforge-mcp`)** — user deferred this decision. If changed later, update `package.json name`, `vercel.json` artifact reference, install-script paths, and Cursor MCP registration. Not part of this rename PR.

---

## Verification (end-to-end)

1. `npm run build` compiles cleanly with zero TypeScript errors.
2. Every entry in Table A1 maps to exactly one prompt registration in `src/prompts/index.ts` under the new name — no old names remain.
3. Every entry in Table A2 maps to exactly one tool registration under the new name — no old names remain.
4. `git grep -nE '(draft_test_cases|create_test_cases|push_tc_draft_to_ado|save_tc_draft|ensure_suite_hierarchy|get_user_story|list_test_plans|ensure_suite_hierarchy_for_us)' -- ':!.cursor/plans/'` returns ZERO matches (plans excluded — historical records).
5. Restart the MCP in Cursor; autocomplete shows only the 23 new prompts; old names return "Unknown prompt" / "Unknown tool".
6. A known draft workflow (`/qa-draft PMCP-42` → review → `/qa-publish PMCP-42`) produces the same output as the pre-rename workflow on the same US.
7. Skill paths resolve: invoke `/qa-draft` → it reads `.cursor/skills/qa-test-drafting/SKILL.md` without error.
8. `npm run deploy` succeeds per workspace rule.
