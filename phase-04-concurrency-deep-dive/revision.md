# Phase 4 revision: Concurrency deep dive

Phase 4 turned "I have used threads" into "I can explain every layer under them". You started with `std::thread` and learned why a data race is undefined behaviour, not a random value. You opened up `std::mutex` down to the futex word, built bounded queues with condition variables, measured when `shared_mutex` helps and when it hurts, wrote atomics and a spinlock, and learned the memory model well enough to say why release/acquire fixes message passing but not Dekker's handshake. You saw cache lines bounce between cores, met ABA and the SPSC ring, built the tcpkv thread pool with a clean shutdown, debugged a deadlock from a live process, rebuilt the synchronisation layer in Win32, and designed the pooled request model and master-table cache of the loan application server. This is the core of resume claim C, and the engine of capstones C1 (tcpkv) and C2 (the RPC application server).

## The phase on one page

| Module | The one idea to remember | The command or code pattern to remember |
|---|---|---|
| [4.01 Threads in C++](module-01-threads-in-cpp.md) | A `std::thread` starts in its constructor and must be joined or detached before it is destroyed, or `std::terminate` aborts the process. | `std::thread t(f, std::ref(x)); ... t.join();` inside a joining RAII wrapper; GDB `info threads`, `thread apply all bt` |
| [4.02 Data races](module-02-data-races.md) | Two threads, same location, at least one write, at least one non-atomic, no happens-before: undefined behaviour. | `g++ -std=c++17 -g -O1 -fsanitize=thread -pthread ...`; a TSan report exits with code 66 |
| [4.03 Mutex internals: futex](module-03-mutex-internals-futex.md) | The futex word is 0, 1 or 2: a free lock is one CAS with no syscall; contention sleeps in `FUTEX_WAIT`. | `std::lock_guard<std::mutex> lk(m);` by default; `std::unique_lock` when you must unlock early or wait |
| [4.04 Condition variables](module-04-condition-variables.md) | Always wait with a predicate, and always change the state under the same mutex. | `cv.wait(lk, [&] { return !q.empty() \|\| closed; });` then `notify_one` per item, `notify_all` on close |
| [4.05 shared_mutex](module-05-shared-mutex.md) | Many readers or one writer; it costs more per operation than a mutex and only wins when reads are long or dominant. | `std::shared_lock<std::shared_mutex> lk(m);` to read, `std::unique_lock<std::shared_mutex> lk(m);` to write |
| [4.06 Spinlocks and atomics](module-06-spinlocks-and-atomics.md) | Each atomic operation is indivisible, but `x = x + 1` is three steps; use a CAS loop for anything beyond an add. | `x.fetch_add(1);` and `while (!x.compare_exchange_weak(expected, desired)) { }` |
| [4.07 Memory model and memory orders](module-07-memory-model-and-memory-orders.md) | A release store paired with the acquire load that reads it creates happens-before; relaxed gives atomicity only. | `data = 42; flag.store(true, std::memory_order_release);` and `while (!flag.load(std::memory_order_acquire)) { }` |
| [4.08 Cache coherence and false sharing](module-08-cache-coherence-and-false-sharing.md) | Coherence works per 64-byte line; threads writing different variables on one line make it ping-pong. | `struct alignas(64) Slot { std::atomic<long> v{0}; };` plus `static_assert(sizeof(Slot) == 64);` |
| [4.09 Lock-free basics](module-09-lock-free-basics.md) | Lock-free is a progress guarantee, not a speed claim; CAS structures face ABA and memory reclamation. | SPSC ring: write the slot, then `tail_.store(t + 1, std::memory_order_release);`; the consumer loads `tail_` with acquire |
| [4.10 Thread pool design](module-10-thread-pool-design.md) | N workers, one queue, one mutex, one condition variable, a stop flag; run tasks with the lock released. | Shutdown: lock, `stop_ = true`, unlock, `notify_all()`, join every worker; `submit` returns a future via `packaged_task` |
| [4.11 Deadlocks and lock ordering](module-11-deadlocks-and-lock-ordering.md) | Deadlock needs all four Coffman conditions; a documented lock order breaks circular wait. | `std::scoped_lock lk(a.m, b.m);`; on a hang: `thread apply all bt`, then `print *(pthread_mutex_t*)addr` and read `__data.__owner` |
| [4.12 Win32 synchronisation](module-12-win32-synchronisation.md) | `CRITICAL_SECTION` is a cheap user-mode recursive lock; kernel Events, Mutexes and Semaphores can be combined in one wait. | `WaitForMultipleObjects(2, handles, FALSE, INFINITE)` on `{workSemaphore, stopEvent}` with a manual-reset stop event |
| [4.13 Pooled request model and cache](module-13-pooled-request-model-and-concurrent-cache.md) | Pre-allocate request objects; build the new cache off-lock and swap it in under a microsecond exclusive lock; cache master data only. | `Table fresh = load(); { std::unique_lock lk(m); table_.swap(fresh); }` |

## Must-know for interviews

1. **Destroying a joinable thread aborts.** The `std::thread` destructor calls `std::terminate` if you neither joined nor detached. Arguments are copied into the thread, so pass references with `std::ref` and move-only objects with `std::move`. ([4.01](module-01-threads-in-cpp.md))
2. **A data race is undefined behaviour.** The four parts: different threads, same location, at least one write, at least one non-atomic, and no happens-before order. The compiler may then hoist, cache or delete accesses. TSan finds races by happens-before, not timing; it costs roughly 5 to 15 times CPU and cannot be combined with ASan in one binary. ([4.02](module-02-data-races.md))
3. **Mutex fast and slow paths.** On Linux, `std::mutex` is a glibc `pthread_mutex_t` on a futex word. Uncontended lock and unlock cost tens of nanoseconds and make no syscall. On contention the waiter sets the word to 2 and sleeps in `FUTEX_WAIT`; `unlock` calls `FUTEX_WAKE` only if it saw 2. `FUTEX_WAIT` takes the expected value so the kernel can re-check it, which prevents a lost wakeup. ([4.03](module-03-mutex-internals-futex.md))
4. **Why the predicate loop.** Three reasons: spurious wakeups are allowed, a notify before the wait is lost because the variable has no memory, and another consumer can steal the item. The loop handles all three. ([4.04](module-04-condition-variables.md))
5. **`shared_mutex` on Linux.** libstdc++ wraps glibc's `pthread_rwlock_t`, which is reader-preferring by default, so writers can starve. There is no upgrade from shared to exclusive and no recursion: release, take the exclusive lock, and re-check. ([4.05](module-05-shared-mutex.md))
6. **What atomics compile to on x86-64.** `fetch_add` is `lock xadd`, compare-and-swap is `lock cmpxchg`, a `seq_cst` store and `exchange` are `xchg`, and a load is a plain `mov`. `std::atomic<T>` larger than 8 bytes is not guaranteed lock-free; it may use a hidden lock in libatomic (`is_lock_free`, `-latomic`). ([4.06](module-06-spinlocks-and-atomics.md))
7. **When to spin.** A spinlock only helps when the holder is surely running (threads never exceed cores) and the section lasts tens of nanoseconds. Real mutexes are hybrids: spin briefly, then sleep in the kernel. `compare_exchange_weak` may fail spuriously, so use it in a loop. ([4.06](module-06-spinlocks-and-atomics.md))
8. **The one x86 reordering.** x86 (TSO) lets a store be delayed past a later load because of the store buffer. So in "set my flag, then check yours", both threads can read 0 with relaxed or release/acquire. Only `seq_cst` (or a `seq_cst` fence) forbids it. ([4.07](module-07-memory-model-and-memory-orders.md))
9. **Cache lines.** 64 bytes on x86-64 (128 on Apple ARM). Under MESI a write needs the line in Modified state, so every other copy is invalidated; each ownership transfer costs tens of nanoseconds. Detect false sharing with a bad scaling curve, a profile on a trivial store, `offsetof` checks, or `perf c2c` on bare metal. ([4.08](module-08-cache-coherence-and-false-sharing.md))
10. **Progress guarantees.** Lock-free: some thread always completes (Treiber stack). Wait-free: every thread completes in bounded steps (`fetch_add` counter, SPSC ring). Vyukov's bounded MPMC queue is not formally lock-free. ABA is fixed with version counters, hazard pointers, epochs or never reusing nodes. ([4.09](module-09-lock-free-basics.md))
11. **Pool sizing and shutdown.** CPU-bound pools are about the core count; pools that wait on a database are sized by measurement, and in the app server the pool size matched the database connection pool. With stop-now shutdown, queued tasks' futures throw `broken_promise`; a running task always completes. ([4.10](module-10-thread-pool-design.md))
12. **Coffman's four conditions.** Mutual exclusion, hold and wait, no preemption, circular wait. Lock ordering removes circular wait, `std::scoped_lock`/`std::lock` remove hold-and-wait for a group, and `try_lock` with randomised back-off removes no-preemption. ([4.11](module-11-deadlocks-and-lock-ordering.md))
13. **Diagnosing a hang.** A deadlocked process is alive at 0% CPU. Take `gcore` or attach GDB, run `thread apply all bt`, find threads in `__lll_lock_wait` under `pthread_mutex_lock`, and read `__data.__owner` to draw the cycle. Most real hangs are a lock held across I/O, not a cycle. ([4.11](module-11-deadlocks-and-lock-ordering.md))
14. **Win32 primitives.** `CRITICAL_SECTION`: one interlocked op when free, recursive, spin then kernel wait. `SRWLOCK`: one word, not recursive; MSVC's `std::mutex` is built on it. `WaitForMultipleObjects` takes at most 64 handles and the lowest signalled index wins. A manual-reset Event releases all waiters; an auto-reset Event releases one. `WAIT_ABANDONED` means the owner died and the state is suspect. ([4.12](module-12-win32-synchronisation.md))
15. **Cache design numbers.** Staleness was bounded by a version counter polled every 5 seconds plus a TTL backstop. On one laptop a cache hit was roughly a thousand times faster than a per-request database lookup (about a microsecond against about 2 ms). Never cache rows that transactions write, such as balances and limits. ([4.13](module-13-pooled-request-model-and-concurrent-cache.md))

## Mistakes that cost marks

1. **Letting a joinable `std::thread` go out of scope, or capturing locals by `[&]` in a thread that outlives the function.** The first aborts the process; the second reads dead stack memory. ([4.01](module-01-threads-in-cpp.md))
2. **Using `volatile` for thread communication.** It forces the access but gives no atomicity and no ordering; the program is still a data race. ([4.02](module-02-data-races.md), [4.07](module-07-memory-model-and-memory-orders.md))
3. **`cv.wait(lk)` without a predicate, or with `if` instead of a loop.** A spurious or stolen wakeup returns with the queue empty, and `front()` on an empty deque crashes. ([4.04](module-04-condition-variables.md))
4. **Writing the state (or the stop flag) outside the mutex.** The waiter can check, then the writer sets and notifies, then the waiter sleeps forever; shutdown hangs in `join`. ([4.04](module-04-condition-variables.md), [4.10](module-10-thread-pool-design.md))
5. **Running a task, I/O or a database call while holding a lock.** A "4-thread" pool gets 1-thread throughput, and every waiter stalls for the slowest call. ([4.10](module-10-thread-pool-design.md), [4.11](module-11-deadlocks-and-lock-ordering.md))
6. **`x = x + 1` on an atomic, or check-then-act (`if (x.load() > 0) x.fetch_sub(1);`).** Each step is atomic, the sequence is not; updates are lost or limits go negative. ([4.06](module-06-spinlocks-and-atomics.md))
7. **Publishing data with a relaxed flag.** Relaxed orders nothing else, so the reader can see the flag and a half-built record. Use release on the store and acquire on the load. ([4.07](module-07-memory-model-and-memory-orders.md))
8. **`std::lock_guard` on a `shared_mutex` for readers, or "upgrading" by `unlock_shared()` then `lock()` without re-checking.** The first silently serialises every reader; the second lets another writer slip in. ([4.05](module-05-shared-mutex.md))
9. **A spinlock in a server where threads outnumber cores.** The holder gets descheduled and the spinner burns its whole timeslice. ([4.06](module-06-spinlocks-and-atomics.md))
10. **An auto-reset Event for "stop", or `stopEvent` first when you wanted a drain.** Only one worker exits, or queued requests are dropped, because the lowest signalled index wins. ([4.12](module-12-win32-synchronisation.md))

## Resume lines this phase supports

| Claim | Evidence you now have |
|---|---|
| B. Undefined-behaviour-aware coding, performance, memory design | You watched a non-atomic flag loop change behaviour at `-O2`, fixed false sharing with `alignas(64)` per-thread slots, and kept the hot path free of allocation with pooled request objects. |
| C. Concurrency (threads, mutexes, shared_mutex, condition variables, atomics and the memory model, thread pools, lock-free basics, Win32 synchronisation) | You built each primitive's lab: futex contention numbers, a bounded queue with two condition variables, a measured `shared_mutex` comparison, a TTAS spinlock, store-buffer reordering observed, an SPSC ring under TSan, a thread pool, and the same layer on `CRITICAL_SECTION` and `WaitForMultipleObjects`. |
| F. Debugging (GDB, TSan, WinDbg) | You read TSan reports (two stacks, the write, the mutexes held), found a deadlock cycle from `__data.__owner` in GDB, and know the fields WinDbg's `!locks` reads. |
| H4. Multithreaded application server (synchronisation layer, pooled request model, master-table cache) | You can walk through the `sync.hpp` layer on both platforms, the pooled `Request` lease with "busy" on exhaustion, and the cache that builds off-lock and swaps under a microsecond lock. |
| H5. Incident debugging and RCA | You have a full hang story: lock held across a stalled database call, diagnosed from a dump, fixed by off-lock rebuild, prevented by a written lock order. |
| H7. Login latency | The master-table cache removed master-table reads from the login hot path before the index work (Phase 6) finished the job. |
| I. tcpkv (fixed thread pool, store guarded by `shared_mutex`, TSan clean, graceful shutdown) | You wrote the pool with a drain/stop-now shutdown and GoogleTests, justified `shared_mutex` with your own benchmark, use relaxed atomics for statistics, and run TSan with `halt_on_error=1` so a report fails CI. |

## Teach it back

Answer each prompt in your own words, without looking at the modules. Write your answers in `journal/YYYY-MM-DD-phase-4-teach-back.md` (use today's date) and send them for grading. Aim for one or two paragraphs each. A good answer mentions every point in its checklist.

**1. Explain why a condition variable wait must be in a loop, and why the shared state must change under the same mutex.**

- [ ] The condition variable carries no data and remembers no notifications; only the mutex-protected state means anything.
- [ ] Spurious wakeups are allowed by the standard.
- [ ] A notify sent before the wait is lost; checking the predicate first handles it.
- [ ] With several consumers, a woken thread can find the item already taken (stolen wakeup).
- [ ] `wait` registers the waiter before releasing the mutex, so a writer holding the same mutex cannot slip its write-and-notify into the gap; writing outside the mutex is also a data race.

**2. Explain what happens inside `std::mutex::lock()` and `unlock()` on Linux, and why contention is expensive.**

- [ ] The mutex is a futex word with states 0 (free), 1 (locked), 2 (locked, maybe waiters).
- [ ] A free lock is one atomic CAS in user space, no system call, tens of nanoseconds.
- [ ] On contention the waiter sets 2 and calls `FUTEX_WAIT` with the expected value, which the kernel re-checks.
- [ ] `unlock` exchanges to 0 and calls `FUTEX_WAKE` only if the old value was 2.
- [ ] Contention costs microseconds: system calls, sleeping and waking, context switches and cache misses; so reduce hold time first, shard only after measuring.

**3. Explain relaxed, release/acquire and `seq_cst` using the message-passing example and the "set my flag, check yours" example.**

- [ ] Relaxed gives atomicity and one modification order per variable, but orders no other memory; fine for counters.
- [ ] A release store that is read by an acquire load makes everything before the store visible after the load (message passing).
- [ ] Release/acquire are one-way barriers, so a store followed by a load can still reorder; on x86 that is the store buffer.
- [ ] Only `seq_cst` gives one global order, so both threads cannot read 0; on x86 the `seq_cst` store is `xchg`.
- [ ] A mutex unlock is a release and a lock is an acquire; default to a mutex or `seq_cst`, and run TSan.

**4. Design a fixed thread pool for tcpkv: its parts, its shutdown protocol, how results and exceptions come back, and how you size it.**

- [ ] N workers, one queue, one mutex, one condition variable, a stop flag; tasks run with the lock released.
- [ ] `submit` wraps the callable in a `packaged_task` (held by a `shared_ptr`) and returns its future; exceptions come back through `future::get()`.
- [ ] Shutdown: set the flag under the lock, `notify_all`, join every worker; drain versus stop-now, and stop-now futures throw `broken_promise`.
- [ ] `notify_one` per submitted task, not `notify_all`.
- [ ] Size CPU-bound pools near the core count and waiting pools by measurement (the app server matched the database connection pool); bound the queue for backpressure.

**5. A production server is alive but serves nothing and uses 0% CPU. Explain how you find the cause, and the rules that prevent it.**

- [ ] Confirm it is waiting, not spinning (`top`, threads in state S).
- [ ] Capture evidence: `gcore` or `gdb -p`, then `thread apply all bt`.
- [ ] Find threads in `__lll_lock_wait` under `pthread_mutex_lock`, print the mutex and read `__data.__owner` to follow the chain into a cycle; a holder blocked in I/O means a lock held across I/O instead.
- [ ] Name the four Coffman conditions and which fix removes which.
- [ ] Prevention: a documented lock order (levels, or address order for equals), `std::scoped_lock` for groups, no I/O or callbacks under a lock, TSan's lock-order-inversion check in CI.

## Next steps

- Take the [Phase 4 quiz](quiz.md).
- [Back to the course README](../README.md)
- Next phase: [Module 5.01: How the internet works](../phase-05-networking-and-servers/module-01-how-the-internet-works.md)
