---
paths:
  - "backend/internal/sys/validate/**"
---

# Error Handling Pattern

**Location:** `internal/sys/validate/errors.go`

## Error Hierarchy

Custom error types for HTTP responses:

```go
RequestError           // HTTP status + error
FieldErrors            // Multiple field-level errors
UnauthorizedError      // Auth failures
InvalidRouteKeyError   // Route param errors
```

## Usage in Handlers

```go
// Create request error with status code
return validate.NewRequestError(err, http.StatusBadRequest)

// Create field-level error
return validate.NewFieldError("fieldName", "reason")

// Type checking
if validate.IsRequestError(err) {
    // Handle request error
}
```

## Automatic Middleware Conversion

The errchain middleware automatically converts these custom errors to JSON responses:

```json
{
  "error": "error message",
  "statusCode": 400,
  "fields": {
    "fieldName": "reason"
  }
}
```

## Common Status Codes

- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid auth)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate, constraint violation)
- `500` - Internal Server Error

## Handler Error Pattern

```go
func (ctrl *V1Controller) HandleItemCreate() errchain.HandlerFunc {
    return func(w http.ResponseWriter, r *http.Request) error {
        // Parse request
        var input ItemCreate
        if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
            return validate.NewRequestError(err, http.StatusBadRequest)
        }

        // Validate
        if input.Name == "" {
            return validate.NewFieldError("name", "required")
        }

        // Call service
        item, err := ctrl.svc.Items.Create(ctx, input)
        if err != nil {
            return validate.NewRequestError(err, http.StatusInternalServerError)
        }

        return server.Wrap(item)
    }
}
```
