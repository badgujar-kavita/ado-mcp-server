import { test } from "node:test";
import assert from "node:assert/strict";
import { basicAuthHeader } from "./basic-auth.ts";

test("parity with legacy ADO PAT header (`:` + pat)", () => {
  const pat = "fake-pat-1234567890";
  const legacy = `Basic ${Buffer.from(":" + pat).toString("base64")}`;
  assert.equal(basicAuthHeader("", pat), legacy);
});

test("parity with legacy Confluence email:token header", () => {
  const email = "user@example.com";
  const token = "confluence-api-token-abc123";
  const legacy = `Basic ${Buffer.from(email + ":" + token).toString("base64")}`;
  assert.equal(basicAuthHeader(email, token), legacy);
});

test("produces a valid Basic auth prefix", () => {
  const header = basicAuthHeader("user", "secret");
  assert.ok(header.startsWith("Basic "));
});

test("base64 payload round-trips to user:secret", () => {
  const header = basicAuthHeader("alice", "p@ssw0rd:with:colons");
  const b64 = header.slice("Basic ".length);
  const decoded = Buffer.from(b64, "base64").toString("utf-8");
  assert.equal(decoded, "alice:p@ssw0rd:with:colons");
});

test("handles empty user (ADO PAT case)", () => {
  const header = basicAuthHeader("", "pat-xyz");
  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf-8");
  assert.equal(decoded, ":pat-xyz");
});
