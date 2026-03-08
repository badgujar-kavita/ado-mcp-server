#!/usr/bin/env node
/**
 * BLOCKED: This folder is a read-only deployment.
 * Deploy runs only from the main project (MARS ADO MCP).
 * Users receive updates via sync; restart MCP to pick them up.
 */

console.error(`
  ERROR: Do not run deploy from this folder.

  This is a read-only deployment (Center of Excellence (CoE)/MCP Servers).
  Changes are pushed from the main project only.
  When you receive updates (e.g. Google Drive sync), restart the MCP server.
`);
process.exit(1);
