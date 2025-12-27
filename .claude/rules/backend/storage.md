---
paths:
  - "backend/internal/core/services/service_items_attachments.go"
  - "backend/internal/data/repo/repo_item_attachments.go"
---

# Storage System Architecture

**Location:** `backend/internal/core/services/service_items_attachments.go`

## Storage Backend

Attachments use pluggable storage backend via `gocloud.dev`:

Supported backends:
- **Local filesystem** - Default for development
- **S3** - AWS S3 or S3-compatible (MinIO, etc.)
- **Azure Blob Storage**
- **Google Cloud Storage**

## Configuration

Storage is configured through environment variables and passed to repositories:

```go
storage := config.Storage{
    Type: "local", // or "s3", "azure", "gcs"
    Path: "/path/to/storage",
    // Additional provider-specific config
}
```

## File Operations

File operations are abstracted through the storage provider interface:
- Upload files
- Download files
- Delete files
- Generate presigned URLs (for cloud storage)

This abstraction allows switching storage backends without code changes.

## Connection Strings

**Location:** `internal/data/repo/repo_item_attachments.go`

Storage is configured with gocloud.dev connection strings:

- Local: `file:///path/to/storage`
- S3: `s3://bucket?region=us-west-2`
- Azure: `azureblob://container`
- GCS: `gs://bucket`
- Memory: `mem://` (tests only)

## Gotchas

- Windows path handling requires special care
- Thumbnails generated async via pubsub
- Connection string must be valid gocloud URL
