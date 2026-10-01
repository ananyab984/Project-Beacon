---
description: Plan an over-engineering audit per ponytail ruleset (report only, no edits)
---
Audit the entire codebase for over-engineering — unnecessary abstractions, 
unused flexibility, anything that could be native/stdlib/a one-liner instead. 
Follow the YAGNI ladder from the loaded ruleset.

Do NOT delete, edit, or modify any files. This is a planning pass only.

Output a plan document with:
- File and line range
- What's over-engineered and why
- What it should become instead (native feature / stdlib / one-liner / removal)
- Risk level of the change (safe / needs review / touches shared code)

Group by file. Never touch validation, error handling, security, or 
accessibility in your assessment — flag those as out of scope, not as 
candidates for removal.
