# Environment Setup

## Required Tools

- **Go 1.24+**
- **Node.js LTS**
- **pnpm** (enabled via corepack - `npx corepack enable`)
- **Task** (go-task) - latest via aqua
- **Goose v3.8.0** - database migrations
- **Swaggo** - API documentation generation
- **golangci-lint** - Go linting

### Quick Setup

```bash
task setup          # Install dependencies (runs pnpm install, go mod tidy)
```

### Manual Setup

See `docs/en/contribute/get-started.md` for installation instructions.

### Devcontainer

`.devcontainer/devcontainer.json` provides VSCode container setup with all tools pre-installed.

## Editor Configuration (VSCode)

### Recommended Extensions

- `dbaeumer.vscode-eslint` - ESLint integration (REQUIRED)
- `Vue.volar` - Vue language support
- `bradlc.vscode-tailwindcss` - Tailwind CSS IntelliSense
- `golang.go` - Go language support

### Settings Applied (`.vscode/settings.json`)

- **Format on save disabled** - Use ESLint fix on save instead
- **Flat ESLint config** - `eslint.useFlatConfig: true`
- **Tailwind CSS support** - Vue template support enabled
- **File nesting** - Groups related files (package.json + lock files)

### Key Editor Settings

```json
{
  "editor.formatOnSave": false,
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

**Important:** Use ESLint for formatting, not Prettier directly. Run `task ui:fix` to format code.

### Go Formatting

Uses `golang.go` formatter for `.go` files with standard Go formatting rules.

### Tailwind IntelliSense

Configured with `frontend/tailwind.config.js` for autocomplete in Vue templates.

## Backend Configuration

**Location:** `internal/sys/config/conf.go`

### Configuration System

HomeBox uses `ardanlabs/conf` for configuration with `HBOX_` prefix for all environment variables.

Configuration is loaded from:
1. CLI flags
2. Environment variables (prefixed with `HBOX_`)

### Key Environment Variables

```bash
# Application Mode
HBOX_MODE=production              # or development

# Server
HBOX_WEB_PORT=7745                # API server port

# Database
HBOX_DATABASE_DRIVER=postgres     # or sqlite3
HBOX_DATABASE_SQLITE_PATH=.data/homebox.db?_pragma=busy_timeout=1000&_pragma=journal_mode=WAL&_fk=1
HBOX_DATABASE_USERNAME=homebox    # PostgreSQL only
HBOX_DATABASE_PASSWORD=homebox    # PostgreSQL only
HBOX_DATABASE_DATABASE=homebox    # PostgreSQL only
HBOX_DATABASE_HOST=localhost      # PostgreSQL only
HBOX_DATABASE_PORT=5432           # PostgreSQL only
HBOX_DATABASE_SSL_MODE=disable    # PostgreSQL only

# Storage
HBOX_STORAGE_CONNSTRING=file:///./storage  # Local storage
# or S3: s3://bucket?region=us-west-2
# or Azure: azureblob://container
# or GCS: gs://bucket

# Options
HBOX_OPTIONS_AUTO_INCREMENT_ASSET_ID=true
HBOX_OPTIONS_ALLOW_REGISTRATION=true

# Development Only
UNSAFE_DISABLE_PASSWORD_PROJECTION=yes_i_am_sure  # Disables password projection
```

### Configuration Loading Order

From `app/api/main.go`:

1. **Config loaded** - CLI flags + `HBOX_` environment variables
2. **Database URL setup** - Directory creation for SQLite
3. **Storage directory validation** - Local or cloud storage
4. **Database client created** - ENT client initialization
5. **Repositories created** - With DB client and dependencies
6. **Services created** - With repository dependencies

See [backend-patterns.md](backend-patterns.md#application-initialization-pattern) for full initialization details.

### Development Environment Variables

Set these in your shell or use the `Taskfile.yml` defaults:

```bash
export HBOX_LOG_LEVEL=debug
export HBOX_DATABASE_DRIVER=sqlite3
export HBOX_DATABASE_SQLITE_PATH=.data/homebox.db?_pragma=busy_timeout=1000&_pragma=journal_mode=WAL&_fk=1&_time_format=sqlite
export HBOX_OPTIONS_ALLOW_REGISTRATION=true
export UNSAFE_DISABLE_PASSWORD_PROJECTION=yes_i_am_sure
```

### PostgreSQL Development Setup

```bash
export HBOX_DATABASE_DRIVER=postgres
export HBOX_DATABASE_USERNAME=homebox
export HBOX_DATABASE_PASSWORD=homebox
export HBOX_DATABASE_DATABASE=homebox
export HBOX_DATABASE_HOST=127.0.0.1
export HBOX_DATABASE_PORT=5432
export HBOX_DATABASE_SSL_MODE=disable
```
