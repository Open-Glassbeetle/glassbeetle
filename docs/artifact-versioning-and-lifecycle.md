# Artifact versioning and content lifecycle

This document establishes the architectural decisions for artifact versioning,
the storage boundary between inline text and backing files, how file content is
uploaded, and how binary assets are served consistently across the application.

Conventions every endpoint shares live in [`api-conventions.md`](api-conventions.md).
Metadata CRUD behavior is detailed in issue #70, and the content retrieval
endpoint is implemented in issue #71.

---

## 1. Context and problem statement

The database schema (`data/artifacts/artifacts.sql`) declares:

```sql
CREATE TABLE artifacts (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES projects(id) ON DELETE SET NULL,
    chat_id      TEXT REFERENCES chats(id) ON DELETE SET NULL,
    agent_id     TEXT REFERENCES agents(id) ON DELETE SET NULL,
    title        TEXT NOT NULL,
    type         TEXT NOT NULL,                  -- 'document', 'code', 'file', 'structured'
    mime_type    TEXT,
    content      TEXT,                           -- Inline text for small artifacts
    file_path    TEXT,                           -- Storage reference for large/binary artifacts
    version      INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
);
```

Before this design, two fundamental gaps existed:

1. **Undefined versioning semantics**: `version` defaulted to `1` and was incremented
   on update, but no `artifact_versions` table existed. Overwriting version 1 with
   version 2 permanently destroyed version 1.
2. **Missing upload pathway**: `file_path` existed for large/binary artifacts, but
   the API provided no route to upload file bytes. A client had to supply an
   untrusted `filePath` string pointing to pre-existing files or could not use the
   column at all.

---

## 2. Meaning of `artifacts.version`

### Evaluation of options

| Option                                                         | Pros                                                                                        | Cons                                                                                                                                   | Verdict                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **A. Change Counter** (Increment integer, no history)          | Minimal storage overhead; zero migration needed.                                            | `updated_at` already records modification time. Destructive: an agent rewriting an artifact permanently erases the user's prior draft. | Rejected as sole long-term design. Acceptable only as initial phase. |
| **B. Client-Managed Metadata** (Client sets string or integer) | Client controls external semver or rev tags.                                                | Does not record history. High collision risk in multi-agent workflows.                                                                 | Rejected.                                                            |
| **C. Active Version Pointer + Immutable History Table**        | Preserves prior iterations; enables diffing, review, and rollback. Matches agent workflows. | Requires `artifact_versions` table and lifecycle pruning.                                                                              | **Accepted.**                                                        |

### The decision

- **`artifacts.version` represents the active version number**: It is a server-managed,
  1-based, monotonically increasing integer (`1, 2, 3, ...`).
- **Clients cannot supply or decrement `version`**: Attempts to set `version` in `POST`
  or `PATCH` payloads are rejected with `400 Bad Request`.
- **Every content or major metadata mutation creates a historical snapshot**:
  Before the active row in `artifacts` is updated, its current state is copied to
  an immutable `artifact_versions` table.

### Why this fits Glassbeetle's agentic model

Artifacts are the primary tangible work products produced by autonomous agents
(proposals, specifications, source files, structured data). An agent iterating on a
task repeatedly refines an artifact across multiple conversation turns. If an agent
hallucinates, degrades quality, or introduces regressions during a rewrite, the user
must be able to inspect previous drafts and restore them.

---

## 3. History retention and storage economics

Glassbeetle runs as a local application on the user's personal workstation, backed
by a local SQLite database and a local disk storage root. Unbounded version history
would consume finite disk space and multiply backup archive sizes.

### Retention strategy

1. **Inline content (`content`)**:
   - Text payloads are capped at 100 000 characters (~100 KiB).
   - Snapshotting 20 versions of an inline document costs less than 2 MiB of SQLite
     storage. Inline version history is retained up to a default ceiling of
     **20 versions per artifact**.
2. **File-backed content (`file_path`)**:
   - Storing 20 versions of a 25 MiB binary asset would consume 500 MiB for a single
     artifact.
   - **Rule**: When a file-backed artifact's content is replaced, the prior version's
     file is preserved in storage as long as that version remains in `artifact_versions`.
   - **Pruning limit**: When an artifact exceeds **20 historical versions**, the
     oldest version record is purged. If that version references a backing file that
     is no longer referenced by any active artifact or remaining version, that file
     is immediately unlinked via `FileStorageService.delete()`.
3. **Deduplication on metadata-only updates**:
   - When an update modifies only `title`, `type`, or parent links without altering
     `content` or `file_path`, the historical version snapshot references the same
     file or text without duplicating storage.
4. **Impact on Backups**:
   - Application backup archives bundle SQLite and the `storage/` directory. Pruning
     historical files to a ceiling of 20 versions ensures backup archives remain
     bounded and predictable.

### How versions are addressed in the API

```
GET    /api/v1/artifacts/:artifactId/versions
GET    /api/v1/artifacts/:artifactId/versions/:version
GET    /api/v1/artifacts/:artifactId/versions/:version/content
POST   /api/v1/artifacts/:artifactId/versions/:version/restore
```

- `GET /artifacts/:artifactId/versions`: Paginated collection of historical versions.
  Omit inline `content` to keep collection payloads lightweight.
- `GET /artifacts/:artifactId/versions/:version`: Returns metadata and inline content
  for a specific past version.
- `GET /artifacts/:artifactId/versions/:version/content`: Streams or returns the exact
  content of that version, governed by the same security headers (`nosniff`, safe
  MIME allowlist, RFC 6266 disposition) as the primary endpoint.
- `POST /artifacts/:artifactId/versions/:version/restore`: Restores a historical
  version by appending a **new** current version increment (`version = current + 1`)
  with the restored content. History is append-only and never rewritten.

---

## 4. How file content is created

### The missing upload gap

Currently, `file_path` can only be set if a relative reference already exists.
Clients must not provide arbitrary filesystem references because the server cannot
verify whether the referenced file exists, belongs to the artifact, or is contained
safely.

### The decision: dedicated upload endpoint

File content is created and replaced through a dedicated content upload endpoint:

```
PUT /api/v1/artifacts/:artifactId/content
```

This mirrors the established convention used for profile pictures (`PUT /agents/:agentId/picture`
and `PUT /user/picture`).

#### Lifecycle flow:

1. **Step 1 — Create metadata row**:
   Client issues `POST /api/v1/artifacts` with `{ title: "Architecture Diagram", type: "file", mimeType: "image/png" }`.
   Server assigns a UUIDv7 ID and initializes `version: 1`, `content: null`, `file_path: null`.
2. **Step 2 — Upload file content**:
   Client streams the binary payload to `PUT /api/v1/artifacts/:artifactId/content`
   with `Content-Type: image/png`.
   The server streams bytes directly to `FileStorageService.write('artifacts', req, { maxBytes })`,
   records the generated safe reference (e.g. `artifacts/018f3a9e-....png`), sets
   `file_path`, and updates `updated_at`.
3. **Direct agent creation (Internal)**:
   Backend agent services running inside the system can write directly using
   `ArtifactsService.createWithFile(dto, stream)` without making HTTP roundtrips.

---

## 5. The content versus `file_path` boundary

The schema comments distinguish "small/text" (`content`) from "large/binary" (`file_path`).
We define the exact boundary:

| Storage Column | Permitted Types                                         | Maximum Size                      | Storage Mechanism                    |
| -------------- | ------------------------------------------------------- | --------------------------------- | ------------------------------------ |
| `content`      | UTF-8 text, markdown, JSON, CSV, code manifests         | **100 000 characters** (~100 KiB) | SQLite database table column         |
| `file_path`    | Large text documents, binaries, archives, images, media | **100 MiB** (default ceiling)     | File on disk in `storage/artifacts/` |

### Enforcement rules:

- `POST /artifacts` and `PATCH /artifacts/:id` enforce `MAX_ARTIFACT_CONTENT_LENGTH = 100_000`.
  Payloads exceeding 100 000 characters are rejected with `400 Bad Request` (`MAX_LENGTH_EXCEEDED`),
  directing the client to use file storage.
- `content` and `file_path` remain strictly mutually exclusive (XOR invariant). An artifact
  must have exactly one populated once created.

---

## 6. Content lifecycle on replacement and deletion

### Content replacement (`PATCH` or `PUT`)

- If an artifact's file is replaced with a new file or replaced with inline text:
  - When history is active: The old `file_path` reference is transferred to the
    archived record in `artifact_versions`.
  - When history pruning purges that version (or when versioning is disabled):
    The unreferenced file is unlinked from storage via `FileStorageService.delete(oldPath)`.

### Artifact deletion (`DELETE /api/v1/artifacts/:artifactId`)

- Deleting an artifact permanently removes the active row in `artifacts` and all
  associated historical records in `artifact_versions`.
- All backing files referenced by the artifact and any of its versions are unlinked
  from disk.
- Filesystem unlinks are executed gracefully: if a file is already missing on disk,
  the operation logs a `WARN` and proceeds without failing the database transaction.

### Parent cascade decoupling (`ON DELETE SET NULL`)

- `artifacts.project_id`, `artifacts.chat_id`, and `artifacts.agent_id` all specify
  `ON DELETE SET NULL`.
- When a project, chat, or agent is deleted, artifacts created within them are
  **preserved as unfiled standalone assets**. Their versions, content, and backing
  files remain untouched.

---

## 7. Unified binary serving architecture

Glassbeetle serves three categories of stored binary files back to clients:

1. **Agent profile pictures**: `GET /api/v1/agents/:agentId/picture`
2. **User profile pictures**: `GET /api/v1/user/picture`
3. **Artifact content**: `GET /api/v1/artifacts/:artifactId/content`

To ensure uniform security and reliability, all binary-serving endpoints adhere to
the following five standards:

1. **Containment via `FileStorageService`**:
   No controller or service may manually join file paths with string concatenation.
   Every disk access must pass through `FileStorageService` containment verification.
2. **Streaming for Large Payloads**:
   Files are piped directly as readable streams to Express response streams. If an
   I/O error occurs after response headers have been flushed, the socket is destroyed
   (`res.destroy(err)`) to avoid corrupting client data streams with error text.
3. **Mandatory Security Headers & Stored XSS Mitigation**:
   - `X-Content-Type-Options: nosniff` is sent on every response (200, 206, 304, 4xx).
   - **Safe MIME Allowlist**: Only script-incapable formats are served inline (`text/plain`,
     `text/markdown`, `application/json`, `image/png`, `image/jpeg`, etc.).
   - **Active Content Demotion**: Executable formats like `text/html` and `image/svg+xml`
     are overridden to `application/octet-stream` and forced to `Content-Disposition: attachment`
     to prevent stored cross-site scripting inside the Tauri webview.
   - **RFC 6266 / RFC 5987 Filename Sanitization**: Filenames strip path traversals,
     quotes, CRLF characters, and are encoded with ASCII fallback plus UTF-8 extended syntax.
4. **Conditional Revalidation**:
   Every binary endpoint returns an `ETag` (`"${version}-${size}"` or `"${updatedAt}-${size}"`),
   `Last-Modified`, and `Cache-Control: private, max-age=0, must-revalidate`.
   Conditional requests matching `If-None-Match` or `If-Modified-Since` return `304 Not Modified`.
5. **Byte-Range Requests**:
   Endpoints serving potentially large files (artifacts and backups) advertise
   `Accept-Ranges: bytes` and handle RFC 9110 Range headers (`206 Partial Content`
   and `416 Range Not Satisfiable`).

---

## 8. The `type` column classification

The schema comment specifies four artifact archetypes. We pin down their definitions:

| Type         | Intended Work Product                                        | Default Storage    | Example MIME Types                                         |
| ------------ | ------------------------------------------------------------ | ------------------ | ---------------------------------------------------------- |
| `document`   | Human-readable prose, specifications, proposals, notes       | Inline (`content`) | `text/markdown`, `text/plain`                              |
| `code`       | Source code files, scripts, patches, configuration manifests | Inline (`content`) | `text/plain`, `application/json`, `text/x-python`          |
| `structured` | Tabular data, CSV tables, JSON records, YAML schemas         | Inline / File      | `application/json`, `text/csv`, `application/yaml`         |
| `file`       | Arbitrary binary blobs, archives, diagrams, media, exports   | File (`file_path`) | `application/octet-stream`, `image/png`, `application/zip` |

---

## 9. Implied schema additions

_(Note: Named here for architectural clarity; schema changes belong in a subsequent `area:database` issue)._

```sql
-- 1. Pin down artifact types
ALTER TABLE artifacts ADD CONSTRAINT check_artifact_type
    CHECK (type IN ('document', 'code', 'file', 'structured'));

-- 2. Version history table
CREATE TABLE artifact_versions (
    id           TEXT PRIMARY KEY,
    artifact_id  TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
    version      INTEGER NOT NULL,
    title        TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN ('document', 'code', 'file', 'structured')),
    mime_type    TEXT,
    content      TEXT,
    file_path    TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE(artifact_id, version)
);

CREATE INDEX idx_artifact_versions_artifact_id
    ON artifact_versions(artifact_id, version DESC);
```

---

## 10. Implementation roadmap: incremental delivery

To avoid speculative complexity, the design is broken into three independently
shippable increments:

### Increment 1: Foundation & Content Lifecycle (Shipped with #70 & #71)

- `artifacts.version` functions as a server-managed change counter (1, 2, 3...)
  incrementing on every update.
- `GET /artifacts/:artifactId/content` serves inline text and streams files with
  nosniff, safe MIME allowlist, ETag revalidation, and byte-range support.
- Add `PUT /api/v1/artifacts/:artifactId/content` for streaming file uploads into
  the `artifacts/` storage bucket.

### Increment 2: Database History & Pruning (Next `area:database` issue)

- Add `artifact_versions` table and indexes.
- Update `ArtifactsService` transaction logic to snapshot previous state into
  `artifact_versions` upon update.
- Implement the 20-version retention ceiling with automatic orphan file unlinking.

### Increment 3: Version Inspection & Rollback (Feature issue)

- Expose `GET /artifacts/:artifactId/versions` and `GET /artifacts/:artifactId/versions/:version`.
- Expose `GET /artifacts/:artifactId/versions/:version/content`.
- Implement `POST /artifacts/:artifactId/versions/:version/restore`.
- Surface version timeline and rollback in the desktop UI.
