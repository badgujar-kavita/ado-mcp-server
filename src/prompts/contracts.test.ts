import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAllPrompts } from "./index.ts";
import {
  INTERACTIVE_READ_CONTRACT,
  DIAGNOSTIC_CONTRACT,
  CONFIRM_BEFORE_ACT_CONTRACT,
} from "./shared-contracts.ts";

type PromptHandler = () => Promise<{
  messages: Array<{ role: string; content: { type: string; text: string } }>;
}>;

async function capturePromptTexts(): Promise<Map<string, string>> {
  const handlers = new Map<string, PromptHandler>();

  const fakeServer = {
    registerPrompt: (name: string, _meta: unknown, cb: PromptHandler) => {
      handlers.set(name, cb);
      return {} as unknown;
    },
  } as unknown as McpServer;

  registerAllPrompts(fakeServer);

  const texts = new Map<string, string>();
  for (const [name, cb] of handlers) {
    const result = await cb();
    texts.set(name, result.messages[0]!.content.text);
  }
  return texts;
}

const READ_PROMPTS = [
  "ado-story",
  "ado-plans",
  "ado-plan",
  "ado-suites",
  "ado-suite",
  "ado-suite-tests",
  "qa-tc-read",
  "ado-fields",
  "confluence-read",
];

const CONFIRM_PROMPTS = ["qa-publish", "qa-clone"];

test("every read prompt composes INTERACTIVE_READ_CONTRACT", async () => {
  const texts = await capturePromptTexts();
  for (const name of READ_PROMPTS) {
    const text = texts.get(name);
    assert.ok(text, `read prompt ${name} should be registered`);
    assert.ok(
      text.includes(INTERACTIVE_READ_CONTRACT),
      `read prompt ${name} must compose INTERACTIVE_READ_CONTRACT`,
    );
  }
});

test("ado-check prompt composes DIAGNOSTIC_CONTRACT", async () => {
  const texts = await capturePromptTexts();
  const text = texts.get("ado-check");
  assert.ok(text, "ado-check prompt should be registered");
  assert.ok(
    text.includes(DIAGNOSTIC_CONTRACT),
    "ado-check must compose DIAGNOSTIC_CONTRACT",
  );
});

test("confirm-before-act prompts compose CONFIRM_BEFORE_ACT_CONTRACT", async () => {
  const texts = await capturePromptTexts();
  for (const name of CONFIRM_PROMPTS) {
    const text = texts.get(name);
    assert.ok(text, `action prompt ${name} should be registered`);
    assert.ok(
      text.includes(CONFIRM_BEFORE_ACT_CONTRACT),
      `${name} must compose CONFIRM_BEFORE_ACT_CONTRACT`,
    );
  }
});

test("no prompt contains the anti-pattern phrase 'show the result verbatim'", async () => {
  const texts = await capturePromptTexts();
  for (const [name, text] of texts) {
    assert.ok(
      !/show the result verbatim/i.test(text),
      `prompt ${name} must not contain the anti-pattern 'show the result verbatim'`,
    );
  }
});

test("setup prompt (ado-connect) intentionally skips the read contract", async () => {
  const texts = await capturePromptTexts();
  const connect = texts.get("ado-connect");
  assert.ok(connect, "ado-connect prompt should be registered");
  assert.ok(
    !connect.includes(INTERACTIVE_READ_CONTRACT),
    "ado-connect prompt should not compose INTERACTIVE_READ_CONTRACT (setup category)",
  );
});

test("AGENTS.md pins 'Frustration is not authorization' phrase", () => {
  const agentsMd = readFileSync(
    resolve(import.meta.dirname, "..", "..", "AGENTS.md"),
    "utf-8",
  );
  assert.ok(
    agentsMd.includes("Frustration is not authorization"),
    "AGENTS.md must contain the consent-vocabulary 'Frustration is not authorization' phrase",
  );
});

test("AGENTS.md pins 'Ambiguity never resolves in favor of action' phrase", () => {
  const agentsMd = readFileSync(
    resolve(import.meta.dirname, "..", "..", "AGENTS.md"),
    "utf-8",
  );
  assert.ok(
    agentsMd.includes("Ambiguity never resolves in favor of action"),
    "AGENTS.md must contain the consent-vocabulary 'Ambiguity never resolves in favor of action' phrase",
  );
});

test("AGENTS.md pins 'Re-ask, don't proceed' phrase", () => {
  const agentsMd = readFileSync(
    resolve(import.meta.dirname, "..", "..", "AGENTS.md"),
    "utf-8",
  );
  // Normalize whitespace so the phrase matches even when the source wraps
  // "re-ask, don't proceed" across a line break (which it does in the
  // verbatim-copied section body).
  const normalized = agentsMd.replace(/\s+/g, " ");
  assert.ok(
    normalized.includes("re-ask, don't proceed"),
    "AGENTS.md must contain the consent-vocabulary 're-ask, don't proceed' phrase",
  );
});

test("qa-tc-update prompt pins no-field-inference + reroute-at-3-groups rules", async () => {
  const texts = await capturePromptTexts();
  const text = texts.get("qa-tc-update");
  assert.ok(text, "qa-tc-update prompt should be registered");
  // No-inference rule — agent must not guess fields from pasted context.
  assert.ok(
    /NO FIELD INFERENCE/i.test(text),
    "qa-tc-update must include explicit NO FIELD INFERENCE clause",
  );
  // Reroute-to-draft rule at 3+ groups.
  assert.ok(
    /three or more distinct value groups/i.test(text),
    "qa-tc-update must tell the agent to reroute when 3+ distinct value groups are requested",
  );
  assert.ok(
    /\/qa-publish/.test(text),
    "qa-tc-update reroute must point at /qa-publish",
  );
  // Single-upfront-confirmation clause (no sequential YES fatigue).
  assert.ok(
    /ONE upfront confirmation/i.test(text),
    "qa-tc-update must require a single upfront confirmation covering the full batch plan",
  );
  // Cross-US branch handler + ack flag.
  assert.ok(
    /acknowledgeCrossUs/.test(text),
    "qa-tc-update must document the acknowledgeCrossUs flag",
  );
  assert.ok(
    /cross-us-bulk-update/.test(text),
    "qa-tc-update must document the cross-us-bulk-update response reason",
  );
  // Precheck failed branch.
  assert.ok(
    /precheck-failed/.test(text),
    "qa-tc-update must document the precheck-failed response reason",
  );
  // No auto-retry on partial failure.
  assert.ok(
    /NEVER retry/i.test(text),
    "qa-tc-update must forbid auto-retry on partial failure",
  );
});

test("shared contracts are non-empty and distinct", () => {
  assert.ok(
    INTERACTIVE_READ_CONTRACT.length > 0,
    "INTERACTIVE_READ_CONTRACT must be non-empty",
  );
  assert.ok(
    DIAGNOSTIC_CONTRACT.length > 0,
    "DIAGNOSTIC_CONTRACT must be non-empty",
  );
  assert.ok(
    CONFIRM_BEFORE_ACT_CONTRACT.length > 0,
    "CONFIRM_BEFORE_ACT_CONTRACT must be non-empty",
  );
  assert.notEqual(INTERACTIVE_READ_CONTRACT, DIAGNOSTIC_CONTRACT);
  assert.notEqual(DIAGNOSTIC_CONTRACT, CONFIRM_BEFORE_ACT_CONTRACT);
  assert.notEqual(INTERACTIVE_READ_CONTRACT, CONFIRM_BEFORE_ACT_CONTRACT);
});
