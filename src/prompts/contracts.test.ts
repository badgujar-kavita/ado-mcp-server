import { test } from "node:test";
import assert from "node:assert/strict";
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
  "get_user_story",
  "list_test_plans",
  "get_test_plan",
  "list_test_suites",
  "get_test_suite",
  "list_test_cases",
  "get_test_case",
  "list_work_item_fields",
  "get_confluence_page",
];

const CONFIRM_PROMPTS = ["create_test_cases", "clone_and_enhance_test_cases"];

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

test("check_status prompt composes DIAGNOSTIC_CONTRACT", async () => {
  const texts = await capturePromptTexts();
  const text = texts.get("check_status");
  assert.ok(text, "check_status prompt should be registered");
  assert.ok(
    text.includes(DIAGNOSTIC_CONTRACT),
    "check_status must compose DIAGNOSTIC_CONTRACT",
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

test("setup prompts (configure, setup_credentials) intentionally skip the read contract", async () => {
  const texts = await capturePromptTexts();
  const configure = texts.get("configure");
  assert.ok(configure, "configure prompt should be registered");
  assert.ok(
    !configure.includes(INTERACTIVE_READ_CONTRACT),
    "configure prompt should not compose INTERACTIVE_READ_CONTRACT (setup category)",
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
