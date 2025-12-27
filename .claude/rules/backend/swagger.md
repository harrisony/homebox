---
paths:
  - "backend/app/api/handlers/v1/v1_ctrl_*.go"
---

# Swagger Annotation Pattern

All API handlers must include comprehensive Swagger annotations for automatic API documentation generation.

## Required Annotations

Every handler function should include:

```go
// HandleFunctionName godoc
//
//	@Summary	Short description (one line)
//	@Description Optional detailed description (can be multiple lines)
//	@Tags		EntityName
//	@Accept		json
//	@Produce	json
//	@Param		paramName	path/query/body	type	required	"description"
//	@Success	200			{object}		ResponseType
//	@Failure	400			{object}		ErrorType
//	@Router		/v1/path [METHOD]
//	@Security	Bearer
```

## Annotation Details

### @Summary
- Single-line description of what the endpoint does
- Should be concise (< 80 characters)
- Starts with a verb (e.g., "Get", "Create", "Update", "Delete")

### @Description (Optional)
- Multi-line detailed description
- Explain edge cases, behavior, or important notes
- Use markdown formatting if needed

### @Tags
- Groups endpoints in Swagger UI
- Use entity name (e.g., "Items", "Locations", "Labels")
- Consistent casing and naming

### @Accept / @Produce
- `@Accept json` - Handler accepts JSON requests
- `@Produce json` - Handler returns JSON responses
- Also supports: `@Produce octet-stream` for file downloads

### @Param
Format: `@Param name location type required "description"`

**Locations:**
- `path` - URL path parameter (e.g., `/items/{id}`)
- `query` - URL query parameter (e.g., `?page=1`)
- `body` - Request body (JSON)
- `header` - HTTP header

**Types:**
- Primitives: `string`, `int`, `bool`, `float64`
- Objects: `{object}` with type reference
- Arrays: Use Go type notation

**Examples:**
```go
//	@Param		id			path		string		true	"Item ID (UUID)"
//	@Param		page		query		int			false	"Page number"
//	@Param		body		body		ItemCreate	true	"Item creation data"
```

### @Success / @Failure
Format: `@Success statusCode {object} TypeName`

**Common Status Codes:**
- `200` - OK (successful GET, PUT, DELETE)
- `201` - Created (successful POST)
- `204` - No Content (successful DELETE with no response)
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (missing/invalid auth)
- `404` - Not Found (resource not found)
- `500` - Internal Server Error

**Response Types:**
- Use actual Go types from `repo` or `services` packages
- Pagination: `repo.PaginationResult[repo.ItemSummary]{}`
- Single entity: `repo.ItemOut`
- Error: `server.ErrorResponse` or `v1.Err`

### @Router
Format: `@Router /v1/path [METHOD]`

- Path must match actual route in `routes.go`
- Method: GET, POST, PUT, PATCH, DELETE
- Use `/v1/` prefix for all API routes

### @Security
- `@Security Bearer` - Requires JWT authentication
- Omit for public endpoints (login, registration)

## Complete Example from Codebase

```go
// HandleItemsGetAll godoc
//
//	@Summary	Query All Items
//	@Description Retrieves all items for the authenticated user's group with optional filtering
//	@Tags		Items
//	@Produce	json
//	@Param		q			query		string		false	"search string"
//	@Param		page		query		int			false	"page number"
//	@Param		pageSize	query		int			false	"page size"
//	@Param		labels		query		[]string	false	"label IDs"
//	@Param		locations	query		[]string	false	"location IDs"
//	@Success	200			{object}	repo.PaginationResult[repo.ItemSummary]{}
//	@Failure	400			{object}	server.ErrorResponse
//	@Failure	401			{object}	server.ErrorResponse
//	@Router		/v1/items [GET]
//	@Security	Bearer
func (ctrl *V1Controller) HandleItemsGetAll() server.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		// Handler implementation
	}
}
```

## Code Generation Workflow

1. **Add annotations** to handler in `backend/app/api/handlers/v1/v1_ctrl_*.go`
2. **Run Swagger generation:**
   ```bash
   task swag
   ```
3. **What happens:**
   - Parses `app/api/`, `internal/core/services/`, `internal/data/repo/`
   - Generates Swagger 2.0 spec: `backend/app/api/static/docs/swagger.json`
   - Converts to OpenAPI 3.0: `backend/app/api/static/docs/openapi-3.json`
   - Copies specs to `docs/en/api/` for VitePress documentation

4. **Update TypeScript types:**
   ```bash
   task typescript-types
   ```

5. **Generated artifacts:**
   - `backend/app/api/static/docs/swagger.json` (Swagger 2.0)
   - `backend/app/api/static/docs/swagger.yaml` (Swagger 2.0)
   - `backend/app/api/static/docs/openapi-3.json` (OpenAPI 3.0)
   - `backend/app/api/static/docs/openapi-3.yaml` (OpenAPI 3.0)
   - `frontend/lib/api/types/` (TypeScript types)

## Best Practices

1. **Consistent Naming:** Use consistent entity names across tags
2. **Document Query Parameters:** Always document with type, required/optional, description
3. **Response Type Accuracy:** Use actual repository/service types
4. **Security Annotations:** Always include `@Security Bearer` for authenticated endpoints
5. **Test Generated Docs:** Verify TypeScript types generated correctly

## Common Patterns

### Array Parameters
```go
//	@Param		labels		query		[]string	false	"label IDs"
```

### File Upload
```go
//	@Accept		multipart/form-data
//	@Param		file		formData	file		true	"File to upload"
//	@Success	201			{object}	repo.AttachmentOut
```

### File Download
```go
//	@Produce	octet-stream
//	@Success	200			{file}		binary
```

### No Content Response
```go
//	@Success	204			"No Content"
```

## Troubleshooting

### Swagger Generation Fails
- Check Go syntax in handlers
- Verify type names exist in imported packages
- Ensure all imports are valid
- Run `go build` first to catch compilation errors

### TypeScript Types Missing
- Run `task swag` first
- Check `swagger.json` was generated
- Verify `task typescript-types` completes without errors
- Check `frontend/lib/api/types/` for generated files

### Types Don't Match
- Ensure handler actually returns documented type
- Check repository method signatures
- Verify DTO struct fields match annotations
- Regenerate: `task generate` (runs all code generation)
