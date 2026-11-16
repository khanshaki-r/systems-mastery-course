## Task

Read amounts until the input ends, store them in a **growable array**, and print the count, capacity, sum and maximum:

```text
count=10 capacity=16 sum=4346 max=3000
```

Finish `vec_push` and `vec_free`:

- The array starts empty (`data == NULL`, `cap == 0`).
- When it is full, grow it with `realloc` to double the capacity: 0 → 4 → 8 → 16 → ...
- `vec_free` releases the block and resets the struct.

This is the arena and batch-buffer idea from the migration engine (claim H1) in miniature: one owner, explicit growth, one free.

## Sanitizers are on

Tests build with AddressSanitizer, UBSan and LeakSanitizer. The starter writes through a NULL pointer, and the sanitizer stops it at that line. If you forget to free, LeakSanitizer reports the leaked bytes and the test fails.
