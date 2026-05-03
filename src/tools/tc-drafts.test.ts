/**
 * Tests for the two READ tools in tc-drafts.ts migrated to
 * `server.registerTool(...)` with outputSchema (Port-Commit 3, Tier 2).
 *
 * Strategy: capture the two tool handlers via a mock McpServer that records
 * every `registerTool` / `tool` call (the action tools still use `.tool(...)` —
 * we just ignore those handlers). Drafts are materialised on disk in a
 * tmpdir using the real `formatTcDraftToMarkdown` so the parser round-trip
 * under test is realistic.
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

// ── Handler-capture helper ──────────────────────────────────────────────

type ToolHandler = (input: Record<string, unknown>) => Promise<{
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}>;

function captureHandlers(): { server: McpServer; handlers: Map<string, ToolHandler> } {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    // registerTool(name, config, handler)
    registerTool: (name: string, _config: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
      return {} as unknown;
    },
    // server.tool(name, description, schema, handler) — ignored (action tools)
    tool: (_name: string, _desc: unknown, _schema: unknown, _handler: ToolHandler) => {
      return {} as unknown;
    },
  } as unknown as McpServer;
  return { server, handlers };
}

function fakeAdoClient(): AdoClient {
  return new AdoClient("myorg", "myproj", "pat");
}

// ── Fixture helpers ─────────────────────────────────────────────────────

function buildDraftData(overrides: Partial<TcDraftData> = {}): TcDraftData {
  return {
    userStoryId: 100,
    storyTitle: "Login flow",
    storyState: "Active",
    areaPath: "Proj\\Area",
    iterationPath: "Proj\\Sprint 1",
    version: 1,
    status: "DRAFT",
    lastUpdated: "2026-01-15",
    testCases: [
      {
        tcNumber: 1,
        featureTags: ["Login"],
        useCaseSummary: "Valid creds succeed",
        priority: 2,
        steps: [{ action: "Enter valid creds and submit", expectedResult: "Redirected to home" }],
      },
    ],
    ...overrides,
  };
}

/** Write a draft under tmpdir/tc-drafts/US_<id>/US_<id>_test_cases.md. Returns the tc-drafts dir. */
function writeDraft(baseDir: string, data: TcDraftData): string {
  const tcDraftsDir = join(baseDir, "tc-drafts");
  const usFolder = join(tcDraftsDir, `US_${data.userStoryId}`);
  mkdirSync(usFolder, { recursive: true });
  const mdPath = join(usFolder, `US_${data.userStoryId}_test_cases.md`);
  writeFileSync(mdPath, formatTcDraftToMarkdown(data), "utf-8");
  return tcDraftsDir;
}

// ── get_tc_draft tests ──────────────────────────────────────────────────

test("get_tc_draft missing file returns isError with no structuredContent", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const getDraft = handlers.get("get_tc_draft");
  assert.ok(getDraft, "get_tc_draft should be registered via registerTool");

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const result = await getDraft!({
      userStoryId: 999,
      draftsPath: join(base, "tc-drafts-does-not-exist"),
    });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent, undefined);
    const textPart = result.content[0] as { type: "text"; text: string };
    assert.ok(textPart.text.includes("No draft found for US 999"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("get_tc_draft with APPROVED draft populates children with relationship='pushed' for TCs with adoWorkItemId", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const getDraft = handlers.get("get_tc_draft")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId: 200,
      status: "APPROVED",
      testCases: [
        {
          tcNumber: 1,
          featureTags: ["Login"],
          useCaseSummary: "Valid creds succeed",
          priority: 2,
          steps: [{ action: "Enter valid creds and submit", expectedResult: "Redirected to home" }],
          adoWorkItemId: 5001,
        },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);
    const result = await getDraft({ userStoryId: 200, draftsPath: tcDraftsDir });

    assert.ok(result.structuredContent, "should have structuredContent");
    const sc = result.structuredContent as {
      item: { id: number; type: string; title: string; summary?: string };
      children?: Array<{ id: string | number; type: string; title: string; relationship?: string }>;
      artifacts?: Array<{ kind: string; title: string; url?: string }>;
      completeness: { isPartial: boolean };
    };
    assert.equal(sc.item.id, 200);
    assert.equal(sc.item.type, "tc-draft");
    assert.ok(sc.item.title.includes("US #200"));
    assert.ok(sc.item.summary!.includes("APPROVED"));
    assert.ok(sc.children);
    assert.equal(sc.children!.length, 1);
    assert.equal(sc.children![0]!.id, 5001);
    assert.equal(sc.children![0]!.type, "test-case");
    assert.equal(sc.children![0]!.relationship, "pushed");
    assert.ok(sc.artifacts);
    assert.equal(sc.artifacts![0]!.kind, "markdown-draft");
    assert.equal(sc.completeness.isPartial, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("get_tc_draft with DRAFT status populates children with relationship='drafted' for TCs without adoWorkItemId", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const getDraft = handlers.get("get_tc_draft")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({ userStoryId: 300, status: "DRAFT" });
    const tcDraftsDir = writeDraft(base, data);
    const result = await getDraft({ userStoryId: 300, draftsPath: tcDraftsDir });

    const sc = result.structuredContent as {
      children?: Array<{ id: string | number; relationship?: string }>;
    };
    assert.ok(sc.children);
    assert.equal(sc.children!.length, 1);
    assert.equal(sc.children![0]!.relationship, "drafted");
    // id falls back to the TC_<us>_<nn> label
    assert.equal(sc.children![0]!.id, "TC_300_01");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("get_tc_draft appends ADO Links section in content text when draft has ADO IDs", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const getDraft = handlers.get("get_tc_draft")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId: 400,
      status: "APPROVED",
      testCases: [
        {
          tcNumber: 1,
          featureTags: ["Login"],
          useCaseSummary: "Valid creds succeed",
          priority: 2,
          steps: [{ action: "Enter valid creds and submit", expectedResult: "Redirected to home" }],
          adoWorkItemId: 7777,
        },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);
    const result = await getDraft({ userStoryId: 400, draftsPath: tcDraftsDir });

    const textPart = result.content[0] as { type: "text"; text: string };
    assert.ok(
      textPart.text.includes("## ADO Links (agent display — not persisted)"),
      "text should contain the ADO Links header",
    );
    assert.ok(textPart.text.includes("[ADO #7777]"), "text should contain TC link to ADO #7777");
    assert.ok(textPart.text.includes("[US #400]"), "text should contain US link");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ── list_tc_drafts tests ────────────────────────────────────────────────

test("list_tc_drafts returns one child per draft file in the directory", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const listDrafts = handlers.get("list_tc_drafts")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const tcDraftsDir = writeDraft(base, buildDraftData({ userStoryId: 101, status: "DRAFT" }));
    writeDraft(base, buildDraftData({ userStoryId: 102, status: "APPROVED" }));

    const result = await listDrafts({ draftsPath: tcDraftsDir });
    assert.ok(result.structuredContent);
    const sc = result.structuredContent as {
      item: { id: string | number; type: string; title: string };
      children?: Array<{ id: string | number; type: string; relationship?: string }>;
      completeness: { isPartial: boolean };
    };
    assert.equal(sc.item.id, "tc-drafts-index");
    assert.equal(sc.item.type, "tc-draft-index");
    assert.ok(sc.children);
    assert.equal(sc.children!.length, 2);
    // Sorted by US ID: 101 (DRAFT), 102 (APPROVED)
    assert.equal(sc.children![0]!.id, 101);
    assert.equal(sc.children![0]!.relationship, "draft");
    assert.equal(sc.children![1]!.id, 102);
    assert.equal(sc.children![1]!.relationship, "approved");
    assert.equal(sc.completeness.isPartial, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("list_tc_drafts on empty/non-existent directory returns empty children", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const listDrafts = handlers.get("list_tc_drafts")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const result = await listDrafts({
      draftsPath: join(base, "tc-drafts-does-not-exist"),
    });
    assert.ok(result.structuredContent);
    const sc = result.structuredContent as {
      item: { type: string };
      children?: Array<unknown>;
      completeness: { isPartial: boolean };
    };
    assert.equal(sc.item.type, "tc-draft-index");
    assert.ok(sc.children);
    assert.equal(sc.children!.length, 0);
    assert.equal(sc.completeness.isPartial, false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
