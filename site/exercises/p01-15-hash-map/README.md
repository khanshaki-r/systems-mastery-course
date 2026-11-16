## Task

Build the key-value store at the heart of tcpkv, in C. Commands arrive one per line:

| Command | Reply |
|---|---|
| `PUT key value` | `OK` (inserts, or updates an existing key) |
| `GET key` | the value, or `(nil)` |
| `DEL key` | `1` if it was removed, `0` if it did not exist |
| `COUNT` | number of keys |
| anything else | `ERR` |

`main` already parses the commands and prints the replies. Implement `map_put`, `map_get`, `map_del` and `map_free` with **separate chaining**: 16 buckets, each a linked list.

## Rules

- The map owns copies of the keys. The caller's buffer is reused for the next line.
- Everything is freed by `map_free`. LeakSanitizer fails the test if not.
- Test 2 puts 20 keys into 16 buckets, so some buckets must hold more than one entry.

Use **Visualize** on a small version (hard-code a few `map_put` calls in main) to watch the chains form on the heap.
