## Task

Four threads approve loans and add up fees. With plain `long long` counters, the totals come out wrong and different on every run. Worse, it is **undefined behaviour** (module 4.02).

Make the program correct:

```text
approved = 80000
total_paise = 200000
```

The tests build with **ThreadSanitizer** (`-fsanitize=thread`). TSan watches every memory access at run time and reports two threads touching the same location, at least one of them writing, with no synchronisation in between. A racy program fails the test even when the numbers happen to come out right.

Try both fixes, `std::atomic` and `std::mutex`, and compare them in the Assembly tab (use the Release preset): an atomic increment becomes a single `lock xadd` instruction.
