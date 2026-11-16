## Task

The master-table cache in the application server (claim H4) and Redis's `allkeys-lru` policy both need the same thing: evict the entry that was **least recently used**, with `get` and `put` in O(1).

The classic design (module 10.08):

- a `std::list` of `(key, value)`, ordered from most recent (front) to least recent (back);
- an `unordered_map` from key to that key's **list iterator**, so you can find a node and move it to the front in O(1).

Implement `get` (a hit makes the key most recent) and `put` (insert or update, making the key most recent; inserting a new key into a full cache evicts the least recent one and returns its name).

```text
2          <- capacity
PUT a 1    OK
PUT b 2    OK
GET a      1          (a is now most recent)
PUT c 3    OK (evicted b)
```
