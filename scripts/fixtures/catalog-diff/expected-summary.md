## Catalog revalidation

| Change | Servers |
| --- | ---: |
| Went online | 1 |
| Went offline or unknown | 1 |
| Protocol version changed | 1 |
| Transport changed | 1 |
| Authentication changed | 1 |
| Tool count or tool names changed | 2 |
| Other evidence changed | 0 |
| Other capability evidence changed | 0 |
| No observable change | 1 |

### Went online

| Server | Before | After |
| --- | --- | --- |
| `bravo` | offline | online |

### Went offline or unknown

| Server | Before | After | Error |
| --- | --- | --- | --- |
| `charlie` | online | offline | timeout |

### Protocol version changes

| Server | Before | After |
| --- | --- | --- |
| `alpha` | 2025-11-25 (stateful) | 2026-07-28 (stateless) |

### Transport changes

| Server | Before | After |
| --- | --- | --- |
| `echo` | streamable-http | both |

### Authentication changes

| Server | Before | After |
| --- | --- | --- |
| `delta` | none | oauth via https://auth.delta.example |

### Tool changes

| Server | Tools before | Tools after | Added | Removed |
| --- | --- | --- | --- | --- |
| `alpha` | 2 | 3 | `summarize` | — |
| `bravo` | — | 1 | `lookup` | — |

**New in the validation file:** `golf`

**Removed from the validation file:** `retired`

