## Task

`struct LoanRecord` holds 24 bytes of real data but takes **40** bytes in memory, because the compiler pads each field to its alignment (module 1.07). With millions of records in a Berkeley DB environment or a cache, that is 40% wasted.

**Reorder the fields** so the struct is as small as possible. Keep every field, with the same name and type. `main` uses designated initialisers, so it keeps working in any order.

Expected output:

```text
sizeof(struct LoanRecord) = 24
bytes of real data        = 24
bytes of padding          = 0
loan 900001: A H 250000.00 for 240 months at branch 7
```

## Use the Layout button

Press **Layout** before and after your change. It shows each byte of the struct: coloured squares are fields, hatched squares are padding, laid out 8 bytes per row the way the CPU sees them.

(Why not just `__attribute__((packed))`? Packed structs have misaligned fields. They are slower, and on some CPUs they fault. Reordering costs nothing.)
