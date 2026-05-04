/**
 * Shared prompt contracts. Imported by src/prompts/index.ts and composed
 * into individual prompt texts.
 *
 * Ported from jira-mcp-server-v2 (see docs/ado-mcp-port-proposal.md).
 *
 * - INTERACTIVE_READ_CONTRACT and DIAGNOSTIC_CONTRACT are copied VERBATIM
 *   from jira-mcp-server-v2/src/prompts/definitions.ts.
 * - CONFIRM_BEFORE_ACT_CONTRACT is new to ado-mcp: a lighter replacement
 *   for jira-mcp's ELICITATION_PROTOCOL + TWO_PHASE_CONFIRM. Rules per
 *   docs/ado-mcp-port-proposal.md § 3 gap C: offer the plan, wait for
 *   explicit yes, on yes call the NEXT action tool (not a re-call of
 *   the same tool), on no do nothing. No resume tokens.
 */

export const INTERACTIVE_READ_CONTRACT = [
  "## After the tool returns — interactive response contract",
  "",
  "1. **Confirm** what you accessed. Use a titled markdown link",
  "   (`[Title](url)`), never a bare URL.",
  "2. **Summarize** in 2–5 bullets. Mention key artifacts (diagrams,",
  "   tables, sections, files) but do not reproduce them.",
  "3. **Show related items** as a list or tree — child pages, linked",
  "   issues, attached test cases, etc. Keep links titled.",
  "4. **State gaps** explicitly. If the tool flagged partial results,",
  "   truncation, or a depth cap, surface it. Never imply completeness.",
  "5. **Offer 3–5 next actions** tailored to what you just read",
  "   (examples: 'Generate a markdown summary', 'Descend into child",
  "   pages', 'Analyze the architecture', 'List blocked ACs').",
  "6. **Wait.** Do not auto-execute the next step until the user picks.",
  "",
  "**Phrase each next action as a user intent, not a command.** 'Review",
  "the file and share feedback' beats 'Open the file for review'. 'When",
  "ready, approve the draft and I'll publish' beats 'Set `status:",
  "approved` in the frontmatter, then run /qa-publish <KEY>'. Tool-",
  "internal mechanics stay inside the tool; what you show the user",
  "stays in user language.",
].join("\n");

export const DIAGNOSTIC_CONTRACT = [
  "## Diagnostic response contract — STRICT",
  "",
  "The tool returns a status table + an **Overall** verdict + a",
  "**Next Actions** section. Everything the user needs is in that",
  "output. Your job is to surface it faithfully, not to improvise.",
  "",
  "1. **Show the table verbatim.** Preserve the `| ... |` Markdown",
  "   structure. Do not convert to bullets.",
  "2. **Lead with the Overall line.** State whether the check is",
  "   healthy, degraded, or broken — use the exact wording from the",
  "   tool output.",
  "3. **Surface Next Actions verbatim.** Each bullet the tool",
  "   generated is a deterministic remediation mapped to a specific",
  "   row. Do NOT rewrite, paraphrase, reorder, add, or drop any.",
  "4. **Do not invent causes.** Do not explain why a row failed",
  "   using information that is not in its Detail column.",
  "   (Examples of invention to avoid: 'tokens expire every 90",
  "   days', 'this usually means VPN is off', 'the API might be",
  "   deprecated'.)",
  "5. **Do not invoke other tools.** The Next Actions section",
  "   suggests commands like `/jira-connect` or `/jira-check",
  "   refreshFields=true` — the user will run them if they want to.",
  "   You present the command; the user runs it.",
  "6. **Stop when done.** After presenting the table + overall +",
  "   next actions, end the turn. Do not offer extra follow-ups. Do",
  "   not ask 'want me to run X?'. If the user has a question, they",
  "   will ask.",
].join("\n");

export const CONFIRM_BEFORE_ACT_CONTRACT = [
  "## Confirm before you act",
  "",
  "This tool applies changes that the user must approve first. Do not",
  "mutate ADO, Confluence, or the local tc-drafts workspace until you",
  "have explicit permission.",
  "",
  "1. **Offer the plan.** Show what will be written, pushed, or saved —",
  "   target work items, file paths, counts. Keep it concrete.",
  "2. **The ask itself must include both yes AND no as equal options.**",
  "   Minimum form: *'Reply **yes** to proceed, **no** to cancel, or",
  "   tell me what you'd like instead.'* Do not ship 'type YES to push'",
  "   without a visible cancel path. The full minimum re-ask form on",
  "   ambiguous replies is defined in AGENTS.md 'What counts as consent'.",
  "3. **Wait for an explicit yes.** Accept 'yes', 'approved',",
  "   'confirmed', or 'push'. Anything ambiguous — frustration,",
  "   sarcasm, rhetorical questions, self-directed replies, silence —",
  "   means ask again per AGENTS.md. Do not invoke any tool.",
  "4. **On yes, call the NEXT action tool.** Do not re-call the same",
  "   tool with a 'confirm' flag — ado-mcp does not use resume tokens.",
  "   Move forward to the tool that actually performs the write (e.g.",
  "   `qa_publish_push` after a preview was saved).",
  "5. **On no / cancel, stop.** Tell the user the operation was",
  "   cancelled. Do not retry, do not suggest a workaround, do not",
  "   reach for another tool.",
].join("\n");
