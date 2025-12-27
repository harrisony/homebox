---
paths:
  - "backend/internal/data/ent/schema/**"
---

# ENT Schema Mixins

**Location:** `backend/internal/data/ent/schema/mixins/base.go`

## Standard Mixins

Every entity should use appropriate mixins to avoid field duplication:

### 1. BaseMixin

Includes core fields for all entities:

```go
field.UUID("id", uuid.UUID{}).Default(uuid.New)
field.Time("created_at").Immutable().Default(time.Now)
field.Time("updated_at").Default(time.Now).UpdateDefault(time.Now)
```

### 2. DetailsMixin

For entities with name/description:

```go
field.String("name").MaxLen(255).NotEmpty()
field.String("description").MaxLen(1000).Optional()
```

### 3. GroupMixin

For multi-tenant entities (most entities):

```go
edge.From("group", Group.Type).Ref("items").Unique().Required()
```

## Usage Pattern

```go
// backend/internal/data/ent/schema/item.go
type Item struct {
    ent.Schema
}

func (Item) Mixin() []ent.Mixin {
    return []ent.Mixin{
        mixins.BaseMixin{},      // id, created_at, updated_at
        mixins.DetailsMixin{},   // name, description
        GroupMixin{ref: "items"}, // group relationship
    }
}

func (Item) Fields() []ent.Field {
    // Add only fields specific to Item
    // DO NOT redefine mixin fields here
    return []ent.Field{
        field.String("serial_number").Optional(),
        field.Float("purchase_price").Optional(),
    }
}
```

## Important Rules

- **Never redefine fields from mixins** in entity `Fields()` method
- Mixins provide consistency across entities
- Use `task db:generate` after schema changes to regenerate code
- BaseMixin provides id/created_at/updated_at - never redefine these fields in entities
