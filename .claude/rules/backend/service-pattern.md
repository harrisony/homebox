---
paths:
  - "backend/internal/core/services/**"
---

# Service Pattern

**Location:** `backend/internal/core/services/`

## Service Constructor

**File:** `backend/internal/core/services/all.go`

```go
services.New(repos,
    services.WithAutoIncrementAssetID(true),
    services.WithCurrencies(currencies),
)
```

## Functional Options Pattern

Available options:
- `WithAutoIncrementAssetID(bool)` - Enable/disable asset ID auto-increment
- `WithCurrencies([]currencies.Currency)` - Custom currency list

Default behavior:
- Auto-increment asset ID: `true`
- Currencies: Loaded from default collection

## Service Dependencies

- All services require `AllRepos` (panic if nil)
- Services don't directly access DB - only via repositories
- Services implement business logic, validation, and orchestration

## Service Responsibilities

Services handle:
- Business logic and validation
- Orchestrating multiple repository calls
- Transaction coordination
- Permission/authorization checks
- Complex data transformations

Example service method:

```go
func (svc *ItemService) CreateWithAttachments(ctx context.Context, data ItemCreateWithFiles) (*ItemOut, error) {
    // Validate business rules
    if err := svc.validateItem(data); err != nil {
        return nil, err
    }

    // Create item via repository
    item, err := svc.repo.Items.Create(ctx, data.Item)
    if err != nil {
        return nil, err
    }

    // Orchestrate attachment creation
    for _, file := range data.Files {
        _, err := svc.repo.Attachments.Create(ctx, item.ID, file)
        if err != nil {
            return nil, err
        }
    }

    return item, nil
}
```

## Service Layer Benefits

- Keeps handlers thin (just HTTP concerns)
- Centralizes business logic
- Easier to test (mock repositories)
- Reusable across different interfaces (API, CLI, etc.)
