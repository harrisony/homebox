---
paths:
  - "backend/**/*_test.go"
---

# Testing Patterns

**Location:** `internal/core/services/main_test.go`, `internal/data/repo/main_test.go`

## Test Database Setup

Use in-memory SQLite for fast tests:

```go
// Create in-memory client
client, _ := ent.Open("sqlite3",
    "file:ent?mode=memory&cache=shared&_fk=1&_time_format=sqlite")

// Create schema
client.Schema.Create(context.Background())

// Create repositories with event bus
tRepos = repo.New(tClient, tbus, storage, pubsub, thumbnail)

// Bootstrap test data
bootstrap()
```

## SQLite Test Parameters

- `mode=memory` - In-memory database (fast, isolated)
- `cache=shared` - Allows multiple connections
- `_fk=1` - Enables foreign key constraints
- `_time_format=sqlite` - SQLite-compatible time format

## Test Factories with Faker

Use faker package for test data generation:

```go
fk := faker.NewFaker()

user := tRepos.Users.Create(ctx, repo.UserCreate{
    Name: fk.Str(10),
    Email: fk.Email(),
})

item := tRepos.Items.Create(ctx, repo.ItemCreate{
    Name: fk.Str(20),
    Description: fk.Str(100),
    Quantity: fk.IntBetween(1, 100),
})
```

## Event Bus in Tests

**CRITICAL:** Event bus MUST run in goroutine or tests will deadlock:

```go
func TestMain(m *testing.M) {
    // Start event bus in background
    go func() {
        tbus.Start()
    }()

    // Run tests
    code := m.Run()

    // Cleanup
    tbus.Stop()
    os.Exit(code)
}
```

## Test Cleanup Pattern

Use modern `t.Cleanup()` instead of `defer`:

```go
func TestItemCreate(t *testing.T) {
    item := createTestItem(t)

    t.Cleanup(func() {
        tRepos.Items.Delete(ctx, item.ID)
    })

    // Test code here
}
```

## Critical Testing Gotchas

1. **Event bus deadlock:** Must run in goroutine or tests hang
2. **Foreign keys:** Must enable with `_fk=1` or relationships break
3. **Shared cache:** Use `cache=shared` for multiple connections
4. **AssetID auto-increment:** Disabled by default in tests (enable if needed)
5. **Transaction isolation:** In-memory DB doesn't persist between connections
6. **Test data cleanup:** Use `t.Cleanup()` for reliable cleanup
