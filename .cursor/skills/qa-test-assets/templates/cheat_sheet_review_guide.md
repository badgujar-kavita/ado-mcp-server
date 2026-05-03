# QA Cheat Sheet Review Guide

Use this guide when reviewing or enhancing an existing QA cheat sheet.

---

## Review Process

Before editing any cheat sheet, analyze and document:

1. **Keep As-Is** — What is already effective and should be preserved
2. **Improvement Opportunities** — Issues, limitations, ambiguities
3. **Structural Changes** — Better section order or organization
4. **Content Changes** — Wording improvements for testability
5. **Prioritized Plan** — High/medium/optional changes

---

## Quality Checklist

- [ ] Decision logic in table format (not prose or if/then bullets)
- [ ] Setup prerequisites separated from scenario variables
- [ ] Outcome language consistent (granted/not granted, visible/hidden, created/not created)
- [ ] FALSE-path behavior explicit (not implied as "default")
- [ ] Debug/triage order included for troubleshooting
- [ ] Regression triggers linked to specific impacted test areas
- [ ] Role-based behavior in matrix format (Role x Action x Outcome)
- [ ] All validations testable (not vague like "works correctly")
- [ ] Executive summary captures the 3 key decision points

---

## Optimization Targets

The cheat sheet should support:

- **Quick decision-making** — What outcome for which condition?
- **Setup validation** — What must be true before testing?
- **Positive/negative test thinking** — What succeeds vs. fails?
- **Troubleshooting** — Where to look when behavior is wrong?
- **Clear distinctions** — Access rules vs. UI behavior vs. permissions

---

## Improvement Priority

**High impact / low effort:**
- Convert if/then rules to decision table
- Add debug/triage order
- Standardize outcome language

**Medium impact:**
- Separate setup prerequisites from scenario variables
- Add regression trigger → impacted area mapping
- Convert role reminders to behavior matrix

**Optional refinements:**
- Add executive summary
- Add scenario variable combination guidance
- Tighten common pitfalls with specific checks

---

## Output Format

When documenting a review, structure as:

1. Overall Assessment (2-3 sentences)
2. Keep As-Is (bullet list)
3. Improvement Opportunities (bullet list)
4. Recommended Changes (prioritized list)
5. Proposed Structure Skeleton (outline)
