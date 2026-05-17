/**
 * Tests for the two new gates that fire on a suffixed `qa_publish_push`:
 *
 *   1. `us-suite-missing-for-suffixed-publish` (BLOCK) — when the canonical
 *      pack hasn't published the US-level suite yet.
 *   2. `suffixed-suite-decision` (NEEDS-CONFIRMATION) — when the US suite is
 *      in place but the user hasn't picked option A (create sub-suite) or
 *      option B (tag-only).
 *
 * Each gate is exercised end-to-end via the registered tool handler, with a
 * stub AdoClient that returns canned responses for the read paths the
 * publish flow walks (US fetch, plan suites list). The gates are reached
 * BEFORE any draft-state gate fires, so suffixed publishes from a DRAFT-
 * status draft still surface the suffixed gate first — that's the contract.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AdoClient } from "../ado-client.ts";
import { registerTcDraftTools } from "./tc-drafts.ts";
import { formatTcDraftToMarkdown, type TcDraftData } from "../helpers/tc-draft-formatter.ts";
import type { AdoTestSuite } from "../types.ts";

// ── Handler-capture helper ──────────────────────────────────────────────

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}>;

function captureHandlers(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
      return {} as unknown;
    },
    tool: (_name: string, _desc: unknown, _schema: unknown, _handler: ToolHandler) => {
      return {} as unknown;
    },
  } as unknown as McpServer;
  return { server, handlers };
}

// ── Stub AdoClient for the publish-flow read paths ──────────────────────

interface StubOpts {
  /** Suites returned for /_apis/testplan/Plans/<planId>/suites — used by usSuiteExists. */
  suitesByPlan?: Map<number, AdoTestSuite[]>;
  /** Fields returned by /_apis/wit/workitems/<usId>. */
  usFields?: Record<string, unknown>;
}

class StubAdoClient extends AdoClient {
  public suitesByPlan: Map<number, AdoTestSuite[]>;
  public usFields: Record<string, unknown>;

  constructor(opts: StubOpts = {}) {
    super("myorg", "myproj", "pat");
    this.suitesByPlan = opts.suitesByPlan ?? new Map();
    this.usFields = opts.usFields ?? {};
  }

  async get<T>(path: string): Promise<T> {
    const planSuites = path.match(/\/_apis\/testplan\/Plans\/(\d+)\/suites$/);
    if (planSuites) {
      const planId = parseInt(planSuites[1], 10);
      const value = this.suitesByPlan.get(planId) ?? [];
      return { value, count: value.length } as unknown as T;
    }
    const wi = path.match(/\/_apis\/wit\/workitems\/(\d+)$/);
    if (wi) {
      const id = parseInt(wi[1], 10);
      return {
        id,
        rev: 1,
        fields: this.usFields,
        url: path,
        relations: [],
      } as unknown as T;
    }
    throw new Error(`StubAdoClient: unhandled GET ${path}`);
  }

  async post<T>(): Promise<T> {
    throw new Error("StubAdoClient: POST not expected in gate tests");
  }
  async patch<T>(): Promise<T> {
    throw new Error("StubAdoClient: PATCH not expected in gate tests");
  }
  async delete<T>(): Promise<T> {
    throw new Error("StubAdoClient: DELETE not expected in gate tests");
  }
}

// ── Fixture helpers ─────────────────────────────────────────────────────

function buildDraftData(overrides: Partial<TcDraftData> = {}): TcDraftData {
  return {
    userStoryId: 1234,
    storyTitle: "Suffix gate test story",
    storyState: "Active",
    areaPath: "Proj\\Area",
    iterationPath: "Proj\\Sprint 14",
    planId: 5500,
    version: 1,
    status: "DRAFT",
    lastUpdated: "2026-05-17",
    testCases: [
      {
        tcNumber: 1,
        featureTags: ["Email"],
        useCaseSummary: "Existing channel still creates a Case",
        priority: 1,
        steps: [{ action: "Send email", expectedResult: "Case is created" }],
      },
    ],
    ...overrides,
  };
}

function writeSuffixedDraft(baseDir: string, data: TcDraftData, suffix: string): string {
  const tcDraftsDir = join(baseDir, "tc-drafts");
  const usFolder = join(tcDraftsDir, `US_${data.userStoryId}`);
  mkdirSync(usFolder, { recursive: true });
  const mdPath = join(usFolder, `US_${data.userStoryId}_test_cases_${suffix}.md`);
  writeFileSync(mdPath, formatTcDraftToMarkdown(data, undefined, suffix), "utf-8");
  return tcDraftsDir;
}

function parsePublishBody(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const text = (result.content[0] as { type: "text"; text: string }).text;
  return JSON.parse(text) as Record<string, unknown>;
}

// ── Gate 1 — us-suite-missing-for-suffixed-publish ──────────────────────

test("qa_publish_push suffix=regression: BLOCK with us-suite-missing-for-suffixed-publish when US suite doesn't exist", async () => {
  const stub = new StubAdoClient({
    // Plan exists but has only the root suite — no `<usId> | <title>` entry.
    suitesByPlan: new Map([[5500, [
      { id: 1, name: "Plan Root", suiteType: "staticTestSuite", plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: false } satisfies AdoTestSuite,
    ]]]),
  });
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-suffix-"));
  try {
    const tcDraftsDir = writeSuffixedDraft(base, buildDraftData(), "regression");
    const result = await publish({ userStoryId: 1234, suffix: "regression", draftsPath: tcDraftsDir });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.status, "needs-input");
    assert.equal(body.reason, "us-suite-missing-for-suffixed-publish");
    assert.match(body.message as string, /BLOCK/);
    // Sanity: the suggestion points the user at the canonical publish, not at overrides.
    assert.match(body.suggestion as string, /\/qa-publish 1234/);
    assert.doesNotMatch(body.suggestion as string, /planId/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ── Gate 2 — suffixed-suite-decision ────────────────────────────────────

test("qa_publish_push suffix=regression with US suite present: NEEDS-CONFIRMATION suffixed-suite-decision (3 options)", async () => {
  const stub = new StubAdoClient({
    suitesByPlan: new Map([[5500, [
      { id: 1, name: "Plan Root", suiteType: "staticTestSuite", plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
      { id: 2, name: "Sprint 14", suiteType: "staticTestSuite", parentSuite: { id: 1, name: "Plan Root" }, plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
      { id: 3, name: "1234 | Suffix gate test story", suiteType: "dynamicTestSuite", parentSuite: { id: 2, name: "Sprint 14" }, plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: false, queryString: "..." } satisfies AdoTestSuite,
    ]]]),
  });
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-suffix-"));
  try {
    const tcDraftsDir = writeSuffixedDraft(base, buildDraftData(), "regression");
    const result = await publish({ userStoryId: 1234, suffix: "regression", draftsPath: tcDraftsDir });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.status, "needs-confirmation");
    assert.equal(body.reason, "suffixed-suite-decision");
    assert.equal(body.suffix, "regression");
    assert.equal(body.categoryTag, "REG");

    const options = body.options as Array<{ key: string; label: string; action: string }>;
    assert.equal(options.length, 3);
    assert.equal(options[0].key, "A");
    assert.match(options[0].label, /Regression/i);
    assert.match(options[0].action, /createSuffixedSuite: true/);
    assert.equal(options[1].key, "B");
    assert.match(options[1].action, /createSuffixedSuite: false/);
    assert.equal(options[2].key, "C");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ── Suffix gate runs BEFORE draft-status gate ───────────────────────────

test("qa_publish_push suffix gate fires before the draft-status gate", async () => {
  // Sanity: a DRAFT-status suffixed draft would normally hit `draft-status-draft`,
  // but the suffixed gate is wired earlier in the handler. So we should see Gate 1
  // (us-suite-missing) instead of `draft-status-draft` here.
  const stub = new StubAdoClient({
    suitesByPlan: new Map([[5500, [
      { id: 1, name: "Plan Root", suiteType: "staticTestSuite", plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: false } satisfies AdoTestSuite,
    ]]]),
  });
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-suffix-"));
  try {
    const tcDraftsDir = writeSuffixedDraft(base, buildDraftData({ status: "DRAFT" }), "e2e");
    const result = await publish({ userStoryId: 1234, suffix: "e2e", draftsPath: tcDraftsDir });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.reason, "us-suite-missing-for-suffixed-publish");
    assert.notEqual(body.reason, "draft-status-draft");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ── Canonical publish does NOT fire the suffix gates ────────────────────

test("qa_publish_push without suffix: suffixed gates are not evaluated (canonical path)", async () => {
  // Even with no suites in the plan (which would trigger Gate 1 for a suffixed publish),
  // a canonical publish must skip Gate 1/2 entirely and reach the regular gate flow.
  const stub = new StubAdoClient({
    suitesByPlan: new Map([[5500, []]]),
  });
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-suffix-"));
  try {
    const tcDraftsDir = join(base, "tc-drafts");
    const usFolder = join(tcDraftsDir, "US_1234");
    mkdirSync(usFolder, { recursive: true });
    writeFileSync(
      join(usFolder, "US_1234_test_cases.md"),
      formatTcDraftToMarkdown(buildDraftData({ status: "DRAFT" })),
      "utf-8",
    );
    const result = await publish({ userStoryId: 1234, draftsPath: tcDraftsDir });

    // Canonical DRAFT path → expect draft-status-draft gate, NOT a suffix gate.
    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.reason, "draft-status-draft");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ── createSuffixedSuite=false skips Gate 2 even when US suite is present ──

test("qa_publish_push suffix gate is skipped on repush (createSuffixedSuite already decided)", async () => {
  // A repush flow has already passed Gate 2 on the previous push, so re-running
  // shouldn't re-prompt for createSuffixedSuite. The handler logic guards Gate 2
  // with `!isRepush` — this test pins that guard.
  const stub = new StubAdoClient({
    suitesByPlan: new Map([[5500, [
      { id: 1, name: "Plan Root", suiteType: "staticTestSuite", plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: true } satisfies AdoTestSuite,
      { id: 3, name: "1234 | Suffix gate test story", suiteType: "dynamicTestSuite", parentSuite: { id: 1, name: "Plan Root" }, plan: { id: 5500, name: "Plan" }, revision: 1, hasChildren: false } satisfies AdoTestSuite,
    ]]]),
  });
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-suffix-"));
  try {
    // APPROVED + every TC has an ADO ID → repush precondition.
    const data = buildDraftData({
      status: "APPROVED",
      testCases: [
        {
          tcNumber: 1,
          featureTags: ["Email"],
          useCaseSummary: "Existing channel still creates a Case",
          priority: 1,
          steps: [{ action: "Send email", expectedResult: "Case is created" }],
          adoWorkItemId: 42,
        },
      ],
    });
    const tcDraftsDir = writeSuffixedDraft(base, data, "regression");
    const result = await publish({
      userStoryId: 1234,
      suffix: "regression",
      draftsPath: tcDraftsDir,
      repush: true,
    });

    // Should NOT be the suffixed-suite-decision gate — the gate is bypassed on repush.
    const body = parsePublishBody(result);
    assert.notEqual(body.reason, "suffixed-suite-decision");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
