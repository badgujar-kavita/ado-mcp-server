/**
 * Tests for `loadConventionsConfigForWorkspace` — the workspace-aware
 * config loader added to fix the bug where `loadConventionsConfig()`
 * resolved configs via `process.cwd()`. For MCP processes Cursor spawns,
 * cwd is `~/.vortex-ado/` (the installer directory) — never the user's
 * project folder. That made `loadConventionsConfig()` fall through to
 * the legacy `~/.vortex-ado/conventions.config.json` (or the bundled
 * fallback), so the agent saw a generic placeholder persona instead of
 * the tenant's configured personas in the rendered draft.
 *
 * The new loader takes the workspace path explicitly. Pure function,
 * no module cache, no cwd / legacy / bundled fallback.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConventionsConfigForWorkspace } from "./config.ts";

function makeWorkspace(configBody: object | null): string {
  const ws = mkdtempSync(join(tmpdir(), "ado-conv-ws-"));
  if (configBody !== null) {
    mkdirSync(join(ws, ".vortex-ado"), { recursive: true });
    writeFileSync(
      join(ws, ".vortex-ado", "config.json"),
      JSON.stringify(configBody, null, 2),
    );
  }
  return ws;
}

test("loadConventionsConfigForWorkspace: reads <root>/.vortex-ado/config.json", () => {
  const ws = makeWorkspace({
    version: 1,
    ado: {
      url: "https://dev.azure.com/myorg",
      org: "myorg",
      project: "myproj",
    },
    prerequisiteDefaults: {
      personas: {
        Admin: {
          label: "Admin",
          profile: "Admin",
          roles: "Admin User",
          psg: "Admin_PSG",
        },
        SalesRep: {
          label: "Sales Rep",
          profile: "Sales_Rep",
          roles: "Sales_Rep",
          psg: "Sale_Rep_PSG",
        },
      },
    },
  });
  try {
    const cfg = loadConventionsConfigForWorkspace(ws);
    assert.deepEqual(Object.keys(cfg.prerequisiteDefaults.personas), [
      "Admin",
      "SalesRep",
    ]);
    assert.equal(cfg.prerequisiteDefaults.personas.Admin.psg, "Admin_PSG");
    assert.equal(cfg.prerequisiteDefaults.personas.SalesRep.label, "Sales Rep");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("loadConventionsConfigForWorkspace: returns framework defaults when no config exists", () => {
  // No .vortex-ado folder at all — caller (qa_draft_save, etc.) should
  // still get a usable ConventionsConfig back, not throw.
  const ws = makeWorkspace(null);
  try {
    const cfg = loadConventionsConfigForWorkspace(ws);
    // Framework defaults — empty personas map, but a usable config shape.
    assert.deepEqual(cfg.prerequisiteDefaults.personas, {});
    assert.equal(cfg.prerequisiteDefaults.personaRolesLabel, "Roles");
    assert.equal(
      cfg.prerequisiteDefaults.personaPsgLabel,
      "Permission Set Group",
    );
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("loadConventionsConfigForWorkspace: throws on malformed config (loud failure)", () => {
  const ws = mkdtempSync(join(tmpdir(), "ado-conv-bad-"));
  mkdirSync(join(ws, ".vortex-ado"), { recursive: true });
  writeFileSync(join(ws, ".vortex-ado", "config.json"), "{ this is not json");
  try {
    assert.throws(() => loadConventionsConfigForWorkspace(ws));
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("loadConventionsConfigForWorkspace: never reads from process.cwd or homedir", () => {
  // Sanity: loading from one workspace must not leak persona data from
  // another. Two separate workspaces, two distinct configs.
  const wsA = makeWorkspace({
    version: 1,
    ado: { url: "https://dev.azure.com/a", org: "a", project: "a" },
    prerequisiteDefaults: {
      personas: {
        Foo: { label: "Foo", profile: "Foo", roles: "FooR", psg: "FooG" },
      },
    },
  });
  const wsB = makeWorkspace({
    version: 1,
    ado: { url: "https://dev.azure.com/b", org: "b", project: "b" },
    prerequisiteDefaults: {
      personas: {
        Bar: { label: "Bar", profile: "Bar", roles: "BarR", psg: "BarG" },
      },
    },
  });
  try {
    const cfgA = loadConventionsConfigForWorkspace(wsA);
    const cfgB = loadConventionsConfigForWorkspace(wsB);
    assert.deepEqual(Object.keys(cfgA.prerequisiteDefaults.personas), ["Foo"]);
    assert.deepEqual(Object.keys(cfgB.prerequisiteDefaults.personas), ["Bar"]);
    // No cross-pollination: cfgA must not contain Bar, cfgB must not contain Foo.
    assert.equal(cfgA.prerequisiteDefaults.personas.Bar, undefined);
    assert.equal(cfgB.prerequisiteDefaults.personas.Foo, undefined);
  } finally {
    rmSync(wsA, { recursive: true, force: true });
    rmSync(wsB, { recursive: true, force: true });
  }
});

test("loadConventionsConfigForWorkspace: merges framework defaults under tenant overlay", () => {
  // Tenant supplies only personas; everything else (sections, separator,
  // testCaseTitle template, image budgets, etc.) must come from defaults.
  const ws = makeWorkspace({
    version: 1,
    ado: { url: "https://dev.azure.com/x", org: "x", project: "y" },
    prerequisiteDefaults: {
      personas: {
        Foo: { label: "Foo", profile: "P", roles: "R", psg: "G" },
      },
    },
  });
  try {
    const cfg = loadConventionsConfigForWorkspace(ws);
    // Tenant value present.
    assert.equal(cfg.prerequisiteDefaults.personas.Foo.label, "Foo");
    // Framework defaults filled in.
    assert.equal(cfg.testCaseTitle.separator, " -> ");
    assert.equal(cfg.testCaseTitle.numberPadding, 2);
    assert.equal(cfg.images?.enabled, false);
    assert.equal(cfg.suiteStructure.tcTitlePrefix, "TC");
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
