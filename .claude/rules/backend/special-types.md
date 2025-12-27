---
paths:
  - "backend/internal/data/repo/**"
---

# Special Types

## AssetID Special Type

**Location:** `internal/data/repo/asset_id_type.go`

### Custom Type Definition

AssetID is a custom int type with special formatting:

```go
type AssetID int

// Methods
String()        // Returns "000-001" format (3-3 digits)
MarshalJSON()   // Returns quoted formatted string
ParseAssetID()  // Parses from string, strips quotes/dashes
Nil()          // Returns true if ≤ 0
```

### Formatting Pattern

- **Display format:** `000-001` (3 digits, dash, 3 digits)
- **Zero padding:** Always 6 digits total
- **Examples:** `000-001`, `000-123`, `001-456`

### Usage in Code

```go
// Creating AssetID
aid := repo.AssetID(123)
fmt.Println(aid.String())  // "000-123"

// Parsing from string
aid, err := repo.ParseAssetID("000-123")
aid, err := repo.ParseAssetID("#123")  // Also supports # prefix

// Checking for nil/unset
if aid.Nil() {
    // AssetID is 0 or negative
}

// JSON marshaling
json.Marshal(aid)  // Returns "\"000-123\""
```

### Search Pattern

Users can search items by AssetID using `#` prefix:

```
#123      → searches for AssetID 123
000-123   → searches for AssetID 123
```

### Auto-Increment Behavior

Controlled by service flag:

```go
services.New(repos,
    services.WithAutoIncrementAssetID(true),  // Enable auto-increment
)
```

- When enabled: AssetID automatically assigned to new items
- When disabled: AssetID remains 0 (nil) unless manually set
- Test default: Disabled (manual assignment in tests)

## Search Normalization Pattern

**Location:** `pkgs/textutils/normalize.go`

### Accent-Insensitive Search

All search queries use Unicode normalization for accent-insensitive matching:

```go
func NormalizeSearchQuery(query string) string
```

### Normalization Examples

```
"Café"        → "cafe"
"Electrónica" → "electronica"
"Naïve"       → "naive"
"José"        → "jose"
```

### Usage in Repositories

**MUST use in all repository search queries:**

```go
import "github.com/hay-kot/homebox/backend/pkgs/textutils"

func (r *ItemRepository) Search(ctx context.Context, query string) ([]*ItemOut, error) {
    normalized := textutils.NormalizeSearchQuery(query)

    items := r.db.Item.Query().
        Where(item.NameContains(normalized)).
        All(ctx)

    return items, nil
}
```

### Database Storage

Search columns should store normalized values for consistent matching:

```go
// Before saving
item.SetName(name)
item.SetSearchName(textutils.NormalizeSearchQuery(name))
```

### Why This Matters

- **Consistency:** Users expect "cafe" to match "Café"
- **Internationalization:** Supports accented characters in multiple languages
- **Case-insensitive:** Also lowercases for case-insensitive search
- **Required for all search:** Must use in every repository search method
