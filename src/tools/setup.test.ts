import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSetupStatus,
  formatSetupStatus,
  type SetupStatus,
} from "./setup.ts";
import type { Credentials } from "../credentials.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────

function fullCreds(overrides: Partial<Credentials> = {}): Credentials {
  return {
    ado_pat: "pat-value",
    ado_org: "myorg",
    ado_project: "myproj",
    confluence_base_url: "https://example.atlassian.net/wiki",
    confluence_email: "user@example.com",
    confluence_api_token: "conf-token",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("all credentials present + Confluence configured → overall=healthy, no Next Actions", () => {
  const status: SetupStatus = computeSetupStatus({
    creds: fullCreds(),
    workspaceConfigPath: "/tmp/.vortex-ado/config.json",
    tcDraftsPath: "/tmp/tc-drafts",
  });

  assert.equal(status.overall, "healthy");
  assert.equal(status.nextActions.length, 0);

  const byName = Object.fromEntries(status.rows.map((r) => [r.name, r]));
  assert.equal(byName["ADO PAT"]!.status, "pass");
  assert.equal(byName["ADO Organization"]!.status, "pass");
  assert.equal(byName["ADO Organization"]!.detail, "myorg");
  assert.equal(byName["ADO Project"]!.status, "pass");
  assert.equal(byName["ADO Project"]!.detail, "myproj");
  assert.equal(byName["Confluence"]!.status, "pass");
  assert.ok(byName["Confluence"]!.detail.includes("example.atlassian.net"));
  assert.equal(byName["TC Drafts path"]!.status, "pass");
});

test("PAT/org/project missing → overall=broken, Next Actions mentions ado-connect", () => {
  const status = computeSetupStatus({
    creds: null,
    workspaceConfigPath: "/fake/workspace/.vortex-ado/config.json",
  });

  assert.equal(status.overall, "broken");
  // Workspace-config row + three ADO rows all marked fail.
  const failRows = status.rows.filter((r) => r.status === "fail");
  assert.ok(failRows.length >= 4, "expected at least 4 fail rows");
  const names = failRows.map((r) => r.name);
  assert.ok(names.includes("ADO PAT"));
  assert.ok(names.includes("ADO Organization"));
  assert.ok(names.includes("ADO Project"));
  assert.ok(names.includes("Workspace config"));

  // The fail-row detail should reference the workspace path we passed in.
  const wsRow = status.rows.find((r) => r.name === "Workspace config")!;
  assert.ok(wsRow.detail.includes("/fake/workspace/.vortex-ado/config.json"));

  // Next Actions points the user at /vortex-ado/ado-connect.
  assert.ok(status.nextActions.length >= 1);
  const joined = status.nextActions.join("\n");
  assert.ok(/ado-connect/i.test(joined), "next actions should reference /vortex-ado/ado-connect");
});

test("PAT present but Confluence missing → overall=degraded, Next Actions mentions Confluence as optional", () => {
  const status = computeSetupStatus({
    creds: fullCreds({
      confluence_base_url: undefined,
      confluence_email: undefined,
      confluence_api_token: undefined,
    }),
    workspaceConfigPath: "/tmp/.vortex-ado/config.json",
    tcDraftsPath: null,
  });

  assert.equal(status.overall, "degraded");
  const byName = Object.fromEntries(status.rows.map((r) => [r.name, r]));
  assert.equal(byName["Confluence"]!.status, "optional-missing");
  assert.ok(byName["ADO PAT"]!.status === "pass");

  assert.equal(status.nextActions.length, 1);
  const action = status.nextActions[0]!;
  assert.ok(/Confluence/i.test(action));
  assert.ok(/optional/i.test(action), "should clearly flag as optional");
});

test("formatSetupStatus renders an Overall line, Markdown table, and Next Actions block", () => {
  const status = computeSetupStatus({
    creds: fullCreds(),
    workspaceConfigPath: "/tmp/.vortex-ado/config.json",
    tcDraftsPath: "/tmp/tc-drafts",
  });
  const rendered = formatSetupStatus(status);

  assert.ok(rendered.startsWith("**Overall:** HEALTHY"));
  assert.ok(rendered.includes("| Check | Status | Detail |"));
  assert.ok(rendered.includes("|---|---|---|"));
  assert.ok(rendered.includes("| ADO PAT | ✓ | Configured |"));
  assert.ok(rendered.includes("**Next Actions:**"));
  // Healthy → "None — all checks pass."
  assert.ok(rendered.includes("None — all checks pass."));
});
