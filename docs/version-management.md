# Version Management Strategy

**Current Version:** 1.1.0  
**Last Updated:** 2026-04-24

---

## Overview

ADO TestForge MCP follows **Semantic Versioning (SemVer)** with the format `MAJOR.MINOR.PATCH`.

---

## Semantic Versioning Rules

### MAJOR Version (X.0.0)

Increment when making **breaking changes** that require user action or affect existing workflows:

- Remove or rename existing tools/commands
- Change required parameters in tools
- Remove configuration fields that users depend on
- Change file structure in ways that break existing drafts
- Remove or significantly change skill behavior

**Examples:**
- `2.0.0` — Remove TO BE TESTED FOR section (breaking: users with old drafts)
- `3.0.0` — Rename all `/ado-testforge/*` commands to `/testforge/*`

**User Impact:** May require users to update their workflows, documentation, or existing drafts.

---

### MINOR Version (x.Y.0)

Increment when adding **new features** or **enhancements** that are backward-compatible:

- Add new tools/commands
- Add new optional parameters to existing tools
- Add new skills or templates
- Add new documentation features (automation patterns, cheat sheets)
- Enhance existing features without breaking compatibility
- Add new configuration options (with defaults)

**Examples:**
- `1.1.0` — Add automation-friendly expected result patterns
- `1.2.0` — Add test case asset management with folder structure
- `1.3.0` — Add clone_and_enhance_test_cases command
- `1.4.0` — Add version-aware welcome messages

**User Impact:** Users get new capabilities without breaking existing workflows.

---

### PATCH Version (x.y.Z)

Increment when making **bug fixes** or **documentation updates** that don't add features:

- Fix bugs in existing tools
- Fix parsing errors
- Fix formatting issues
- Documentation-only updates
- Internal refactoring with no user-visible changes
- Fix typos or improve error messages
- Performance improvements

**Examples:**
- `1.0.1` — Fix prerequisite parsing bug
- `1.0.2` — Update setup-guide.md with clearer instructions
- `1.0.3` — Fix step formatting in ADO push
- `1.0.4` — Improve error message for missing credentials

**User Impact:** Minimal or none; fixes existing behavior.

---

## Version Bump Workflow

### Before Deploying Changes

1. **Decide version bump type:**
   - Breaking change? → `npm version major`
   - New feature? → `npm version minor`
   - Bug fix or docs? → `npm version patch`

2. **Run npm version command:**
   ```bash
   npm version minor -m "Release v%s - Add automation-friendly patterns"
   ```
   This automatically:
   - Bumps `package.json` version
   - Creates a git commit (e.g., "Release v1.1.0 - Add automation-friendly patterns")
   - Creates a git tag (e.g., "v1.1.0")

3. **Ensure runtime version stays in sync:**
   ```typescript
   const server = new McpServer({
     name: "ado-testforge",
     version: getCurrentVersion(),
   });
   ```
   The runtime now reads the version from `package.json` through `src/version.ts`, so no manual edit is required in `src/index.ts`.

4. **Update `docs/changelog.md`:**
   - Add new section with version number:
   ```markdown
   ## v1.1.0 — 2026-04-15 — Automation-Friendly Patterns
   
   ### New Features
   - Added automation-friendly expected result patterns
   - ...
   ```

5. **Rebuild the distribution bundle:**
   ```bash
   npm run build:dist
   ```

6. **Push to git with tags:**
   ```bash
   git push && git push --tags
   ```
   Vercel rebuilds the tarball automatically on every push to `main` — users pick up updates by re-running the one-line install command.

---

## Changelog Format

Use **version numbers + dates** in changelog headers:

```markdown
## v1.1.0 — 2026-04-15 — Feature Name

### New Features
- Feature 1
- Feature 2

### Bug Fixes
- Fix 1

### Documentation
- Doc update 1

---

## v1.0.1 — 2026-04-10 — Bug Fixes

### Bug Fixes
- Fixed prerequisite parsing
```

---

## Version Tracking Files

| File | Purpose | Update When |
|------|---------|-------------|
| `package.json` | Primary version source | Every release (via `npm version`) |
| `src/version.ts` | Runtime version helper used by the MCP server and setup status flow | Updated only if version-loading logic changes |
| `docs/changelog.md` | Version history with changes | Every release (manual) |
| Git tags | Release markers | Every release (via `npm version`) |
| Welcome message flag file | User's last seen version | Automatically by server |

---

## Current State

- Runtime version metadata is sourced from `package.json`, so server metadata and `check_setup_status` stay aligned.
- Version-aware onboarding uses `~/.ado-testforge-mcp/.ado-testforge-initialized` to track first run and last seen version.
- `docs/changelog.md` now uses versioned headers for current releases so update summaries can reuse the latest section.
- Release tags are still created through the normal `npm version` workflow when used for a release.

---

## Version History

| Version | Date | Type | Summary |
|---------|------|------|---------|
| 1.1.0 | 2026-04-24 | Minor | State-aware welcome flow, version-aware status updates, and silent Confluence skip |
| 1.0.0 | 2026-04-10 | Initial | First stable release with core features |

---

## Optional: Automated Version Bump Script

If release steps become repetitive, a helper script can wrap the standard workflow:

```bash
#!/bin/bash
# Usage: ./scripts/bump-version.sh [major|minor|patch] "Release message"

TYPE=${1:-patch}
MESSAGE=${2:-"Release"}

# 1. Bump package.json
npm version $TYPE -m "Release v%s - $MESSAGE"

# 2. Get new version
VERSION=$(node -p "require('./package.json').version")

echo "✓ Version bumped to $VERSION"
echo "✓ Updated package.json and created tag v$VERSION"
echo ""
echo "Next steps:"
echo "1. Update docs/changelog.md with v$VERSION section"
echo "2. Run: npm run build:dist"
echo "3. Run: git push && git push --tags  (Vercel rebuilds the tarball automatically)"
```

---

## Best Practices

1. **Always version before deploy:** Never deploy without bumping version
2. **Update changelog first:** Write changelog entry before deploying
3. **Test before tagging:** Ensure changes work before creating version tag
4. **Keep runtime version single-sourced:** `package.json` is the source of truth, read by `src/version.ts`
5. **Tag releases:** Always create git tags for traceability
6. **Document breaking changes:** Clearly mark breaking changes in changelog
7. **Follow SemVer strictly:** Don't break semantic versioning rules

---

## Questions & Decisions

**Q: Should we use v prefix for tags?**  
A: Yes. Use `v1.0.0` format for git tags (standard npm convention).

**Q: When do we increment for documentation-only changes?**  
A: Use PATCH version. Documentation is user-facing and valuable.

**Q: What about internal refactoring with no user impact?**  
A: Use PATCH version. It's still a change that could have subtle effects.

**Q: Should we version the dist-package separately?**  
A: No. dist-package inherits version from main package.json.

---

## Future Enhancements

- [ ] Create bump-version.sh script
- [ ] Generate changelog from conventional commits
- [ ] Add release notes to git tags
- [ ] Consider moving changelog to root (CHANGELOG.md)
