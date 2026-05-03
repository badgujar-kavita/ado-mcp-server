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
    credentialsFileExists: true,
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

test("PAT/org/project missing → overall=broken, Next Actions mentions configure", () => {
  const status = computeSetupStatus({
    creds: null,
    credentialsFileExists: false,
    credsPath: "/fake/home/.ado-testforge-mcp/credentials.json",
  });

  assert.equal(status.overall, "broken");
  // Three ADO rows + one credentials-file row all marked fail.
  const failRows = status.rows.filter((r) => r.status === "fail");
  assert.ok(failRows.length >= 4, "expected at least 4 fail rows");
  const names = failRows.map((r) => r.name);
  assert.ok(names.includes("ADO PAT"));
  assert.ok(names.includes("ADO Organization"));
  assert.ok(names.includes("ADO Project"));

  // Next Actions contains the PAT-specific remediation.
  assert.ok(status.nextActions.length >= 1);
  const joined = status.nextActions.join("\n");
  assert.ok(/configure/i.test(joined), "next actions should mention configure");
  assert.ok(/PAT/i.test(joined), "next actions should mention PAT");

  // When the credentials file does not exist, ado_connect_save alternative
  // should be surfaced.
  assert.ok(/ado_connect_save/.test(joined));
});

test("PAT present but Confluence missing → overall=degraded, Next Actions mentions Confluence as optional", () => {
  const status = computeSetupStatus({
    creds: fullCreds({
      confluence_base_url: undefined,
      confluence_email: undefined,
      confluence_api_token: undefined,
    }),
    credentialsFileExists: true,
    tcDraftsPath: null,
  });

  assert.equal(status.overall, "degraded");
  const byName = Object.fromEntries(status.rows.map((r) => [r.name, r]));
  assert.equal(byName["Confluence"]!.status, "optional-missing");
  assert.ok(byName["ADO PAT"]!.status === "pass");

  assert.equal(status.nextActions.length, 1);
  const action = status.nextActions[0]!;
  assert.ok(/Confluence|confluence_/i.test(action));
  assert.ok(/optional/i.test(action), "should clearly flag as optional");
});

test("formatSetupStatus renders an Overall line, Markdown table, and Next Actions block", () => {
  const status = computeSetupStatus({
    creds: fullCreds(),
    credentialsFileExists: true,
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
