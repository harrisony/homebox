---
paths:
  - "backend/internal/data/repo/**"
---

# Repository Pattern

**Location:** `backend/internal/data/repo/`

## Repository Constructor

**File:** `backend/internal/data/repo/repos_all.go`

```go
func New(
    db *ent.Client,
    bus *eventbus.EventBus,
    storage config.Storage,
    pubSubConn string,
    thumbnail config.Thumbnail,
) *AllRepos
```

## Dependencies

- `db` - ENT database client
- `bus` - Event bus for mutation broadcasts
- `storage` - gocloud.dev storage config (file paths or cloud URLs)
- `pubSubConn` - Pub/sub connection string (for async processing)
- `thumbnail` - Thumbnail generation config

## Repository Injection Pattern

- Repositories that publish events require `bus` parameter in constructor
- Attachment repository requires all storage parameters
- Items repository depends on Attachments repository (passed as parameter)

## Repository Responsibilities

Repositories handle:
- Database queries via ENT
- Data transformation (entity → DTO)
- Transaction management
- Event publishing for mutations
- Pagination logic

Example repository method:

```go
func (r *ItemRepository) Create(ctx context.Context, data ItemCreate) (*ItemOut, error) {
    item, err := r.db.Item.Create().
        SetName(data.Name).
        SetGroupID(data.GroupID).
        Save(ctx)
    if err != nil {
        return nil, err
    }

    // Publish mutation event
    r.bus.Publish(eventbus.EventItemMutation, eventbus.EventData{
        GroupID: data.GroupID,
    })

    return r.transform(item), nil
}
```

## Key Pattern: Don't Bypass Repositories

Services should **always** use repositories, never access ENT client directly. This ensures:
- Consistent event publishing
- Proper transaction handling
- Centralized query logic
