---
name: "Post-Install Welcome and Orientation"
overview: "A concise, user-friendly welcome experience that introduces ADO TestForge MCP, summarizes current capabilities, and outlines best practices for scalability, reliability, and maintainability."
todos: []
isProject: false
---

# Post-Install Welcome and Orientation

## Overview

After installation, greet the user with a clear, professional welcome message that explains what ADO TestForge MCP is, what it can do today, and how to get the most out of it. The message should be accessible to both technical and non-technical stakeholders — no jargon walls, no setup fatigue.

---

## Welcome Message

When a user completes installation (or runs `check_status` for the first time), the server should present a welcome message along these lines:

> **Welcome to ADO TestForge MCP**
>
> ADO TestForge MCP connects your Cursor IDE directly to Azure DevOps, giving you AI-assisted test case management without leaving your editor. It reads User Stories, fetches Solution Design context from Confluence, and helps you draft, review, and push test cases — all through natural-language commands in Cursor's AI chat.
>
> Think of it as your QA co-pilot: it understands your User Story context, follows your team's naming conventions and formatting rules, and handles the repetitive ADO plumbing (folder structures, query-based suites, field mappings) so you can focus on test quality.

**Tone:** Conversational but professional. No marketing fluff. Explain the "what" and "why" in plain language.

---

## Current Functionality

### User Story Context
- Fetch User Stories with full QA context and auto-fetch linked Solution Design from Confluence

### Test Suite Management
- Auto-build the complete suite folder hierarchy from just a User Story ID

### Test Case Drafting
- Draft test cases in markdown for review, then push approved drafts to ADO

### Test Case Management
- Create, read, update, and delete test cases with convention-driven formatting

### Confluence Integration
- Solution Design pages are fetched automatically when linked in the User Story

### Configuration-Driven
- All naming patterns, formats, and defaults are externalized in `conventions.config.json`

---

## Best Practices

### Scalability

- All conventions are externalized in config — update rules without changing code
- Each tool does one thing well; complex workflows are composed by the AI prompt layer
- Prompts and skills are separate from tool logic — new use cases often need only a new prompt
- Per-user credentials and global registration make multi-project use straightforward

### Maintainability

- Updates are deployed to Google Drive automatically via `npm run deploy` — users just refresh the MCP server in Cursor Settings to get the latest changes, no manual syncing required

---

## Todos

- [ ] Implement a welcome message in `check_setup_status` output that displays on first successful status check (or always, as a brief header)
- [ ] Add a concise feature summary to the welcome output so new users understand what's available immediately
- [ ] Review and update `docs/setup-guide.md` to reference the welcome experience
- [ ] Run `npm run deploy` after changes
