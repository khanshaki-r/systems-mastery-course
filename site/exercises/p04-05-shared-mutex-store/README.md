## Task

This is the in-memory store from tcpkv (claim I). Two writer threads insert 500 keys each while four reader threads look keys up. An `unordered_map` that is being modified while another thread reads it can crash: an insert may rehash and free the bucket array the reader is walking.

Add locking with `std::shared_mutex`:

- `get` and `size`: a **shared** (reader) lock;
- `set`: an **exclusive** (writer) lock.

```text
size = 1000
acct:1:499 = 499
missing = (nil)
reads done = 8000
```

Tests run under ThreadSanitizer. When you are done, think about the interview follow-up: under a write-heavy load, is a shared_mutex still faster than a plain mutex? (Module 4.05 measures it.)
