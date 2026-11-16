## Task

`Buffer` owns a heap block. Exactly one `Buffer` may own any block. That is the same contract as tcpkv's move-only connection handles (claim I).

1. Delete the copy constructor and copy assignment.
2. Write a `noexcept` move constructor: steal the block and leave the source empty.
3. Write a `noexcept` move assignment: free your current block, steal the other's, and leave the source empty.

`Buffer::live` counts blocks currently owned. It must stay exact:

```text
live after fill: 4
taken: bbb, pool[1] empty: true
pool[0]: ccc, pool[2]: (empty), live: 3
live after clear: 1
```

The build uses AddressSanitizer. A shallow copy (two owners) shows up as `attempting double-free`, and a forgotten `delete[]` as a leak. The starter fails to compile on the `static_assert`s until you finish step 1.
