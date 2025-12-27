---
paths:
  - "backend/**/*.go"
---

# Event Bus & WebSocket Architecture

**Location:** `internal/core/services/reporting/eventbus`

## Purpose

Pub/sub messaging for cache invalidation across WebSocket clients

## Events Published

The event bus publishes mutation events for real-time updates:

- `EventLabelMutation` - Label created/updated/deleted
- `EventLocationMutation` - Location created/updated/deleted
- `EventItemMutation` - Item created/updated/deleted
- Additional events can be defined in `eventbus/eventbus.go`

## Handler Registration Pattern

In `backend/app/api/routes.go`:

```go
ctrl.bus.Subscribe(eventbus.EventItemMutation, factory("item.mutation"))
ctrl.bus.Subscribe(eventbus.EventLocationMutation, factory("location.mutation"))
ctrl.bus.Subscribe(eventbus.EventLabelMutation, factory("label.mutation"))
```

The `factory` function creates WebSocket message handlers that broadcast events to connected clients.

## WebSocket Endpoint

- **Endpoint:** `/api/v1/ws/events`
- **Protocol:** JSON messages with `{"event": "item.mutation"}`
- **Filtering:** Broadcasts only to sessions in same group (multi-tenant isolation)
- **Keepalive:** 10-second ping ticker maintains connection

## Publishing Events

When mutating data, publish events to notify WebSocket clients:

```go
// Example from item service
func (svc *ItemService) Create(ctx context.Context, item ItemCreate) (*ItemOut, error) {
    // ... create item ...

    // Publish event
    svc.bus.Publish(eventbus.EventItemMutation, eventbus.EventData{
        GroupID: item.GroupID,
    })

    return result, nil
}
```

## Frontend Integration

- **Composable:** `frontend/composables/use-server-events.ts`
- **Throttling:** 1000ms throttle on mutation events to prevent excessive updates
- **Auto-refresh:** Triggers Pinia store `refresh()` on relevant events

Example frontend usage:

```typescript
// Composable automatically connects and handles events
const { on } = useServerEvents();

on('item.mutation', () => {
    // Refresh items in store
    itemStore.refresh();
});
```

## Testing Gotcha

**CRITICAL:** Event bus MUST run in goroutine in tests or will deadlock:

```go
// In tests
go func() {
    bus.Start()
}()

// Your test code here

bus.Stop()
```
