# Cursor Rules — Tenant Extension Bundle for ADO TestForge MCP

A self-contained folder with **the full guide + ready-to-copy `.mdc` examples** for customizing ADO TestForge behavior per team, without code changes.

**Share this whole folder with tenants.** Everything they need is here:
- **[GUIDE.md](./GUIDE.md)** — the full ~540-line guide (what rules are, precedence, TC title convention, gotchas)
- **`.mdc` files** — 5 worked examples + 1 quickstart template, copy directly into their `.cursor/rules/`

---

## How to use

1. Pick the example(s) that match your team's needs from the list below.
2. Copy the file into **your project's** `.cursor/rules/` directory.
3. Edit the content — replace `[Team name]`, integration system names, persona labels, and priority criteria with your specifics.
4. Restart Cursor (or reload the MCP: Settings → MCP → refresh `ado-testforge`).
5. Run `/ado-testforge/qa-draft` on a known User Story and verify your rule shaped the output.

## Copy from terminal

```bash
# From your project root:
mkdir -p .cursor/rules
cp /path/to/ado-mcp-server/docs/examples/cursor-rules/regression-policy.mdc .cursor/rules/
cp /path/to/ado-mcp-server/docs/examples/cursor-rules/sit-coverage.mdc .cursor/rules/
# ...etc. Pick and choose.
```

## Available templates

| File | Purpose | When to use |
|---|---|---|
| [regression-policy.mdc](regression-policy.mdc) | Regression coverage rules — what triggers regression TCs, scope, priority | Always — every team doing regression benefits |
| [sit-coverage.mdc](sit-coverage.mdc) | System Integration Test scope — which integrations need SIT coverage and how | Teams with external APIs, webhooks, or message buses |
| [e2e-scope.mdc](e2e-scope.mdc) | End-to-end test scope — multi-persona, multi-module journeys | Teams with cross-module user journeys (e.g. CRM → Order → Fulfillment) |
| [priority-policy.mdc](priority-policy.mdc) | Project-wide TC priority matrix | Teams wanting consistent priority assignment across drafters |
| [persona-conventions.mdc](persona-conventions.mdc) | Persona naming + access matrix for your team | Teams with a defined persona list (beyond generic System Admin / User) |
| [your-team-policy.quickstart.mdc](your-team-policy.quickstart.mdc) | Skeleton template — fill in placeholders for a fresh team policy | Starting from scratch with your own category prefixes and conventions |

## Which ones do I need?

**Minimum viable setup (covers 80% of teams):**
- `regression-policy.mdc`
- `priority-policy.mdc`

**For integration-heavy projects, add:**
- `sit-coverage.mdc`

**For revenue-critical or customer-journey-heavy products, add:**
- `e2e-scope.mdc`

**For teams with a formal persona list beyond built-ins, add:**
- `persona-conventions.mdc`

## Important notes

- These files are **examples**, not the active rules in this repo. Only files placed in a project's **own** `.cursor/rules/` directory are honored by Cursor.
- The MCP's safety rails (consent vocabulary, destructive-action gates) live in server code and CANNOT be overridden by rules — see the precedence section in the main guide.
- Keep each rule under ~100 lines — long rules compete with the MCP prompt for LLM context window.
- Test iteratively: save a rule, run `/qa-draft` on a known US, inspect the output, tune the rule.

## Reference the full guide

The main guide at [GUIDE.md](./GUIDE.md) (in this same folder) covers:
- What Cursor rules are and how they integrate with the MCP
- The precedence model (MCP safety > tenant rules > config defaults)
- Frontmatter reference (`globs`, `alwaysApply`)
- The TC title category-prefix convention (`TC_<USID>_<NN> -> Regression -> ...`)
- WIQL queries to filter your ADO results by category
- Gotchas and what rules CAN and CANNOT do
