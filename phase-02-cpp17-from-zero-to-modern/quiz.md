# Phase 2 quiz: C++17 from zero to modern C++

## Instructions

- **Closed book.** No modules, no notes, no search, no AI, and do not compile the code until you have written your answer.
- **Time: 45 minutes.** Set a timer before you start.
- **Pass mark: 12 out of 15.** Each question is worth 1 mark. A question with several parts needs every part right unless it says otherwise.
- Write all your answers first (on paper or in a scratch file). Only then open the `<details>` blocks and mark yourself honestly.
- Questions get harder as you go: 1 to 5 are recall, 6 to 10 are apply (predict output, spot the bug), 11 to 15 are reasoning.
- Every program here was compiled with GCC 13 (libstdc++) on Ubuntu 24.04 (x86-64) with `g++ -std=c++17 -Wall -Wextra -Werror -g` and its output checked.
- After marking, you may compile any snippet in WSL to see the answer for yourself.

---

## Part A: recall

**Q1. (a) Give three differences between a reference and a pointer in C++, and say whether they differ in run-time cost. (b) What is the only difference between a `class` and a `struct`?**

<details>
<summary>Answer</summary>

(a) Any three of: a reference must be initialised when declared; it can never be null; it cannot be reseated to refer to another object; it has no arithmetic; it is used with the same syntax as the object. A pointer can be null, can be reassigned, supports arithmetic and needs `*` and `->`. There is **no run-time difference**: the compiler implements a reference as a pointer, so the machine code is the same. The difference is the guarantee. Use `const T&` to read, `T&` to modify, and `T*` only when "no object" is a legal answer.

(b) Default access only: `struct` members and bases are `public` by default, `class` members and bases are `private` by default. Everything else is identical.

Revisit: [Module 2.01](module-01-from-c-to-cpp.md), [Module 2.02](module-02-classes-constructors-destructors.md)

</details>

**Q2. Name the five special member functions covered by the rule of five. Then state the rule of 0, the rule of 3 and the rule of 5 in one sentence each.**

<details>
<summary>Answer</summary>

Destructor, copy constructor, copy assignment operator, move constructor, move assignment operator.

- **Rule of 0:** if every member manages its own resource (`std::string`, `std::vector`, `std::unique_ptr`), declare none of the five; the compiler's versions are correct.
- **Rule of 3:** if a class needs a hand-written destructor because it releases a resource, it also needs hand-written or deleted copy operations, because the default copy duplicates the raw handle.
- **Rule of 5:** since C++11, also write (or delete) the two move operations, because declaring a destructor suppresses the implicit moves and the type would silently copy instead.

Aim for rule of 0 in application code; use rule of 5 only in handle wrappers such as `FileDescriptor`.

Revisit: [Module 2.03](module-03-raii-and-rule-of-0-3-5.md), [Module 2.04](module-04-move-semantics.md)

</details>

**Q3. On 64-bit libstdc++: (a) How big is a `std::unique_ptr<T>` (default deleter) and a `std::shared_ptr<T>`? (b) What does a `shared_ptr` control block contain? (c) How many heap allocations do `std::shared_ptr<T>(new T)` and `std::make_shared<T>()` make, and what is the downside of `make_shared`?**

<details>
<summary>Answer</summary>

(a) `unique_ptr`: 8 bytes, the same as a raw pointer, and it compiles to the same code. `shared_ptr`: 16 bytes, a pointer to the object and a pointer to the control block.

(b) A vtable pointer (the block is polymorphic), an atomic strong count, an atomic weak count, and either the raw pointer plus deleter or, for `make_shared`, the object itself in place.

(c) `shared_ptr<T>(new T)`: two allocations (object, then control block). `make_shared<T>()`: one allocation holding both. Downside: because the object lives inside the block, its bytes cannot be freed until the **weak** count also reaches zero. The destructor still runs when the strong count hits zero, but a long-lived `weak_ptr` keeps the memory allocated.

Revisit: [Module 2.05](module-05-smart-pointers-and-control-block.md)

</details>

**Q4. Given `template <typename T> T max_of(T a, T b) { return a > b ? a : b; }`: (a) Why must this definition live in a header, not a `.cpp` file? (b) What happens with `max_of(3, 7.5)`, and how do you fix the call? (c) Rewrite `template <class T, class = std::enable_if_t<std::is_integral_v<T>>> T twice(T v)` using a C++20 concept.**

<details>
<summary>Answer</summary>

(a) A template is instantiated in the translation unit that uses it, for the specific types used there, and the compiler needs the full definition at that point. A definition hidden in one `.cpp` is invisible to other files, so they produce no instantiation and the link fails with `undefined reference to max_of<int>`. (Explicit instantiation plus `extern template` is the exception.)

(b) It does not compile: `no matching function for call to 'max_of(int, double)'`, with the note "deduced conflicting types for parameter 'T' ('int' and 'double')". `T` cannot be two types. Fix: `max_of<double>(3, 7.5)` (prints 7.5), or convert one argument.

(c) `template <std::integral T> T twice(T v)` (or `template <class T> requires std::integral<T> T twice(T v)`), with `#include <concepts>` and `-std=c++20`. A wrong type now fails with "constraints not satisfied" naming `integral<T>`, instead of substitution-failure noise.

Revisit: [Module 2.06](module-06-templates.md), [Module 2.15](module-15-cpp20-essentials.md)

</details>

**Q5. (a) Give two reasons a singleton is a problem in a server codebase, and the safe way to write one if you are forced to. (b) What does `std::jthread` do in its destructor that `std::thread` does not?**

<details>
<summary>Answer</summary>

(a) Any two of: it is a global in disguise, so every user is coupled to one hidden instance; it cannot be replaced by a fake in tests (the handler tests would need a real database); if it is a namespace-scope global, its construction order relative to globals in other files is unspecified (the static initialisation order fiasco). If forced, use a function-local static: `static T& instance() { static T t; return t; }`, which is initialised once, on first use, and thread-safely since C++11. Better: construct it in `main` and pass it by reference (dependency injection).

(b) `std::jthread`'s destructor calls `request_stop()` and then `join()`. Destroying a still-joinable `std::thread` calls `std::terminate`, aborting the process. `request_stop()` only sets a flag; the thread function must check its `std::stop_token` to actually stop.

Revisit: [Module 2.11](module-11-design-patterns-in-systems-code.md), [Module 2.15](module-15-cpp20-essentials.md)

</details>

---

## Part B: apply

**Q6. Predict the exact output.**

```cpp
#include <iostream>
#include <string>
#include <utility>

struct Tracer {
    std::string name;
    explicit Tracer(std::string n) : name(std::move(n)) {
        std::cout << "ctor " << name << '\n';
    }
    ~Tracer() { std::cout << "dtor " << name << '\n'; }
};

int main() {
    Tracer a("A");
    {
        Tracer b("B");
        Tracer c("C");
    }
    Tracer d("D");
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
ctor A
ctor B
ctor C
dtor C
dtor B
ctor D
dtor D
dtor A
```

Destructors run when a scope ends, in **reverse** order of construction. The inner block ends before `d` is created, so `C` then `B` are destroyed first. At the end of `main`, `D` (constructed last) dies before `A`. This deterministic order is what RAII relies on.

Revisit: [Module 2.02](module-02-classes-constructors-destructors.md)

</details>

**Q7. Predict the exact output.**

```cpp
#include <iostream>
#include <utility>

class Fd {
public:
    explicit Fd(int fd) : fd_(fd) {}
    Fd(const Fd&) = delete;
    Fd& operator=(const Fd&) = delete;
    Fd(Fd&& other) noexcept : fd_(other.fd_) { other.fd_ = -1; }
    ~Fd() {
        if (fd_ != -1) {
            std::cout << "close " << fd_ << '\n';
        }
    }
    int get() const { return fd_; }

private:
    int fd_;
};

int main() {
    Fd a(7);
    Fd b(std::move(a));
    std::cout << a.get() << ' ' << b.get() << '\n';
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
-1 7
close 7
```

`std::move(a)` is only a cast; the move constructor does the work: it takes descriptor 7 and sets `a.fd_` to -1, so exactly one object owns 7. At the end of `main`, `b` is destroyed first and prints `close 7`; `a` holds -1 and prints nothing. Without the reset, both destructors would close 7: the double-close bug. With copies deleted, the compiler guarantees a single owner.

Revisit: [Module 2.04](module-04-move-semantics.md), [Module 2.03](module-03-raii-and-rule-of-0-3-5.md)

</details>

**Q8. Predict the exact output. Then say what it prints if you add `noexcept` to `Loan(Loan&&)`, and why.**

```cpp
#include <iostream>
#include <vector>

struct Loan {
    Loan() = default;
    Loan(const Loan&) { std::cout << "copy\n"; }
    Loan(Loan&&) { std::cout << "move\n"; }   // note: no noexcept
};

int main() {
    std::vector<Loan> v;
    v.reserve(1);
    v.emplace_back();
    std::cout << "--\n";
    v.emplace_back();          // capacity 1 is full: the vector grows
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
--
copy
```

With `noexcept` on the move constructor:

```text
--
move
```

The first `emplace_back` default-constructs in reserved space (prints nothing). The second needs a bigger block: the new element is constructed there, then the existing element is relocated. `std::vector` promises the strong exception guarantee, so it uses `std::move_if_noexcept`: if the move constructor might throw (it is not `noexcept`) and the type can be copied, it **copies**, because a move that threw halfway would leave both blocks broken. Marking the move `noexcept` lets it move. With a million elements, that missing keyword is a million copies.

Revisit: [Module 2.04](module-04-move-semantics.md), [Module 2.07](module-07-stl-containers-internals.md), [Module 2.09](module-09-exceptions-vs-error-codes.md)

</details>

**Q9. Spot the bug. `pool_` is a thread pool that stores tasks as `std::function<void()>` and runs them later on worker threads. Under load the server sometimes sends garbage or crashes. What is wrong, what does AddressSanitizer report, and what is the fix?**

```cpp
void Server::on_request(int id) {
    std::string reply = build_reply(id);
    pool_.submit([&] { send_reply(id, reply); });
}   // on_request returns long before a worker runs the task
```

<details>
<summary>Answer</summary>

`[&]` captures `id` and `reply` **by reference**: the lambda stores their addresses in `on_request`'s stack frame. `on_request` returns, its frame is reused, and when a worker later runs the task it reads dead memory. With `ASAN_OPTIONS=detect_stack_use_after_return=1`, ASan reports `stack-use-after-return` inside the lambda's `operator()`, called from `std::function`'s invoker.

Fix: capture by value and move the string in with an init-capture, so the task owns everything it uses:

```cpp
pool_.submit([id, reply = std::move(reply)] { send_reply(id, reply); });
```

Rule: a task that may run after the current scope ends never captures by reference and never captures a bare `this`; use values, init-captures, or `[self = shared_from_this()]`. `[&]` is fine only for lambdas used immediately, such as a `std::sort` comparator.

Revisit: [Module 2.08](module-08-iterators-algorithms-lambdas.md)

</details>

**Q10. Predict the exact output.**

```cpp
#include <iostream>

struct Handler {
    virtual ~Handler() = default;
    virtual const char* name() const { return "base"; }
};

struct LoanHandler final : Handler {
    const char* name() const override { return "loan"; }
};

void by_ref(const Handler& h) { std::cout << h.name() << '\n'; }
void by_val(Handler h) { std::cout << h.name() << '\n'; }

int main() {
    LoanHandler lh;
    const Handler* p = &lh;
    by_ref(lh);
    by_val(lh);
    std::cout << p->name() << '\n';
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
loan
base
loan
```

Through a reference or a pointer, the call goes through the object's vptr to `LoanHandler`'s vtable, so `loan`. `by_val` takes a `Handler` **by value**: only the base part is copied (**slicing**), and the copy's vptr points to `Handler`'s vtable, so `base`. There is no warning. Prevent it by never passing polymorphic objects by value and by deleting the base class's copy operations.

Revisit: [Module 2.10](module-10-inheritance-and-virtual-dispatch.md)

</details>

---

## Part C: reason

**Q11. A teammate proposes that `parse_line` in tcpkv should `throw ParseError` on a malformed line, caught in the worker loop. Argue for or against, with numbers, and say where exceptions do belong in a server.**

<details>
<summary>Answer</summary>

Against, for the per-request path. A malformed line is a **normal** event for a server on a network (every typo in `nc`), not an exceptional one. On the happy path exceptions are free, but a throw costs microseconds: two stack walks over the unwind tables, a heap allocation for the exception object, and destructor calls. On one laptop the course measured about 4 to 5 µs per throw against about 2 ns for a returned status, roughly 2,000 times more. A flood of bad requests would then collapse throughput exactly when the server is under attack. So `parse_line` returns `std::optional<Command>` plus an error string, and the caller builds `ERR <reason>`.

Exceptions belong where failures are rare and far from their handler: start-up (cannot bind the port, bad config), constructor failures, and invariant violations (bugs). And every worker thread's entry function has a top-level `catch`, because an exception escaping a thread function (or a destructor, or a `noexcept` function) calls `std::terminate` and kills every connection.

Revisit: [Module 2.09](module-09-exceptions-vs-error-codes.md), [Module 2.16](module-16-cpp-mini-project-protocol-parser.md)

</details>

**Q12. Design the in-memory store for tcpkv (`GET`, `SET`, `DEL` by exact string key, many worker threads). Justify the container, the lock, how a `GET` returns its value, who owns the data, and whether the store should be an `IStore` virtual interface "so we can swap it later".**

<details>
<summary>Answer</summary>

- **Container:** `std::unordered_map<std::string, std::string>`. The protocol has no ordered or range queries, so a hash table gives O(1) average lookups with two or three cache misses, against about 2 log n dependent pointer loads in a `std::map` red-black tree. Short keys fit in the string's 15-character inline buffer, so a lookup allocates nothing. `reserve` the expected size so loading does not rehash repeatedly.
- **Lock:** `std::shared_mutex`. `GET` takes a `std::shared_lock` so readers run in parallel; `SET` and `DEL` take a `std::unique_lock`.
- **Read path:** `find` under the shared lock and **copy the value out** before unlocking. After unlocking, another thread's `erase` destroys the node and an insert can rehash, so a reference or `string_view` held past the lock is a use-after-free.
- **Ownership:** the map owns keys and values. Not `shared_ptr<std::string>` per value: that adds an atomic increment and decrement per read under contention and hides lifetimes; copying a short value is cheaper.
- **Interface:** keep `Store` a concrete `final` class. There is one implementation, and it is on the hottest path: a virtual call is two loads plus an indirect call and blocks inlining of a lookup that takes tens of nanoseconds. If a second implementation appears, prefer a template parameter (`Server<Store>`). Virtual interfaces pay off in the handler layer above, where each call does microseconds of work.
- **Then measure:** p50 and p99 `GET` latency under the load generator, `shared_mutex` versus plain `mutex`.

Revisit: [Module 2.07](module-07-stl-containers-internals.md), [Module 2.10](module-10-inheritance-and-virtual-dispatch.md), [Module 2.12](module-12-memory-and-ownership-design.md)

</details>

**Q13. A profile of a request handler shows 50% of the time in the hash lookup, 40% in parsing and 10% in socket I/O. You can either make the lookup 2 times faster or make parsing 4 times faster, not both. Which do you pick, what is the overall speedup of each option, and how did you get the percentages in the first place?**

<details>
<summary>Answer</summary>

Use Amdahl's law: speedup = 1 / ((1 - p) + p / s).

- Lookup 2 times faster: 1 / (0.50 + 0.50 / 2) = 1 / 0.75 = **1.33 times**.
- Parsing 4 times faster: 1 / (0.60 + 0.40 / 4) = 1 / 0.70 = **1.43 times**.

Pick **parsing**, even though the lookup is the bigger slice, because the bigger factor on a slightly smaller slice removes more total time (0.30 of the run against 0.25). Note also that even infinitely fast I/O would cap the gain at 1 / 0.90 = 1.11 times.

The percentages come from a sampling profiler (`perf record -g` under a realistic load generator, read with `perf report`), on an `-O2` build. `perf stat` (cache misses, branch misses) then explains *why* a part is slow. After the change, re-measure with the same harness (warm-up, repetitions, median) and keep it only if the median moved.

Revisit: [Module 2.13](module-13-performance-optimisation.md)

</details>

**Q14. Clients report that `SET` commands with long values sometimes get `ERR unknown command` back from your server, but only over the WAN, never on the office LAN. Diagnose it, fix it, and say how you prove the fix.**

<details>
<summary>Answer</summary>

**Diagnosis: framing.** TCP is a byte stream; it does not keep `send` boundaries. On the LAN a short request arrives in one segment and one `recv`. Over the WAN a long value crosses a segment boundary (about 1460 bytes on Ethernet), so it arrives in two `recv` calls. A server that treats each `recv` as one command parses the second half of the value as a new line whose first word is random text, hence `unknown command`. Confirm with `tcpdump`, or reproduce locally with a client that sends one byte at a time, which breaks the naive server the same way.

**Fix:** a per-connection `LineBuffer` that appends every `recv`, hands out only complete lines cut at `\n` (stripping `\r`), and keeps the remainder for the next read. The parser never sees the socket. Bound it at the same time: a line may be at most 4096 bytes including `\n`, and an unterminated tail that reaches 4096 bytes gets `ERR line too long` and the connection is closed, so a client cannot grow the buffer forever.

**Proof:** unit tests that feed partial lines, several lines per chunk and byte-at-a-time input to the buffer; the one-byte-at-a-time client against the real server getting correct replies; and the count of `ERR` replies under the load generator dropping to zero.

Revisit: [Module 2.16](module-16-cpp-mini-project-protocol-parser.md)

</details>

**Q15. A release build of the server occasionally returns data that belongs to a different request. Debug builds and an AddressSanitizer run are clean. Name at least four kinds of undefined behaviour that fit these symptoms and the tool or technique that would catch each.**

<details>
<summary>Answer</summary>

"Wrong data, no crash, release only, ASan clean" means memory that is still allocated but wrong, or something the optimiser exploits. Any four of:

| UB class | Why ASan misses it | What catches it |
|---|---|---|
| Uninitialised member holding the previous request's value | The memory is valid; only its contents are wrong | Valgrind memcheck, Clang MemorySanitizer |
| Iterator or reference invalidated by an insert or rehash in a node container | Nodes are relinked, not freed | `-D_GLIBCXX_DEBUG` (aborts with "singular iterator") |
| Strict-aliasing violation (`reinterpret_cast` between unrelated types) | No memory error at all; only `-O2` exploits it | Grep for casts, compare with `-fno-strict-aliasing`, replace with `std::memcpy` or `std::bit_cast` |
| Data race on a shared buffer or cache entry | Not a memory-addressing error; only shows under load | ThreadSanitizer under the concurrent load generator |
| Dangling `string_view` or pointer into a buffer that was **reused**, not freed (for example a pooled connection buffer) | The memory is still allocated | Poison pooled memory in debug builds; review every stored view |
| ODR violation after a header change (one object file not rebuilt) | Both definitions are valid memory | `-flto -Wodr`, a clean rebuild |

Method: reproduce under the load generator, run the suite under each tool in turn, and write the RCA with the symptom, the UB class, the tool that catches it and the design change that removes the class (values instead of views, no mutation while iterating, `memcpy` instead of punning, members initialised at declaration, sanitizers in CI).

Revisit: [Module 2.14](module-14-ub-aware-cpp.md), [Module 2.12](module-12-memory-and-ownership-design.md)

</details>

---

## Scoring

| Score | What it means | What to do next |
|---|---|---|
| 15 | Ready. | Do the teach-back in [revision.md](revision.md), then start [Module 3.01](../phase-03-os-internals/module-01-processes.md). |
| 12 to 14 | Pass, with gaps. | Re-read the modules listed under "Revisit" for every question you missed, compile and run the snippets you got wrong, then do the teach-back. |
| Below 12 | Not yet. | Find the modules where you lost two or more marks, redo their `## Lab` sections from scratch (2.03, 2.04, 2.05 and 2.07 matter most for tcpkv), then retake this quiz in three or four days. |

Record your score and the questions you missed in your teach-back journal entry.

---

Back to: [Phase 2 revision](revision.md) | [Course README](../README.md) | Next phase: [Module 3.01: Processes](../phase-03-os-internals/module-01-processes.md)
