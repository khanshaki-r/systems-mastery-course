## Task

Read pairs of non-negative integers `a b` until the input ends. For each pair print the greatest common divisor and the ratio reduced by it:

```text
gcd(84, 36) = 12, ratio 7:3
```

Write `gcd` **recursively** using Euclid's rule:

- `gcd(a, 0) = a`
- `gcd(a, b) = gcd(b, a % b)`

## See the call stack

Each recursive call gets its own **stack frame** holding its own `a` and `b` (module 1.04). To watch it, temporarily replace the `while` loop with `printf("%lld\n", gcd(1071, 462));` and press **Visualize**. Put the loop back before you press Check.
