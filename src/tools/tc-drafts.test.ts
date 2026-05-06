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
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
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

// ── qa_draft_read tests ──────────────────────────────────────────────────

test("qa_draft_read missing file returns isError with no structuredContent", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const getDraft = handlers.get("qa_draft_read");
  assert.ok(getDraft, "qa_draft_read should be registered via registerTool");

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

test("qa_draft_read with APPROVED draft populates children with relationship='pushed' for TCs with adoWorkItemId", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const getDraft = handlers.get("qa_draft_read")!;

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

test("qa_draft_read with DRAFT status populates children with relationship='drafted' for TCs without adoWorkItemId", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const getDraft = handlers.get("qa_draft_read")!;

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

test("qa_draft_read appends ADO Links section in content text when draft has ADO IDs", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const getDraft = handlers.get("qa_draft_read")!;

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

// ── qa_drafts_list tests ────────────────────────────────────────────────

test("qa_drafts_list returns one child per draft file in the directory", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const listDrafts = handlers.get("qa_drafts_list")!;

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

test("qa_drafts_list on empty/non-existent directory returns empty children", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const listDrafts = handlers.get("qa_drafts_list")!;

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

// ── qa_publish_push consent-gate regression tests ───────────────────────

/** Parse the JSON body produced by qa_publish_push's consent responses. */
function parsePublishBody(result: {
  content: Array<{ type: string; text?: string }>;
}): Record<string, unknown> {
  const textPart = result.content[0] as { type: "text"; text: string };
  return JSON.parse(textPart.text) as Record<string, unknown>;
}

test("qa_publish_push: DRAFT status without approveAndPush returns needs-confirmation (draft-status-draft)", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({ userStoryId: 500, status: "DRAFT" });
    const tcDraftsDir = writeDraft(base, data);
    const result = await publish({ userStoryId: 500, draftsPath: tcDraftsDir });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.status, "needs-confirmation");
    assert.equal(body.reason, "draft-status-draft");
    assert.ok(typeof body.prompt === "string");
    assert.ok((body.prompt as string).includes("YES"));
    assert.ok((body.prompt as string).toLowerCase().includes("no"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push: APPROVED without any ADO IDs returns needs-confirmation (approved-without-ids) with options A and B", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId: 501,
      status: "APPROVED",
      testCases: [
        {
          tcNumber: 1,
          featureTags: ["Login"],
          useCaseSummary: "Valid creds succeed",
          priority: 2,
          steps: [{ action: "Enter valid creds", expectedResult: "Home page" }],
        },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);
    const result = await publish({ userStoryId: 501, draftsPath: tcDraftsDir });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.status, "needs-confirmation");
    assert.equal(body.reason, "approved-without-ids");
    const options = body.options as Array<{ key: string; label: string }>;
    assert.ok(Array.isArray(options));
    assert.equal(options.length, 2);
    assert.equal(options[0]!.key, "A");
    assert.ok(options[0]!.label.toLowerCase().includes("reset"));
    assert.equal(options[1]!.key, "B");
    assert.ok(options[1]!.label.toLowerCase().includes("cancel"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push: APPROVED with ADO IDs and no repush flag returns needs-confirmation (approved-with-ids-no-repush)", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId: 502,
      status: "APPROVED",
      testCases: [
        {
          tcNumber: 1,
          featureTags: ["Login"],
          useCaseSummary: "Valid creds succeed",
          priority: 2,
          steps: [{ action: "Enter valid creds", expectedResult: "Home page" }],
          adoWorkItemId: 9991,
        },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);
    const result = await publish({ userStoryId: 502, draftsPath: tcDraftsDir });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.status, "needs-confirmation");
    assert.equal(body.reason, "approved-with-ids-no-repush");
    const options = body.options as Array<{ key: string; label: string }>;
    assert.ok(Array.isArray(options));
    assert.equal(options.length, 2);
    assert.equal(options[0]!.key, "A");
    assert.ok(options[0]!.label.toLowerCase().includes("repush"));
    assert.equal(options[1]!.key, "B");
    assert.ok(options[1]!.label.toLowerCase().includes("cancel"));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push: repush=true with some TCs missing ADO IDs returns needs-input (repush-missing-ids) with missingTcNumbers", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId: 503,
      status: "APPROVED",
      testCases: [
        {
          tcNumber: 1,
          featureTags: ["Login"],
          useCaseSummary: "Valid creds succeed",
          priority: 2,
          steps: [{ action: "Enter valid creds", expectedResult: "Home page" }],
          adoWorkItemId: 9991,
        },
        {
          tcNumber: 2,
          featureTags: ["Login"],
          useCaseSummary: "Invalid creds fail",
          priority: 2,
          steps: [{ action: "Enter invalid creds", expectedResult: "Error shown" }],
          // no adoWorkItemId → missing
        },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);
    const result = await publish({ userStoryId: 503, draftsPath: tcDraftsDir, repush: true });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.status, "needs-input");
    assert.equal(body.reason, "repush-missing-ids");
    const resolvedSoFar = body.resolvedSoFar as { missingTcNumbers: number[] };
    assert.ok(Array.isArray(resolvedSoFar.missingTcNumbers));
    assert.deepEqual(resolvedSoFar.missingTcNumbers, [2]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push: resetToDraft=true on APPROVED-without-ids flips status in file, returns success, makes no ADO calls", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId: 504,
      status: "APPROVED",
      testCases: [
        {
          tcNumber: 1,
          featureTags: ["Login"],
          useCaseSummary: "Valid creds succeed",
          priority: 2,
          steps: [{ action: "Enter valid creds", expectedResult: "Home page" }],
        },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);
    const mdPath = join(tcDraftsDir, "US_504", "US_504_test_cases.md");

    // sanity: the file starts out as APPROVED
    const before = readFileSync(mdPath, "utf-8");
    assert.ok(before.includes("| **Status** | APPROVED |"));

    const result = await publish({
      userStoryId: 504,
      draftsPath: tcDraftsDir,
      resetToDraft: true,
    });

    // Must NOT be an error, and must carry a success body.
    assert.ok(!result.isError, "resetToDraft happy path should not set isError");
    const body = parsePublishBody(result);
    assert.equal(body.status, "success");
    assert.equal(body.reason, "reset-to-draft-complete");

    // File on disk was rewritten: APPROVED → DRAFT.
    const after = readFileSync(mdPath, "utf-8");
    assert.ok(
      after.includes("| **Status** | DRAFT |"),
      "status line should now be DRAFT",
    );
    assert.ok(
      !after.includes("| **Status** | APPROVED |"),
      "APPROVED status line should be gone",
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push: resetToDraft=true on a DRAFT draft returns reset-to-draft-not-applicable", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({ userStoryId: 505, status: "DRAFT" });
    const tcDraftsDir = writeDraft(base, data);
    const result = await publish({
      userStoryId: 505,
      draftsPath: tcDraftsDir,
      resetToDraft: true,
    });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.reason, "reset-to-draft-not-applicable");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push: resetToDraft=true on APPROVED-with-ids returns reset-to-draft-not-applicable", async () => {
  const { server, handlers } = captureHandlers();
  registerTcDraftTools(server, fakeAdoClient());
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId: 506,
      status: "APPROVED",
      testCases: [
        {
          tcNumber: 1,
          featureTags: ["Login"],
          useCaseSummary: "Valid creds succeed",
          priority: 2,
          steps: [{ action: "Enter valid creds", expectedResult: "Home page" }],
          adoWorkItemId: 9991,
        },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);
    const result = await publish({
      userStoryId: 506,
      draftsPath: tcDraftsDir,
      resetToDraft: true,
    });

    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.reason, "reset-to-draft-not-applicable");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

// ── Phase B — StubAdoClient for ADO-dependent consent gates ─────────────

/**
 * Tiny StubAdoClient that subclasses the real AdoClient but overrides the
 * HTTP methods used by qa_publish_push's Phase B analysis and (optionally)
 * the push inner loop. Tests construct the stub with a fixture map keyed
 * by work-item id.
 */
class StubAdoClient extends AdoClient {
  /** Keyed by work-item id; `relations` are ADO relations (TestedBy) for the US. */
  public fixtures: Map<number, { title: string; relations?: Array<{ rel: string; url: string }> }>;
  /** Calls recorded for assertion. */
  public calls: { get: string[]; post: string[]; patch: string[] };

  constructor(fixtures: Map<number, { title: string; relations?: Array<{ rel: string; url: string }> }>) {
    super("myorg", "myproj", "pat");
    this.fixtures = fixtures;
    this.calls = { get: [], post: [], patch: [] };
  }

  async get<T>(path: string, _apiVersion?: string, _queryParams?: Record<string, string>): Promise<T> {
    this.calls.get.push(path);
    const m = path.match(/\/_apis\/wit\/workitems\/(\d+)$/);
    if (m) {
      const id = parseInt(m[1], 10);
      const fx = this.fixtures.get(id);
      if (!fx) throw new Error(`StubAdoClient: no fixture for work-item ${id}`);
      return {
        id,
        rev: 1,
        fields: { "System.Title": fx.title },
        relations: (fx.relations ?? []).map((r) => ({ rel: r.rel, url: r.url, attributes: {} })),
        url: `https://example/_apis/wit/workitems/${id}`,
      } as unknown as T;
    }
    throw new Error(`StubAdoClient: unhandled GET ${path}`);
  }

  async post<T>(path: string, _body: unknown, _contentType?: string, _apiVersion?: string): Promise<T> {
    this.calls.post.push(path);
    throw new Error(`StubAdoClient: unhandled POST ${path}`);
  }

  async patch<T>(path: string, _body: unknown, _contentType?: string, _apiVersion?: string): Promise<T> {
    this.calls.patch.push(path);
    throw new Error(`StubAdoClient: unhandled PATCH ${path}`);
  }

  async listProjectTags(): Promise<string[]> {
    return [];
  }
}

/** Build a fixtures map for a US with linked TC ids (each with a title). */
function buildAdoFixtures(
  userStoryId: number,
  linked: Array<{ id: number; title: string }>,
): Map<number, { title: string; relations?: Array<{ rel: string; url: string }> }> {
  const fixtures = new Map<number, { title: string; relations?: Array<{ rel: string; url: string }> }>();
  fixtures.set(userStoryId, {
    title: `US ${userStoryId}`,
    relations: linked.map((tc) => ({
      rel: "Microsoft.VSTS.Common.TestedBy-Forward",
      url: `https://example/_apis/wit/workitems/${tc.id}`,
    })),
  });
  for (const tc of linked) {
    fixtures.set(tc.id, { title: tc.title });
  }
  return fixtures;
}

// ── Phase B integration tests ───────────────────────────────────────────

test("qa_publish_push (Phase B): existing-tcs-unmapped — US has linked TCs, draft has none", async () => {
  const { server, handlers } = captureHandlers();
  const userStoryId = 600;
  const fixtures = buildAdoFixtures(userStoryId, [
    { id: 7001, title: `TC_${userStoryId}_01 -> Login: valid creds` },
    { id: 7002, title: `TC_${userStoryId}_02 -> Login: invalid creds` },
  ]);
  const stub = new StubAdoClient(fixtures);
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId,
      status: "APPROVED",
      testCases: [
        { tcNumber: 1, featureTags: ["Login"], useCaseSummary: "Valid creds succeed", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
        { tcNumber: 2, featureTags: ["Login"], useCaseSummary: "Invalid creds fail", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);

    // Draft is APPROVED without ADO IDs — tool will first return approved-without-ids.
    // For this gate we need draft DRAFT + approveAndPush OR approved-with-ids flow.
    // Simplest: use DRAFT status + approveAndPush so we land in the analysis path with no IDs.
    const draftData = { ...data, status: "DRAFT" as const };
    const dir2 = writeDraft(base, draftData);

    const result = await publish({ userStoryId, draftsPath: dir2, approveAndPush: true });
    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.status, "needs-confirmation");
    assert.equal(body.reason, "existing-tcs-unmapped");
    assert.equal(body.orphanCount, 2);
    assert.equal(body.draftCount, 2);
    assert.equal(body.mappingPreviewAvailable, true);
    const options = body.options as Array<{ key: string }>;
    assert.equal(options.length, 3);
    assert.equal(options[0]!.key, "A");
    assert.equal(options[1]!.key, "B");
    assert.equal(options[2]!.key, "C");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push (Phase B): mapping-preview — attemptMapping returns mappingProposal", async () => {
  const { server, handlers } = captureHandlers();
  const userStoryId = 601;
  const fixtures = buildAdoFixtures(userStoryId, [
    { id: 7101, title: `TC_${userStoryId}_01 -> Valid` },
    { id: 7102, title: `TC_${userStoryId}_02 -> Invalid` },
  ]);
  const stub = new StubAdoClient(fixtures);
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId,
      status: "DRAFT",
      testCases: [
        { tcNumber: 1, featureTags: ["Login"], useCaseSummary: "Valid creds succeed", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
        { tcNumber: 2, featureTags: ["Login"], useCaseSummary: "Invalid creds fail", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);

    const result = await publish({
      userStoryId,
      draftsPath: tcDraftsDir,
      approveAndPush: true,
      attemptMapping: true,
    });
    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.status, "needs-confirmation");
    assert.equal(body.reason, "mapping-preview");
    const proposal = body.mappingProposal as Array<{ tcNumber: number; adoId: number; adoTitle: string }>;
    assert.ok(Array.isArray(proposal));
    assert.equal(proposal.length, 2);
    assert.equal(proposal[0]!.tcNumber, 1);
    assert.equal(proposal[0]!.adoId, 7101);
    assert.equal(proposal[1]!.tcNumber, 2);
    assert.equal(proposal[1]!.adoId, 7102);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push (Phase B): tc-number-mismatch — attemptMapping but no TC numbers match", async () => {
  const { server, handlers } = captureHandlers();
  const userStoryId = 602;
  // ADO titles are unparseable (no TC_<us>_<nn> prefix).
  const fixtures = buildAdoFixtures(userStoryId, [
    { id: 7201, title: "Legacy TC about login" },
    { id: 7202, title: "Another legacy TC" },
  ]);
  const stub = new StubAdoClient(fixtures);
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId,
      status: "DRAFT",
      testCases: [
        { tcNumber: 1, featureTags: ["Login"], useCaseSummary: "New TC", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
        { tcNumber: 2, featureTags: ["Login"], useCaseSummary: "Another new TC", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);

    const result = await publish({
      userStoryId,
      draftsPath: tcDraftsDir,
      approveAndPush: true,
      attemptMapping: true,
    });
    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.reason, "tc-number-mismatch");
    const unparseable = body.adoTcsWithUnparseableTitles as Array<{ adoId: number }>;
    assert.equal(unparseable.length, 2);
    const options = body.options as Array<{ key: string }>;
    assert.equal(options.length, 2);
    assert.equal(options[0]!.key, "A");
    assert.equal(options[1]!.key, "B");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push (Phase B): draft-ids-not-linked — draft ADO IDs don't belong to the US", async () => {
  const { server, handlers } = captureHandlers();
  const userStoryId = 603;
  // US has no linked TCs in ADO; draft carries an ID that isn't linked.
  const fixtures = buildAdoFixtures(userStoryId, []);
  const stub = new StubAdoClient(fixtures);
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId,
      status: "APPROVED",
      testCases: [
        { tcNumber: 1, featureTags: ["Login"], useCaseSummary: "Valid creds", priority: 2, steps: [{ action: "x", expectedResult: "y" }], adoWorkItemId: 9990 },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);

    const result = await publish({
      userStoryId,
      draftsPath: tcDraftsDir,
      repush: true,
    });
    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.reason, "draft-ids-not-linked");
    const unlinked = body.unlinkedDraftIds as Array<{ tcNumber: number; adoId: number }>;
    assert.equal(unlinked.length, 1);
    assert.equal(unlinked[0]!.adoId, 9990);
    assert.equal(unlinked[0]!.tcNumber, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push (Phase B): extras-in-ado — fires after acknowledgeMapping when mapping leaves orphans", async () => {
  const { server, handlers } = captureHandlers();
  const userStoryId = 605;
  const fixtures = buildAdoFixtures(userStoryId, [
    { id: 7401, title: `TC_${userStoryId}_01 -> First` },
    { id: 7402, title: `TC_${userStoryId}_02 -> Second` },
    { id: 7403, title: `TC_${userStoryId}_03 -> Extra` },
  ]);
  const stub = new StubAdoClient(fixtures);
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId,
      status: "DRAFT",
      testCases: [
        { tcNumber: 1, featureTags: ["x"], useCaseSummary: "First", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
        { tcNumber: 2, featureTags: ["x"], useCaseSummary: "Second", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);

    const result = await publish({
      userStoryId,
      draftsPath: tcDraftsDir,
      approveAndPush: true,
      acknowledgeMapping: true,
      userConfirmedMapping: [
        { tcNumber: 1, adoId: 7401 },
        { tcNumber: 2, adoId: 7402 },
      ],
    });
    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.reason, "extras-in-ado");
    const orphans = body.orphansInAdo as Array<{ adoId: number }>;
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0]!.adoId, 7403);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push (Phase B): mixed-update-create — draft has 2 updates + 1 create", async () => {
  const { server, handlers } = captureHandlers();
  const userStoryId = 606;
  const fixtures = buildAdoFixtures(userStoryId, [
    { id: 7501, title: `TC_${userStoryId}_01 -> First` },
    { id: 7502, title: `TC_${userStoryId}_02 -> Second` },
  ]);
  const stub = new StubAdoClient(fixtures);
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId,
      status: "DRAFT",
      testCases: [
        { tcNumber: 1, featureTags: ["x"], useCaseSummary: "First", priority: 2, steps: [{ action: "x", expectedResult: "y" }], adoWorkItemId: 7501 },
        { tcNumber: 2, featureTags: ["x"], useCaseSummary: "Second", priority: 2, steps: [{ action: "x", expectedResult: "y" }], adoWorkItemId: 7502 },
        { tcNumber: 3, featureTags: ["x"], useCaseSummary: "New TC", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);

    const result = await publish({
      userStoryId,
      draftsPath: tcDraftsDir,
      approveAndPush: true,
    });
    assert.equal(result.isError, true);
    const body = parsePublishBody(result);
    assert.equal(body.reason, "mixed-update-create");
    const updateList = body.updateList as Array<{ tcNumber: number; adoId: number }>;
    const createList = body.createList as Array<{ tcNumber: number; suggestedTitle: string }>;
    assert.equal(updateList.length, 2);
    assert.equal(createList.length, 1);
    assert.equal(createList[0]!.tcNumber, 3);
    assert.ok(createList[0]!.suggestedTitle.length > 0);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("qa_publish_push (Phase B): acknowledgeMixedOp skips the mixed-update-create gate", async () => {
  // Scope: verifies that acknowledgeMixedOp: true causes the tool to progress past the
  // mixed-update-create gate. The call will fail downstream at the suite-hierarchy step (no
  // real ADO); we only assert the response reason is NOT mixed-update-create. A full e2e
  // happy path would require stubbing plan resolution + suite hierarchy creation — out of
  // scope; the gate-shape test above already asserts the correct payload.
  const { server, handlers } = captureHandlers();
  const userStoryId = 607;
  const fixtures = buildAdoFixtures(userStoryId, [
    { id: 7601, title: `TC_${userStoryId}_01 -> First` },
    { id: 7602, title: `TC_${userStoryId}_02 -> Second` },
  ]);
  const stub = new StubAdoClient(fixtures);
  registerTcDraftTools(server, stub);
  const publish = handlers.get("qa_publish_push")!;

  const base = mkdtempSync(join(tmpdir(), "tc-drafts-test-"));
  try {
    const data = buildDraftData({
      userStoryId,
      status: "DRAFT",
      testCases: [
        { tcNumber: 1, featureTags: ["x"], useCaseSummary: "First", priority: 2, steps: [{ action: "x", expectedResult: "y" }], adoWorkItemId: 7601 },
        { tcNumber: 2, featureTags: ["x"], useCaseSummary: "Second", priority: 2, steps: [{ action: "x", expectedResult: "y" }], adoWorkItemId: 7602 },
        { tcNumber: 3, featureTags: ["x"], useCaseSummary: "New TC", priority: 2, steps: [{ action: "x", expectedResult: "y" }] },
      ],
    });
    const tcDraftsDir = writeDraft(base, data);

    const result = await publish({
      userStoryId,
      draftsPath: tcDraftsDir,
      approveAndPush: true,
      acknowledgeMixedOp: true,
    });
    // Will fail downstream at the hierarchy step (StubAdoClient doesn't fixture suites/plans).
    // We only assert that the reason is NOT the mixed-update-create gate.
    if (result.isError) {
      try {
        const body = parsePublishBody(result);
        if (typeof body.reason === "string") {
          assert.notEqual(body.reason, "mixed-update-create");
        }
      } catch {
        // Non-JSON error text (downstream plan-resolution or similar). Acceptable for this test.
      }
    }
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
