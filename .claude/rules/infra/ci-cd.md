# CI/CD & Testing

## GitHub Actions Workflows

### Backend Testing Workflow

**File:** `.github/workflows/partial-backend.yaml`

#### Configuration

- **Go Version:** 1.24
- **Runner:** Ubuntu latest

#### Jobs

1. **Build:**
   ```bash
   task go:build
   ```

2. **Test with Coverage:**
   ```bash
   task go:coverage
   ```
   - Runs with `-race` flag to detect race conditions
   - Generates coverage report
   - Tests all packages: `./app/...`, `./internal/...`, `./pkgs/...`

3. **Linting:**
   ```bash
   golangci-lint run
   ```
   - Timeout: 6 minutes
   - Configuration: `.golangci.yml`

### Frontend Testing Workflow

**File:** `.github/workflows/partial-frontend.yaml`

#### Configuration

- **Node.js Version:** LTS
- **Package Manager:** pnpm
- **Runner:** Ubuntu latest

#### Jobs

1. **Linting:**
   ```bash
   pnpm run lint:ci
   ```

2. **Type Checking:**
   ```bash
   pnpm run typecheck
   ```

3. **Integration Tests (PostgreSQL):**
   - Matrix: PostgreSQL 15, 16, 17
   - Tests with both SQLite and PostgreSQL
   - Commands:
     ```bash
     task test:ci              # SQLite tests
     task test:ci:postgresql   # PostgreSQL tests
     ```

### PostgreSQL Version Matrix

**Tested Versions:**
- PostgreSQL 15
- PostgreSQL 16
- PostgreSQL 17

This ensures backward compatibility across PostgreSQL versions.

#### PostgreSQL Service Configuration

```yaml
services:
  postgres:
    image: postgres:${{ matrix.postgres-version }}
    env:
      POSTGRES_USER: homebox
      POSTGRES_PASSWORD: homebox
      POSTGRES_DB: homebox
    ports:
      - 5432:5432
    options: >-
      --health-cmd pg_isready
      --health-interval 10s
      --health-timeout 5s
      --health-retries 5
```

## Service Ports

### Development Ports

- **Backend API:** 7745
- **Frontend Dev Server:** 3000
- **PostgreSQL (local/CI):** 5432

### Production Deployment

- **Container Port:** 7745 (maps to host port 3100 in Docker Compose example)

## Testing Requirements

### Backend Tests

**Requirements:**
- Go 1.24+ (1.25 for development via mise)
- SQLite3 or PostgreSQL database
- Environment variables set (see `Taskfile.yml`)

**Run Tests:**
```bash
task go:test            # Run all tests
task go:coverage        # Run with coverage
```

**Individual Test:**
```bash
cd backend
go test -v ./internal/data/repo -run TestItemRepository
```

### Frontend Tests

**Requirements:**
- Backend API server must be running
- Node.js LTS
- pnpm installed

**Run Tests:**
```bash
# Start backend first
task go:run

# In another terminal
cd frontend
pnpm test:watch         # Watch mode
pnpm test:ci            # CI mode (run once)
```

**Important:** Frontend tests require backend running - tests may fail on first run due to race conditions (re-run if needed).

### End-to-End Tests

**Requirements:**
- Playwright installed
- Backend built and running

**Run E2E Tests:**
```bash
task test:e2e           # Runs Playwright tests (starts backend automatically)
```

**Manual E2E:**
```bash
# Build frontend
cd frontend
pnpm build

# Copy to backend static
cp -r .output/public ../backend/app/api/static/

# Start backend
task go:ci

# Run Playwright
cd frontend
pnpm exec playwright test -c ./test/playwright.config.ts
```

## Environment Variables for CI

### Backend

```bash
HBOX_LOG_LEVEL=debug
HBOX_DATABASE_DRIVER=sqlite3  # or postgres
HBOX_DATABASE_SQLITE_PATH=.data/homebox.db?_pragma=busy_timeout=1000&_pragma=journal_mode=WAL&_fk=1&_time_format=sqlite
HBOX_OPTIONS_ALLOW_REGISTRATION=true
UNSAFE_DISABLE_PASSWORD_PROJECTION=yes_i_am_sure  # Development only
```

### PostgreSQL

```bash
HBOX_DATABASE_DRIVER=postgres
HBOX_DATABASE_USERNAME=homebox
HBOX_DATABASE_PASSWORD=homebox
HBOX_DATABASE_DATABASE=homebox
HBOX_DATABASE_HOST=127.0.0.1
HBOX_DATABASE_PORT=5432
HBOX_DATABASE_SSL_MODE=disable
```

## CI/CD Best Practices

### 1. Run Full PR Checks Locally

Before pushing:

```bash
task pr
```

This runs:
- Code generation
- Go linting and tests
- Frontend type checking
- Frontend linting
- CI tests

### 2. Database Testing

Always test with both SQLite and PostgreSQL:

```bash
# SQLite
task go:test

# PostgreSQL
# Start PostgreSQL first (Docker, local install, etc.)
HBOX_DATABASE_DRIVER=postgres \
HBOX_DATABASE_USERNAME=homebox \
HBOX_DATABASE_PASSWORD=homebox \
HBOX_DATABASE_DATABASE=homebox \
HBOX_DATABASE_HOST=localhost \
HBOX_DATABASE_PORT=5432 \
HBOX_DATABASE_SSL_MODE=disable \
task go:test
```

### 3. Frontend Testing Strategy

- **Unit Tests (Vitest):** Test utilities, composables, stores
- **Integration Tests (Vitest):** Test API calls with live backend
- **E2E Tests (Playwright):** Test user workflows in browser

### 4. Coverage Requirements

- Backend coverage generated via `task go:coverage`
- Coverage report: `backend/coverage.out`
- View coverage: `go tool cover -html=coverage.out`

### 5. Race Condition Detection

Backend tests run with `-race` flag to detect race conditions:

```bash
task go:coverage  # Includes -race flag
```

Common race conditions to watch for:
- Event bus publishing/subscribing
- Concurrent repository access
- Shared state in services

## Troubleshooting CI Failures

### Backend Build Fails

1. Check Go version compatibility (CI uses 1.24)
2. Run `task go:tidy` to fix module issues
3. Run `task go:build` locally to reproduce

### Backend Tests Fail

1. Check environment variables are set
2. Ensure database is accessible
3. Run locally with same DB (SQLite or PostgreSQL)
4. Check for race conditions: `task go:coverage`

### Frontend Lint Fails

1. Run `task ui:fix` to auto-fix issues
2. Check ESLint configuration: `frontend/.eslintrc.cjs`
3. Verify flat config: `eslint.useFlatConfig: true`

### Frontend Tests Fail

1. Ensure backend is running: `task go:run`
2. Check backend is accessible on port 7745
3. Re-run tests (first run may have race conditions)
4. Check test logs for specific failures

### PostgreSQL Integration Tests Fail

1. Verify PostgreSQL service is healthy in CI
2. Check connection parameters (host, port, credentials)
3. Ensure migrations ran successfully
4. Test locally with same PostgreSQL version

### E2E Tests Fail

1. Check Playwright is installed: `pnpm exec playwright install`
2. Ensure frontend is built: `pnpm build`
3. Check backend is running with embedded frontend
4. Verify port 7745 is accessible
5. Check test screenshots/videos in `frontend/test/e2e/results/`

## Monitoring CI Performance

### Workflow Duration Targets

- **Backend Tests:** < 5 minutes
- **Frontend Lint/Typecheck:** < 3 minutes
- **Integration Tests (per PostgreSQL version):** < 10 minutes
- **E2E Tests:** < 15 minutes

### Optimization Tips

1. **Parallel Testing:** Tests run in parallel by default
2. **Cache Dependencies:** pnpm/Go modules cached between runs
3. **Matrix Testing:** PostgreSQL versions tested in parallel
4. **Artifact Cleanup:** Remove old artifacts to save space
