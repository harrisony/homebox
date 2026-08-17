---
name: writing
description: >
  Writing style guide for all prose: docs, blogs, skills, READMEs, changelogs, comments, commit messages.
  TRIGGER when: writing or editing markdown, documentation, blog posts, READMEs, skill files, or any non-code prose.
---

# Writing Style

## Punctuation

### Em-dashes

Do not default to em-dashes. Before writing one, think: what is the actual relationship between the clauses?

- **Definition/explanation** → use `:`. "`mutate()`: fire-and-forget, catches errors"
- **Separate statement** → use `.`. "Page param NOT in key. Only filters go in key."
- **Continuation/aside** → use `,`. "Works in components, stores, and nav guards, anywhere `inject()` is available."
- **Genuine interruption or parenthetical contrast** → em-dash is fine. "The plugin system is powerful — perhaps too powerful — for simple use cases."

Most em-dashes in technical writing are lazy `:` or `.` in disguise. Reserve them for moments that genuinely break the sentence flow.

### General

- One idea per sentence. If a sentence has two clauses doing different work, split it.
- Don't stack punctuation tricks. One colon or one parenthetical per sentence max.
- Code references in backticks, no quotes: `useQuery()` not "useQuery()".

## Tone

- Direct and concise. Say what to do, not what could be done.
- Imperative mood for instructions: "Pass a getter function" not "You should pass a getter function".
- No filler: "Note that", "It is worth noting", "As you can see", "Basically".
- No hedging unless genuinely uncertain: "This will work" not "This should work".

## Structure

- Lead with the pattern or rule, then the example. Not the other way around.
- Code examples over prose when possible. A 3-line snippet beats a paragraph.
- Use tables for comparisons, not bullet lists.
- Headers describe content, not actions: "Key Factories" not "How to Use Key Factories".
