## Task

Write `RingBuffer<T, N>`: a fixed-capacity buffer that keeps the **newest N items**. It never allocates after construction, which is why servers use it for "the last 1000 request latencies" or "the last 50 errors".

- `push(value)`: store it. If the buffer is full, overwrite the **oldest** item.
- `size()`: how many items are stored (0 to N).
- `operator[](i)`: `i = 0` is the oldest, `size() - 1` the newest.

```text
after 30: [10, 20, 30] size=3 full=yes
after 40: [20, 30, 40] size=3 full=yes
```

`N` is a template parameter, so `RingBuffer<int, 3>` and `RingBuffer<std::string, 2>` are two different classes the compiler generates for you (module 2.06). Open the **Assembly** tab to see that `% N` with a constant N compiles to plain arithmetic, with no runtime size lookup.
