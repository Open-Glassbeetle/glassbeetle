# Memory tags: storage format, normalisation and filtering

Both `agent_memories.tags` and `shared_memories.tags` provide structured
categorisation for memories. This document defines how memory tags are stored,
normalised, and queried across the application.

Conventions every endpoint shares live in
[`api-conventions.md`](api-conventions.md).

---

## 1. Storage format & Empty vs NULL

- **Storage column**: SQLite `TEXT` column storing a JSON-encoded array of strings.
- **Canonical empty state**: When a memory has no tags (omitted, `null`, empty array `[]`, or empty strings), the database stores SQL `NULL`. This saves storage space and aligns with SQLite's `json_each(NULL)` returning zero rows.
- **Client response representation**: The public API **always** returns an array (`string[]`). If the database holds `NULL` or invalid JSON, it deserializes to `[]`. Clients never receive `null`.

---

## 2. Tag Normalisation on Write

When tags are created or updated, they pass through a shared normalisation pipeline:

1. **Trimming**: Leading and trailing whitespace is stripped (`tag.trim()`).
2. **Case folding**: Tags are converted to lowercase (`tag.toLowerCase()`). Matching is therefore case-insensitive without requiring expensive runtime collation.
3. **Empty rejection / pruning**: Any empty string `""` after trimming is omitted.
4. **Allowed characters**: Arbitrary UTF-8 strings (with standard URL encoding when supplied in query strings) are accepted to maximize flexibility for domain classifications and multilingual tags, with empty strings rejected and whitespace trimmed.
5. **Length and count bounds**:
   - Maximum length per tag: 50 characters.
   - Maximum tags per memory: 50 tags.
6. **Deduplication**: Duplicate tags are removed (e.g. `['work', 'Work']` collapses to `['work']`).
7. **Canonical sorting**: Tags are sorted in ascending lexicographical order (`['beta', 'alpha']` -> `'["alpha","beta"]'`). This guarantees deterministic storage and diffing.

If after normalisation no valid tags remain, the value is written as SQL `NULL`.

---

## 3. Parsing on Read

`parseTagsOnRead` parses the stored `tags` column safely:
- Valid JSON array of strings -> returned as `string[]`.
- `NULL`, empty string, or undefined -> `[]`.
- Malformed JSON or non-array JSON value -> safely caught and falls back to `[]`. A corrupted row never causes a listing request to crash.

---

## 4. Query & Filter Semantics

Memory collection endpoints support tag filtering via query parameters:
- `?tag=<tag>`: Filters memories matching the specified tag.
- `?tags=<tag1>,<tag2>`: Filters memories by multiple comma-separated tags.
- `?tagMode=all` (default): Memory must contain **all** requested tags (intersection).
- `?tagMode=any`: Memory must contain **at least one** requested tag (union).

### Database-Level JSON1 Filtering
Tag filtering is executed directly in SQLite using JSON1 functions (`json_each`, `json_valid`) within a `WHERE` subclause before pagination. This ensures `COUNT(*)` totals and `LIMIT`/`OFFSET` pagination are mathematically exact.

```sql
-- Single tag filter (or all mode)
WHERE agent_memories.tags IS NOT NULL
  AND json_valid(agent_memories.tags) = 1
  AND EXISTS (
    SELECT 1 FROM json_each(agent_memories.tags)
    WHERE json_each.value = ?
  )
```

- **Short-circuit JSON safety**: `json_valid(tags) = 1` precedes `json_each(tags)`. Because SQLite short-circuits `AND` expressions, `json_each` is never invoked on invalid JSON.
- **Bound parameters**: Every tag filter value is bound as a parameter (`?`), preventing SQL injection.

---

## 5. Startup Verification

JSON1 is compiled into SQLite by default in modern drivers (`better-sqlite3`). To prevent silent degradation, `DatabaseService` runs a probe check during initialization (`assertJson1Supported`). If the JSON1 extension is unavailable or dysfunctional, startup fails immediately with an informative error.
