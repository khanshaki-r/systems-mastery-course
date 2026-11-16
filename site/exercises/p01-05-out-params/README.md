## Task

Implement two functions. `main` is already written and must not change.

```c
/* Split amount paise into parts equal shares. On success store the share in
 * *share and the leftover in *remainder and return 0. If parts <= 0 or
 * amount < 0, write nothing and return -1. */
int divide_paise(long long amount, long long parts, long long *share, long long *remainder);

/* Make *biggest point at whichever of *a and *b is larger (a on a tie). */
void point_at_bigger(const long long **biggest, const long long *a, const long long *b);
```

Input `100000 3` prints:

```text
100000 / 3 = 33333 each, remainder 1
larger of share and remainder: 33333
```

This is the pattern every Berkeley DB and POSIX call uses: the return value says whether it worked, and the results come back through pointers.
