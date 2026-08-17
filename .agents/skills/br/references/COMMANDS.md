# br Command Reference

## Global Flags

| Flag | Description |
|------|-------------|
| `--json` | JSON output (machine-readable) -- **ALWAYS use for agents** |
| `--format toon` | Token-optimized output (reduced context usage) |
| `--quiet` / `-q` | Suppress output |
| `--verbose` / `-v` | Increase verbosity (-vv for debug) |
| `--no-color` | Disable colored output |
| `--db <path>` | Override database path |
| `--actor <name>` | Set actor for audit trail |
| `--lock-timeout <ms>` | SQLite busy timeout |
| `--no-db` | JSONL-only mode (skip DB) |
| `--allow-stale` | Bypass freshness check |
| `--no-auto-flush` | Skip auto-export after mutations |
| `--no-auto-import` | Skip auto-import before reads |

## Actor Resolution

Resolve actor at runtime for all mutating commands:

```bash
ACTOR="${BR_ACTOR:-assistant}"
```

Use `"$ACTOR"` via `--actor "$ACTOR"` in all create/update/close/reopen/comment operations.

---

## Issue Lifecycle

```bash
ACTOR="${BR_ACTOR:-assistant}"

br init                                              # Initialize workspace
br create --actor "$ACTOR" "Title" -p 1 --type bug   # Create issue
br q --actor "$ACTOR" "Quick note"                   # Quick capture (ID only)
br show <id> --json                                  # Show issue details
br update --actor "$ACTOR" <id> --priority 0         # Update fields
br close --actor "$ACTOR" <id> --reason "Done"       # Close with reason
br close --actor "$ACTOR" <id> --reason "..." --suggest-next --json  # Close and suggest next
br close --actor "$ACTOR" <id> --reason "..." --force --json         # Force close
br reopen --actor "$ACTOR" <id> --reason "..."       # Reopen closed issue
br delete <id>                                       # Delete issue (tombstone)
```

### Create Options

```bash
br create --actor "$ACTOR" "Title" \
  --priority 1 \             # 0=critical, 1=high, 2=medium, 3=low, 4=backlog
  --type task \              # task, bug, feature, epic, question, docs
  --assignee "user@..." \    # Optional assignee
  --labels backend,auth \    # Comma-separated labels
  --description "..."        # Detailed description
```

### Update Options

```bash
br update --actor "$ACTOR" <id> \
  --title "New title" \
  --priority 0 \
  --status in_progress \     # open, in_progress, closed
  --assignee "new@..." \
  --add-label reliability \
  --parent <parent-id> \
  --claim                    # Shorthand for claim-and-start
```

### Bulk Update

```bash
br update --actor "$ACTOR" <id1> <id2> <id3> --priority 2 --add-label triage-reviewed --json
```

---

## Querying

```bash
br list --json                               # All issues
br list --status open --json                 # Filter by status
br list --status open --sort priority --json # Filter and sort
br list --priority 0-1 --json               # Filter by priority range
br list --assignee alice --json              # Filter by assignee

br ready --json                              # Actionable work (not blocked)
br blocked --json                            # Blocked issues

br search "authentication" --json            # Full-text search
br show <id> --json                          # Single issue detail

br stale --days 30 --json                    # Stale issues
br count --by status --json                  # Count with grouping
br stats --json                              # Project statistics
br lint --json                               # Lint issues for problems
```

---

## Dependencies

```bash
br dep add <child> <parent>                  # child depends on parent
br dep add <id> <depends-on> --type blocks   # Explicit block type
br dep remove <child> <parent>               # Remove dependency
br dep list <id> --json                      # Dependencies for issue
br dep tree <id> --json                      # Dependency tree
br dep cycles --json                         # Circular deps (MUST be empty!)
```

---

## Labels

```bash
br label add <id> backend auth               # Add multiple labels
br label remove <id> urgent                  # Remove label
br label list <id>                           # Issue's labels
br label list-all                            # All labels in project
```

---

## Comments

```bash
ACTOR="${BR_ACTOR:-assistant}"
br comments add --actor "$ACTOR" <id> --message "Triage note" --json
br comments list <id> --json
```

---

## Sync

```bash
br sync --flush-only                         # Export DB to JSONL
br sync --import-only                        # Import JSONL to DB
br sync --status                             # Check sync status
```

---

## System

```bash
br doctor                                    # Run diagnostics
br where                                     # Show workspace location
br config list                               # Show all config
br config get id.prefix                      # Get specific value
br config set defaults.priority=1            # Set value
br version                                   # Show version
br upgrade                                   # Self-update (if enabled)
```

---

## JSON Output Examples

```bash
# Get first ready issue
br ready --json | jq '.[0]'

# Filter high priority
br list --json | jq '.issues[] | select(.priority <= 1)'

# Get specific issue field
br show <id> --json | jq '.[0].title'

# Count open issues by type
br list --status open --json | jq '.issues | group_by(.type) | map({type: .[0].type, count: length})'
```
