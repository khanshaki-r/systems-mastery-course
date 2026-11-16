## Task

Every thread pool (module 4.10) and tcpkv's accept loop hands work over through a queue like this. Implement `BoundedQueue<T>`:

- `push(v)` **blocks while the queue is full** (that is back-pressure: fast producers wait for slow consumers). It returns `false` if the queue was closed.
- `pop()` **blocks while the queue is empty**. It returns `std::nullopt` only when the queue is closed **and** empty, so no item is lost at shutdown.
- `close()` wakes every waiting thread.

`main` runs 2 producers pushing 1..1000 each and 3 consumers. The expected output is fully deterministic:

```text
consumed 2000 items, sum = 1001000
queue never exceeded capacity: yes
```

Tests run under ThreadSanitizer. The starter has no locking, so it races, and its consumers quit as soon as they see an empty queue.
