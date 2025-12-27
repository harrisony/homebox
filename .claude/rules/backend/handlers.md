---
paths:
  - "backend/app/api/handlers/v1/v1_ctrl_*.go"
---

# API Handler Implementation Patterns

**Location:** `app/api/handlers/v1/`

## Handler Function Signature

All handlers return `errchain.HandlerFunc` for error-first middleware:

```go
func (ctrl *V1Controller) HandleItemsCreate() errchain.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) error {
        // Handler implementation
        // Return error for automatic error handling
    }
}
```

## Route Parameter Extraction

**UUID Parameters:**
```go
itemID, err := ctrl.routeUUID(r, "id")
if err != nil {
    return err  // Automatically converts to 400 Bad Request
}
```

**Integer Parameters:**
```go
assetID := ctrl.routeID(r)  // Returns int
```

## Context Extraction

**REQUIRED for all authenticated endpoints:**

```go
ctx := services.NewContext(r.Context())
```

This extracts user and group information for multi-tenancy. **Missing this call = security bug.**

See backend/context-security.md for full details on the custom Context pattern.

## Response Wrapping Patterns

**Single Entity:**
```go
item, err := svc.Items.GetOne(ctx, itemID)
if err != nil {
    return validate.NewRequestError(err, http.StatusNotFound)
}

return server.Wrap(item)  // Returns {"item": {...}}
```

**Multiple Entities:**
```go
items, err := svc.Items.GetAll(ctx, query)
if err != nil {
    return validate.NewRequestError(err, http.StatusInternalServerError)
}

return server.WrapResults(items)  // Returns {"items": [...]}
```

**Pagination:**
```go
result, err := svc.Items.Query(ctx, paginationQuery)
if err != nil {
    return err
}

return server.WrapPagination(result)  // Returns with pagination metadata
```

## Error Handling in Handlers

Use typed errors from `validate` package:

```go
// Bad request with custom message
return validate.NewRequestError(
    errors.New("invalid quantity"),
    http.StatusBadRequest,
)

// Field-level error
return validate.NewFieldError("email", "must be valid email address")

// Not found
return validate.NewRequestError(err, http.StatusNotFound)
```

The errchain middleware automatically converts these to JSON responses.

See backend/error-handling.md for full error handling details.

## Complete Handler Example

```go
// HandleItemsCreate godoc
//
//	@Summary	Create Item
//	@Tags		Items
//	@Accept		json
//	@Produce	json
//	@Param		body	body		repo.ItemCreate	true	"Item data"
//	@Success	201		{object}	repo.ItemOut
//	@Failure	400		{object}	server.ErrorResponse
//	@Router		/v1/items [POST]
//	@Security	Bearer
func (ctrl *V1Controller) HandleItemsCreate() errchain.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) error {
        // 1. Extract authenticated context
        ctx := services.NewContext(r.Context())

        // 2. Parse request body
        var input repo.ItemCreate
        if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
            return validate.NewRequestError(err, http.StatusBadRequest)
        }

        // 3. Validate
        if input.Name == "" {
            return validate.NewFieldError("name", "required")
        }

        // 4. Call service layer
        item, err := ctrl.svc.Items.Create(ctx, input)
        if err != nil {
            return validate.NewRequestError(err, http.StatusInternalServerError)
        }

        // 5. Return wrapped response
        w.WriteHeader(http.StatusCreated)
        return server.Wrap(item)
    }
}
```

## Handler Implementation Checklist

When implementing a new handler:

1. ✅ Return `errchain.HandlerFunc`
2. ✅ Extract context with `services.NewContext(r.Context())`
3. ✅ Extract route params with `routeUUID()` or `routeID()`
4. ✅ Parse request body (if POST/PUT/PATCH)
5. ✅ Validate input
6. ✅ Call service layer methods
7. ✅ Return typed errors with `validate.NewRequestError()`
8. ✅ Wrap response with `server.Wrap()` or `server.WrapResults()`
9. ✅ Add Swagger annotations (see backend/swagger.md)
