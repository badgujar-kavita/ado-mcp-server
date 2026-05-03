/**
 * Canonical read-result shape for ado-mcp read tools.
 *
 * Adapted from jira-mcp-server-v2's src/tools/read-result.ts. Every read
 * tool that is migrated to `server.registerTool(...)` returns this
 * object alongside its prose via MCP's `structuredContent` field on
 * CallToolResult, so agents (and structured-content clients) don't have
 * to re-parse the prose text to discover item metadata, children,
 * artifacts, or completeness.
 *
 * ── Deviations from jira-mcp's CanonicalReadResult ──────────────────
 *
 * 1. `item.id` is `string | number` here (ADO work-item IDs are numeric;
 *    Confluence page IDs are stringy). jira-mcp pinned `string` because
 *    Jira issue keys are always strings.
 *
 * 2. `item.type` is present and required. ADO has several read targets
 *    (user-story, test-case, test-suite, confluence-page, …) — the type
 *    tag lets clients branch on it without name-matching.
 *
 * 3. `children[]` is flat (no recursive `children` array). jira-mcp used
 *    a recursive node type to represent multi-level nested hierarchies
 *    (e.g. linked issues of linked issues). ado-mcp's Tier-1 scope only
 *    surfaces parent and direct children (test cases in a suite, parent
 *    user story, etc.) — the extra layer is YAGNI for now. Each child
 *    carries `type` + `relationship` instead of nesting.
 *
 * 4. `artifacts[].kind` (free-form string: "solution-design",
 *    "attachment", "image", …) instead of jira-mcp's enum
 *    ("diagram" | "image" | "table" | "section" | "file" | "other").
 *    ADO's artifact taxonomy hasn't stabilised — keep it open-form until
 *    we see the patterns.
 *
 * 5. Top-level `summary` moved inside `item.summary` (optional). The
 *    distinction between "summary of the whole read" and "summary of the
 *    item" is meaningful in Jira (multiple children may exist); in ADO
 *    the item is usually the main content and a single summary line
 *    suffices.
 *
 * 6. `completeness` is minimal: just `{ isPartial, reason? }`. Dropped
 *    jira-mcp's `foundCount` / `expectedCount` counters — ado-mcp's Tier-1
 *    tools don't currently produce truncation caps where those counters
 *    would be meaningful.
 *
 * 7. `diagnostics[]` is new — structured info/warning/error messages
 *    (e.g. "unfetched link present", "Confluence fetch failed with
 *    403"). jira-mcp folded diagnostics into the prose only; surfacing
 *    them structured lets the agent reason about them without parsing.
 *
 * 8. Dropped `suggestedNextActions`. ado-mcp's prompts already carry the
 *    equivalent guidance (INTERACTIVE_READ_CONTRACT from Phase 1); a
 *    second channel for it is noise.
 *
 * Additive: `content[0].text` is preserved byte-for-byte from the
 * pre-migration prose. `structuredContent` is ignored by clients that
 * don't speak the 2025-06-18 spec revision. Existing tests on prose
 * substrings continue to pass.
 */

import { z } from "zod";

/** One related entity referenced from the read target. Flat (no recursion). */
export interface CanonicalReadChild {
  id: string | number;
  type: string;
  title: string;
  /**
   * Relationship of this child to the item (e.g. "parent", "child",
   * "linked-test-case", "contained").
   */
  relationship?: string;
}

/** One artifact mentioned but not inlined (image, attached doc, Confluence page, …). */
export interface CanonicalReadArtifact {
  /**
   * Free-form kind tag (e.g. "solution-design", "attachment", "image",
   * "diagram"). Open-form on purpose; see deviation #4 above.
   */
  kind: string;
  title: string;
  url?: string;
  summary?: string;
}

/** Explicit retrieval-completeness metadata. Never imply completeness the tool didn't claim. */
export interface CanonicalReadCompleteness {
  isPartial: boolean;
  /** Human-readable reason when isPartial=true (e.g. "2 Confluence links failed to fetch"). */
  reason?: string;
}

/** Structured info/warning/error produced during a read. */
export interface CanonicalReadDiagnostic {
  severity: "info" | "warning" | "error";
  message: string;
}

export interface CanonicalReadResult {
  item: {
    id: string | number;
    /**
     * Domain type, e.g. "user-story", "test-case", "test-suite",
     * "confluence-page". Free-form; tools emit the string of their
     * choosing but stick to the canonical values listed where they
     * exist.
     */
    type: string;
    title: string;
    /** Optional short prose summary of the item (≤~500 chars). */
    summary?: string;
  };
  /** Parent + directly-linked items. Flat list (no nesting). */
  children?: CanonicalReadChild[];
  /** Mentioned-but-not-inlined artifacts (images, Confluence pages, files). */
  artifacts?: CanonicalReadArtifact[];
  completeness: CanonicalReadCompleteness;
  /** Structured diagnostics (partial-fetch warnings, auth errors, …). */
  diagnostics?: CanonicalReadDiagnostic[];
}

/**
 * Shape of an MCP tool's return value when an outputSchema is declared.
 * `structuredContent` is validated against `outputSchema` by
 * McpServer.validateToolOutput.
 *
 * The MCP SDK types `structuredContent` as `Record<string, unknown>` at
 * the wire boundary; we keep the strong `CanonicalReadResult` type
 * inside the tool handler and widen only when building the return
 * value (see `toReadToolResult`).
 */
export interface ReadToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  >;
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

/**
 * Zod raw shape for the canonical read result. Passed as
 * `config.outputSchema` on `server.registerTool(...)`. McpServer
 * normalises this into a Zod object and validates the tool's
 * `structuredContent` against it on every call.
 *
 * Shape-only (Record<string, ZodTypeAny>) because that's what
 * registerTool expects for outputSchema / inputSchema.
 *
 * We deliberately do NOT call `.strict()` (i.e. extra props are
 * allowed) so adding new fields to CanonicalReadResult later stays
 * backwards-compatible with old clients.
 */
export const READ_OUTPUT_SCHEMA = {
  item: z.object({
    id: z.union([z.string(), z.number()]),
    type: z.string(),
    title: z.string(),
    summary: z.string().optional(),
  }),
  children: z
    .array(
      z.object({
        id: z.union([z.string(), z.number()]),
        type: z.string(),
        title: z.string(),
        relationship: z.string().optional(),
      }),
    )
    .optional(),
  artifacts: z
    .array(
      z.object({
        kind: z.string(),
        title: z.string(),
        url: z.string().optional(),
        summary: z.string().optional(),
      }),
    )
    .optional(),
  completeness: z.object({
    isPartial: z.boolean(),
    reason: z.string().optional(),
  }),
  diagnostics: z
    .array(
      z.object({
        severity: z.enum(["info", "warning", "error"]),
        message: z.string(),
      }),
    )
    .optional(),
} as const;

/**
 * Build the dual-shape return value for a read tool. Keeps prose (and
 * any extra content parts such as ADO image attachments) as the primary
 * surface and adds the canonical object as structuredContent.
 *
 * The prose parameter is emitted as a single `{ type: "text" }` part.
 * Callers that need additional content parts (e.g. image parts from
 * `get_user_story`) should use the 3-arg form.
 */
export function toReadToolResult(
  prose: string,
  canonical: CanonicalReadResult,
  extraContent: Array<{ type: "image"; data: string; mimeType: string }> = [],
): ReadToolResult {
  return {
    content: [
      { type: "text", text: prose },
      ...extraContent,
    ],
    structuredContent: canonical as unknown as Record<string, unknown>,
  };
}
