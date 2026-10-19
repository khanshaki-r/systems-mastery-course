# Phase 4 quiz: Concurrency deep dive

**Instructions**

- Closed book. No modules, no cppreference, no compiler. Paper or a blank text file only.
- Time: 45 minutes.
- 15 questions, one mark each. Pass mark: **12/15**.
- Questions 1-5 test recall, 6-10 test application (spot the bug, say what is guaranteed), 11-15 test reasoning (diagnose a scenario, defend a trade-off).
- Concurrent programs can print different things on different runs. Where a question shows a threaded snippet, it asks what is **guaranteed**, not what one run printed.
- Write your answer before you open the `Answer` block. Mark yourself honestly: half an answer is zero.
- All C++ snippets compile with `g++ -std=c++17 -O2 -Wall -Wextra -Werror -pthread` on Ubuntu 24.04. Snippets without a `main` are fragments and compile with `-c`.

---

## Part A: recall

**Q1. Define a data race precisely. What does the C++ standard say about a program that has one?**

<details>
<summary>Answer</summary>

Two accesses to the same memory location from different threads, where at least one is a write, at least one is not atomic, and neither happens-before the other (no mutex handoff, join, or acquire/release pair orders them). A program with a data race has **undefined behaviour**, not just "an unspecified value".

The standard chose UB so the compiler may treat unmarked memory as thread-private: keep it in a register, read it once, merge or delete accesses. Two reads never race, and two atomic operations never race.

Revisit: [Module 4.02: Data races](module-02-data-races.md)

</details>

**Q2. What happens if a `std::thread` object is destroyed while it is still joinable? And why does `std::thread t(f, x);` fail to compile when `f` is `void f(int&)`?**

<details>
<summary>Answer</summary>

The destructor calls `std::terminate`, which aborts the whole process (SIGABRT). You must `join` or `detach` first; the safe habit is a joining RAII wrapper (what C++20's `std::jthread` does).

The constructor copies its arguments into storage owned by the new thread and passes those copies as rvalues. A non-const `int&` cannot bind to an rvalue. Pass `std::ref(x)` to send a real reference, and make sure `x` outlives the thread.

Revisit: [Module 4.01: Threads in C++](module-01-threads-in-cpp.md)

</details>

**Q3. On Linux, what does `std::mutex::lock()` do when the mutex is free, and what does it do when another thread holds it? When does `unlock()` make a system call?**

<details>
<summary>Answer</summary>

Free: one atomic compare-and-swap of the futex word from 0 to 1 in user space; no system call, tens of nanoseconds.

Held: the CAS fails, the thread exchanges the word to 2 ("locked, maybe waiters") and calls `futex(FUTEX_WAIT, 2)`. The kernel re-checks that the word is still 2 before sleeping, so an unlock in the gap is not lost.

`unlock()` exchanges the word to 0 and calls `FUTEX_WAKE` only if the old value was 2. Uncontended locking never enters the kernel.

Revisit: [Module 4.03: Mutex internals: futex](module-03-mutex-internals-futex.md)

</details>

**Q4. Define lock-free and wait-free, with one example of each. Then describe the ABA problem in one or two sentences.**

<details>
<summary>Answer</summary>

**Lock-free:** at every moment at least one thread completes its operation in a bounded number of steps, so the system always makes progress; a Treiber stack with a CAS loop is lock-free. **Wait-free:** every thread completes every operation in a bounded number of its own steps; a `fetch_add` counter or a single-producer single-consumer ring buffer is wait-free. Neither word means "fast".

**ABA:** a CAS succeeds because a pointer has the same value it had earlier, although the state behind it changed in between (for example a node was popped, freed and pushed back). Fixes: a version counter next to the pointer, hazard pointers, epochs, or never reusing nodes.

Revisit: [Module 4.09: Lock-free basics](module-09-lock-free-basics.md)

</details>

**Q5. On Windows: how is a `CRITICAL_SECTION` different from a kernel Mutex, and how is a manual-reset Event different from an auto-reset Event?**

<details>
<summary>Answer</summary>

A `CRITICAL_SECTION` is a user-mode structure in your process: entering it when free is one interlocked operation with no system call; on contention it spins briefly and then waits in the kernel. It is recursive and works only inside one process. A **Mutex** is a kernel object behind a handle: every wait is a system call, it can be named and shared across processes, it reports `WAIT_ABANDONED` if its owner dies, and it can be combined with other handles in `WaitForMultipleObjects`.

A **manual-reset** Event stays signalled and releases every waiter until `ResetEvent`; it models a state such as "shutting down". An **auto-reset** Event releases exactly one waiter and resets itself. Using an auto-reset Event for "stop" lets only one worker exit.

Revisit: [Module 4.12: Win32 synchronisation](module-12-win32-synchronisation.md)

</details>

---

## Part B: apply

**Q6. Several worker threads call `pop()` on this queue. Under load, one of them occasionally crashes inside `front()`. Find the bug and fix it.**

```cpp
#include <condition_variable>
#include <deque>
#include <mutex>

class WorkQueue {
public:
    void push(int job) {
        {
            std::lock_guard<std::mutex> lk(m_);
            q_.push_back(job);
        }
        cv_.notify_one();
    }

    int pop() {
        std::unique_lock<std::mutex> lk(m_);
        if (q_.empty()) {
            cv_.wait(lk);
        }
        int job = q_.front();
        q_.pop_front();
        return job;
    }

private:
    std::mutex m_;
    std::condition_variable cv_;
    std::deque<int> q_;
};
```

<details>
<summary>Answer</summary>

`pop()` checks the condition with `if`, so after waking it never re-checks. `wait` can return with the queue empty in two ways: a **spurious wakeup** (allowed by the standard), or a **stolen wakeup**, where another consumer reacquired the mutex first and took the only item. Then `front()` on an empty deque is undefined behaviour.

Fix: wait with a predicate, which is a loop:

```cpp
cv_.wait(lk, [this] { return !q_.empty(); });
```

`push` is already correct: it changes the deque under the mutex and notifies one waiter per item.

Revisit: [Module 4.04: Condition variables](module-04-condition-variables.md)

</details>

**Q7. Is this program guaranteed to print `400000`? Is it a data race? What one-line change makes the result guaranteed?**

```cpp
#include <atomic>
#include <iostream>
#include <thread>
#include <vector>

int main() {
    std::atomic<int> hits{0};
    std::vector<std::thread> ts;
    for (int t = 0; t < 4; ++t) {
        ts.emplace_back([&hits] {
            for (int i = 0; i < 100000; ++i) {
                hits = hits + 1;
            }
        });
    }
    for (auto& th : ts) th.join();
    std::cout << hits << '\n';
}
```

<details>
<summary>Answer</summary>

**Not guaranteed.** It can print less than 400000 (never more). It is **not** a data race, because every access to `hits` is atomic, so the behaviour is defined; it is simply the wrong algorithm.

`hits = hits + 1` is three steps: an atomic load, a plain add, an atomic store. Two threads can load the same value and both store the same result, so one increment is lost. Fix: make the read-modify-write one atomic operation:

```cpp
hits.fetch_add(1, std::memory_order_relaxed);   // or ++hits;
```

Relaxed is enough here because the count is only read after `join`, which already orders it.

Revisit: [Module 4.06: Spinlocks and atomics](module-06-spinlocks-and-atomics.md)

</details>

**Q8. On an x86 laptop the assertion below has never fired. Is it guaranteed to hold? Explain, and give the minimal fix.**

```cpp
#include <atomic>
#include <cassert>
#include <thread>

int payload = 0;
std::atomic<bool> ready{false};

void producer() {
    payload = 42;
    ready.store(true, std::memory_order_relaxed);
}

void consumer() {
    while (!ready.load(std::memory_order_relaxed)) {
    }
    assert(payload == 42);
}

int main() {
    std::thread c(consumer);
    std::thread p(producer);
    p.join();
    c.join();
}
```

<details>
<summary>Answer</summary>

**Not guaranteed.** Relaxed operations make `ready` itself atomic but create no happens-before edge, so the write to `payload` and the read of `payload` are unordered: that is a data race on `payload`, which is undefined behaviour. The compiler (on any CPU) or the hardware (on ARM) may make the consumer see `ready == true` and an old `payload`. It "works" on x86 only by luck; ThreadSanitizer reports the race on `payload` immediately.

Minimal fix: release on the store, acquire on the load.

```cpp
ready.store(true, std::memory_order_release);           // producer
while (!ready.load(std::memory_order_acquire)) { }      // consumer
```

Now the release store synchronizes with the acquire load that reads `true`, so `payload = 42` happens-before the assertion. The default `seq_cst` also works.

Revisit: [Module 4.07: The memory model and memory orders](module-07-memory-model-and-memory-orders.md)

</details>

**Q9. Thread 1 runs `transfer(x, y, 1)` in a loop while thread 2 runs `transfer(y, x, 1)` in a loop. What can happen, which Coffman condition makes it possible, how would you confirm it on the live process, and how do you fix `transfer`?**

```cpp
#include <mutex>

struct Account {
    std::mutex m;
    long balance = 0;
};

void transfer(Account& from, Account& to, long amount) {
    std::lock_guard<std::mutex> a(from.m);
    std::lock_guard<std::mutex> b(to.m);
    from.balance -= amount;
    to.balance += amount;
}
```

<details>
<summary>Answer</summary>

**Deadlock.** Thread 1 holds `x.m` and waits for `y.m`; thread 2 holds `y.m` and waits for `x.m`. The process stays alive at 0% CPU and never finishes. The condition is **circular wait** (each thread also holds one lock while waiting for another: hold and wait).

Confirm: `gdb -p <pid>` (or `gcore`), `thread apply all bt`, see both threads in `__lll_lock_wait` under `pthread_mutex_lock`, then `print *(pthread_mutex_t*)addr` on each mutex and read `__data.__owner`: each is owned by the other thread's LWP.

Fix: lock both at one point with a deadlock-avoiding algorithm, and never lock the same mutex twice:

```cpp
void transfer(Account& from, Account& to, long amount) {
    if (&from == &to) return;                  // never lock one mutex twice
    std::scoped_lock lk(from.m, to.m);         // C++17: deadlock-free for the pair
    from.balance -= amount;
    to.balance += amount;
}
```

Ordering the two locks by address also works and is the rule when the second lock is taken deeper in a call chain.

Revisit: [Module 4.11: Deadlocks, livelocks and lock ordering](module-11-deadlocks-and-lock-ordering.md)

</details>

**Q10. This pool works in a quick test, but in the server it never gets more than one task's worth of throughput, and sometimes the program hangs forever on exit. Find the two bugs, marked (A) and (B), and fix them.**

```cpp
#include <condition_variable>
#include <functional>
#include <mutex>
#include <queue>
#include <thread>
#include <vector>

class Pool {
public:
    explicit Pool(unsigned n) {
        for (unsigned i = 0; i < n; ++i) {
            workers_.emplace_back([this] { loop(); });
        }
    }

    ~Pool() {
        stop_ = true;                                  // (A)
        cv_.notify_all();
        for (auto& w : workers_) w.join();
    }

    void submit(std::function<void()> f) {
        {
            std::lock_guard<std::mutex> lk(m_);
            q_.push(std::move(f));
        }
        cv_.notify_one();
    }

private:
    void loop() {
        std::unique_lock<std::mutex> lk(m_);
        for (;;) {
            cv_.wait(lk, [this] { return stop_ || !q_.empty(); });
            if (stop_ && q_.empty()) return;
            auto task = std::move(q_.front());
            q_.pop();
            task();                                    // (B)
        }
    }

    std::mutex m_;
    std::condition_variable cv_;
    std::queue<std::function<void()>> q_;
    bool stop_ = false;
    std::vector<std::thread> workers_;
};
```

<details>
<summary>Answer</summary>

**(A) `stop_` is written without the mutex.** It is a data race (TSan reports it), and it allows a lost wakeup: a worker evaluates the predicate as false, then the destructor sets `stop_` and calls `notify_all` before the worker is registered as a waiter, so the worker sleeps forever and `join` never returns.

**(B) The task runs while the worker holds `m_`.** Only one task can run at a time, so the pool has single-thread throughput; and a task that calls `submit` would try to lock `m_` again and deadlock.

Fixed parts:

```cpp
    ~Pool() {
        {
            std::lock_guard<std::mutex> lk(m_);
            stop_ = true;                              // (A) fixed: under the mutex
        }
        cv_.notify_all();
        for (auto& w : workers_) w.join();
    }

    void loop() {
        for (;;) {
            std::function<void()> task;
            {
                std::unique_lock<std::mutex> lk(m_);
                cv_.wait(lk, [this] { return stop_ || !q_.empty(); });
                if (stop_ && q_.empty()) return;       // drain, then exit
                task = std::move(q_.front());
                q_.pop();
            }                                          // (B) fixed: lock released
            task();
        }
    }
```

A production pool would also catch exceptions around `task()`, because an exception escaping a thread calls `std::terminate`.

Revisit: [Module 4.10: Thread pool design](module-10-thread-pool-design.md)

</details>

---

## Part C: reason

**Q11. `x` and `y` start at 0. `thread_a` and `thread_b` each run once, at the same time, and are then joined. Can the result be `r1 == 0 && r2 == 0` with the orders shown? What if every operation were `memory_order_relaxed`? What if every operation were `memory_order_seq_cst`? Explain the hardware mechanism on x86-64. (Fragment.)**

```cpp
#include <atomic>

std::atomic<int> x{0}, y{0};
int r1 = 0, r2 = 0;

void thread_a() {
    x.store(1, std::memory_order_release);
    r1 = y.load(std::memory_order_acquire);
}

void thread_b() {
    y.store(1, std::memory_order_release);
    r2 = x.load(std::memory_order_acquire);
}
```

<details>
<summary>Answer</summary>

- **Release/acquire (as shown): yes, both zero is allowed.** A release only stops earlier operations moving after the store; an acquire only stops later operations moving before the load. Nothing stops a store from being delayed past a later load.
- **Relaxed: yes, allowed.**
- **`seq_cst`: no.** All `seq_cst` operations form one total order consistent with each thread's program order, so at least one load comes after the other thread's store and reads 1.

Mechanism: each core puts its store into a private **store buffer** and continues; its next load reads the cache, where the other core's store has not arrived yet. This store-then-load reordering is the one reordering x86 (TSO) allows. For a `seq_cst` store the compiler emits `xchg`, a locked instruction that drains the store buffer before the load runs. This is why "set my flag, then check yours" algorithms (Dekker, Peterson) need `seq_cst`, while one-way message passing only needs release/acquire.

Revisit: [Module 4.07: The memory model and memory orders](module-07-memory-model-and-memory-orders.md)

</details>

**Q12. After a config reload, a worker in the release build spins at 100% of one core forever. The debug build works. The code is below. Explain the mechanism, how you would confirm it from the live process, and the correct fix. (Fragment.)**

```cpp
void apply_new_config();

long polls = 0;
bool reloaded = false;   // set to true by the reload thread

void wait_for_reload() {
    while (!reloaded) {
        ++polls;
    }
    apply_new_config();
}
```

<details>
<summary>Answer</summary>

`reloaded` is a plain `bool` written by one thread and read by another with no synchronisation: a data race, so undefined behaviour. At `-O2` the compiler assumes no other thread changes it, loads it **once** before the loop, and turns the loop into a jump to itself. GCC 13 at `-O2` emits exactly that: one `cmpb` on `reloaded`, then `jmp` to the same label forever. The reload thread's store is never read again.

Confirm: `gdb -p <pid>`, `info threads` to find the hot thread, `thread N`, `bt` to see it in `wait_for_reload`, and `x/3i $pc` to see a `jmp` to its own address with no load inside the loop.

Fix: `std::atomic<bool> reloaded{false};`. If the worker then reads the new config, store with release and load with acquire (or keep the default `seq_cst`). `volatile` is not a fix: it stops the hoist but gives no ordering and is still a race. Better still, replace polling with a condition variable. Note that other shapes of the same bug fail differently: with an empty loop body GCC 13 deletes the loop entirely, so the worker does not wait at all. Undefined behaviour has no single symptom.

Revisit: [Module 4.02: Data races](module-02-data-races.md), [Module 4.07: The memory model and memory orders](module-07-memory-model-and-memory-orders.md)

</details>

**Q13. Each of 4 worker threads increments only its own counter slot, so there is "no sharing". Yet with 4 threads each thread runs much slower than when it runs alone, and a profile blames the increment. Explain why, and fix the layout. (The fix must keep `memory_order_relaxed`.)**

```cpp
#include <atomic>

struct Stats {
    std::atomic<long> per_thread[4];   // slot i is written only by thread i
};
// Thread i runs: s.per_thread[i].fetch_add(1, std::memory_order_relaxed);
```

<details>
<summary>Answer</summary>

**False sharing.** The four 8-byte slots sit in one 64-byte cache line. Cache coherence (MESI) works per line: to write, a core must own the line in Modified state, which invalidates every other core's copy. So each increment pulls the line away from the other cores, and the line ping-pongs as if all threads shared one variable. Results stay correct; only speed suffers, often by several times.

Fix: give each slot its own line, and check the layout at compile time.

```cpp
#include <atomic>

struct alignas(64) Slot {
    std::atomic<long> value{0};
};

struct Stats {
    Slot per_thread[4];                // each slot on its own 64-byte line
};

static_assert(sizeof(Slot) == 64, "one slot per cache line");
```

A reader sums the slots when it needs a total. On bare metal, `perf c2c` would show the HITM loads on the shared line before the fix.

Revisit: [Module 4.08: Cache coherence and false sharing](module-08-cache-coherence-and-false-sharing.md)

</details>

**Q14. A teammate replaced the `std::mutex` around tcpkv's `unordered_map` with a `std::shared_mutex`: `shared_lock` for GET, `unique_lock` for SET. The mix is 95% GET, and a GET is a short lookup that copies a small value. Results: at 1 thread throughput dropped; at 8 threads it is about the same as before; and during a burst of GETs, SET latency became much worse. Explain all three observations and say what you would do.**

<details>
<summary>Answer</summary>

- **Slower at 1 thread:** a shared lock costs at least as much as a plain mutex lock (an atomic read-modify-write on the reader count plus writer checks, and another to release). With no parallelism to gain, that is pure overhead.
- **No gain at 8 threads:** every reader writes the same lock word, so readers contend on that cache line even without writers. Running readers in parallel only pays back when the critical section is long; a short lookup is not.
- **SET latency worse:** on Linux, `std::shared_mutex` is glibc's `pthread_rwlock_t`, which is reader-preferring by default, so new readers keep entering while a writer waits: writer starvation.

What to do: measure the real mix at 1, 4 and 8 threads against a plain mutex and against striped mutexes (for example 16 stripes, each padded to its own cache line), reporting throughput, spread and SET latency. Keep `shared_mutex` only if it meets the target with acceptable writer latency. Otherwise go back to a plain mutex, or stripe if SETs grow. For rarely-changing data, an immutable snapshot behind a `shared_ptr` is another option.

Revisit: [Module 4.05: shared_mutex and reader-writer locks](module-05-shared-mutex.md)

</details>

**Q15. The app server's master-table cache refreshes on a timer. During every refresh, request p99 latency jumps for about as long as the database load takes. The refresh code is below. Explain the cause and rewrite `refresh()`. Then answer a product manager who asks: "Can we cache account balances the same way to save more database calls?" (Fragment.)**

```cpp
#include <mutex>
#include <shared_mutex>
#include <string>
#include <unordered_map>

struct Product { double rate; int max_tenure_months; };
using Table = std::unordered_map<std::string, Product>;

void load_all_rows_from_db(Table& out);   // takes about 800 ms

class MasterCache {
public:
    void refresh() {
        std::unique_lock<std::shared_mutex> lk(m_);
        table_.clear();
        load_all_rows_from_db(table_);
    }

    bool find(const std::string& code, Product& out) const {
        std::shared_lock<std::shared_mutex> lk(m_);
        auto it = table_.find(code);
        if (it == table_.end()) return false;
        out = it->second;
        return true;
    }

private:
    mutable std::shared_mutex m_;
    Table table_;
};
```

<details>
<summary>Answer</summary>

Cause: `refresh()` holds the **exclusive** lock across the whole database load. For about 800 ms every `find()` blocks on its `shared_lock`, so every request waits. It is a lock held across I/O, the most common real-world "deadlock-like" stall.

Fix: build the new table with no lock held, then swap it in under an exclusive lock that lasts microseconds.

```cpp
    void refresh() {
        Table fresh;
        load_all_rows_from_db(fresh);              // slow part, no lock held
        {
            std::unique_lock<std::shared_mutex> lk(m_);
            table_.swap(fresh);                    // O(1) pointer swap
        }                                          // old rows freed here, after unlock
    }
```

`find()` is already right: it copies the row out instead of returning a reference that would dangle after the next swap. An alternative is to publish an immutable `shared_ptr<const Table>` snapshot, which also gives one consistent version per request.

Answer to the product manager: **no.** The cache is safe only for master data that changes rarely through an admin path, with a written staleness bound (version-counter poll every few seconds plus a TTL). Balances are written by the very transactions being served, so a stale balance would approve a loan on old data. Balances stay in the database, read inside the transaction.

Revisit: [Module 4.13: Pooled request model and a concurrent master-table cache](module-13-pooled-request-model-and-concurrent-cache.md), [Module 4.11: Deadlocks, livelocks and lock ordering](module-11-deadlocks-and-lock-ordering.md)

</details>

---

## Scoring

| Score | What it means | What to do next |
|---|---|---|
| 15/15 | Ready. | Do the [teach-it-back exercise](revision.md#teach-it-back), then start [Phase 5](../phase-05-networking-and-servers/module-01-how-the-internet-works.md). |
| 12-14 | Pass, with gaps. | Revisit the modules listed under every question you missed, re-answer those questions tomorrow, then move on. |
| Below 12 | Not yet. | Find the two or three modules with the most misses and redo their labs (section 8) from scratch, under TSan, before retaking the quiz. |

Back to the [Phase 4 revision sheet](revision.md) or the [course README](../README.md).
