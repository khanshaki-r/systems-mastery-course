# Phase 2 revision: C++17 from zero to modern C++

Phase 2 took the C you wrote in Phase 1 and gave it a type system that enforces ownership for you. You learned that a class's destructor runs on every exit path, so RAII turns `close`, `unlock` and `free` into something the compiler cannot forget. You can write the rule-of-five members of a move-only handle, explain what `std::move` really is, and say what lives in a `shared_ptr` control block. You know how `vector`, `map`, `unordered_map` and `string` are laid out in memory, which operations invalidate which pointers, and you have measured the difference. You can choose between exceptions and error codes, between virtual dispatch and templates, and between a pattern and plain code, with a cost for each. You can find undefined behaviour that ASan misses and measure before you optimise. You ended by writing the first real tcpkv file: a line-framed protocol parser with 25 GoogleTest cases. This is the vocabulary behind claim B (C++ and systems) and the foundation of claim I (tcpkv).

Use this sheet the day before the quiz and again before any interview. Each line links to the module that teaches it in full.

## One idea per module

| Module | The one idea to remember | The command or code pattern to remember |
|---|---|---|
| [2.01 From C to C++](module-01-from-c-to-cpp.md) | `std::string` and `std::vector` free themselves; a reference is an alias with the same machine code as a pointer. | `void f(const Loan& l)`; `for (const auto& x : v)`; `g++ -std=c++17 -Wall -Wextra -Werror -g` |
| [2.02 Classes, constructors, destructors](module-02-classes-constructors-destructors.md) | Members are built in declaration order before the constructor body; destructors run in reverse; `const` member functions make `this` a `const T*`. | `explicit LoanAccount(std::string id) : id_(std::move(id)) {}`; `double rate() const;` |
| [2.03 RAII and the rule of 0/3/5](module-03-raii-and-rule-of-0-3-5.md) | Acquire in the constructor, release in the destructor; a destructor alone is not enough, because the default copy duplicates the handle. | `FileDescriptor(const FileDescriptor&) = delete;`; `std::lock_guard<std::mutex> g(m);` |
| [2.04 Move semantics](module-04-move-semantics.md) | A move steals and resets the source; `std::move` is only a cast; mark moves `noexcept`; never `return std::move(local)`. | `Fd(Fd&& o) noexcept : fd_(o.fd_) { o.fd_ = -1; }` |
| [2.05 Smart pointers and the control block](module-05-smart-pointers-and-control-block.md) | `unique_ptr` by default (8 bytes, same code as raw); `shared_ptr` is two pointers plus a control block with atomic counts; `weak_ptr` breaks cycles. | `auto p = std::make_unique<T>(...)`; `if (auto sp = weak.lock()) { ... }` |
| [2.06 Templates](module-06-templates.md) | A template is instantiated once per distinct argument set, so the definition must be in the header; constrain with `static_assert`, `if constexpr`, SFINAE. | `template <typename T> T max_of(T a, T b)`; `nm -C app \| grep max_of`; `size app` |
| [2.07 STL containers and internals](module-07-stl-containers-internals.md) | Contiguous beats pointer chasing; `vector` doubles and reallocation invalidates everything; `unordered_map` rehash invalidates iterators but not references. | `v.reserve(n)`; `auto it = m.find(k); if (it != m.end())`; copy the value out under the lock |
| [2.08 Iterators, algorithms, lambdas](module-08-iterators-algorithms-lambdas.md) | A lambda is a struct with one member per capture; capture by value for anything stored; `std::function` costs an indirect call and maybe an allocation. | `v.erase(std::remove_if(v.begin(), v.end(), pred), v.end());`; `[id, r = std::move(r)] { ... }` |
| [2.09 Exceptions vs error codes](module-09-exceptions-vs-error-codes.md) | A throw costs microseconds, a return nanoseconds; exceptions for rare events, status values on the per-request path; know the three guarantees. | `catch (const std::exception& e)`; `std::optional<T>`; copy-and-swap; top-level `catch` in every worker |
| [2.10 Inheritance and virtual dispatch](module-10-inheritance-and-virtual-dispatch.md) | A virtual call is load vptr, load slot, indirect call; polymorphic bases need a virtual destructor; passing by value slices. | `virtual ~Handler() = default;`; `void handle() override;`; `class X final` |
| [2.11 Design patterns in systems code](module-11-design-patterns-in-systems-code.md) | Patterns are shapes with costs: factory map, Command as `std::function<void()>`, dependency injection by constructor reference, Observer through `weak_ptr`. | `explicit Handler(Database& db)`; `static T& instance() { static T t; return t; }` |
| [2.12 Memory and ownership design](module-12-memory-and-ownership-design.md) | One owner per object; borrows (`T&`, `string_view`, `span`) must die before the owner; the hot path does not allocate. | Count allocations with a replaced `operator new`; `valgrind --tool=massif ./app`; reuse buffers with `clear()` |
| [2.13 Performance optimisation](module-13-performance-optimisation.md) | Measure first at `-O2`; cache lines are 64 bytes; a mispredicted branch costs about 15 to 20 cycles; Amdahl decides what is worth it. | `perf record -g ./app && perf report`; `perf stat -e cycles,instructions,cache-misses,branch-misses ./app`; `steady_clock`, median, sink |
| [2.14 UB-aware C++](module-14-ub-aware-cpp.md) | C++ adds lifetime UB, iterator invalidation, strict aliasing, data races and ODR violations; each has its own detector. | `-fsanitize=address,undefined`; `-D_GLIBCXX_DEBUG`; `std::memcpy` (or C++20 `std::bit_cast`) instead of punning; `it = m.erase(it)` |
| [2.15 C++20 essentials](module-15-cpp20-essentials.md) | Concepts, ranges, `span`, `jthread`, `format` and `<=>` are ready in GCC 13; modules and coroutine library types are not. | `template <std::integral T>`; `std::jthread t([](std::stop_token st) { ... });` |
| [2.16 Mini-project: tcpkv parser](module-16-cpp-mini-project-protocol-parser.md) | TCP is a byte stream: buffer per connection, cut at `\n`, strip `\r`; a line may be at most 4096 bytes including its `\n`, and a tail that reaches 4096 bytes with no `\n` closes the connection; the parser is a pure function. | `std::optional<Command> parse_line(std::string_view line, std::string& err);`; `cmake -S . -B build && cmake --build build && ctest` |

## Must-know for interviews

1. **Reference versus pointer.** A reference must be initialised, is never null and cannot be reseated; it compiles to the same code as a pointer. Use `const T&` to read, `T&` to modify, `T*` only when "no object" is a legal answer. [2.01](module-01-from-c-to-cpp.md)
2. **Construction and destruction order.** Members are constructed in declaration order (not initialiser-list order) before the body runs; the destructor body runs first, then members in reverse; locals die in reverse order of construction. `class` and `struct` differ only in default access. [2.02](module-02-classes-constructors-destructors.md)
3. **RAII and the rule of 0/3/5.** RAII ties a resource to an object's lifetime so release happens on every exit path, including exception unwinding. Rule of 0: let members manage themselves. Rule of 3/5: if you write a destructor, write or delete the copy (and move) operations. [2.03](module-03-raii-and-rule-of-0-3-5.md)
4. **What `std::move` is.** `static_cast<T&&>`: it moves nothing, it only makes the move constructor eligible. A moved-from object is valid but unspecified. `return T(...)` is guaranteed elision in C++17; `return std::move(local)` blocks NRVO. [2.04](module-04-move-semantics.md)
5. **Why `noexcept` on moves matters.** `std::vector` growth uses `std::move_if_noexcept`: it moves elements only if the move constructor is `noexcept` (or the type cannot be copied), otherwise it copies to keep the strong guarantee. A missing `noexcept` is a silent copy of every element. [2.04](module-04-move-semantics.md), [2.09](module-09-exceptions-vs-error-codes.md)
6. **Smart pointer layout.** `unique_ptr` is 8 bytes. `shared_ptr` is 16 bytes (object pointer, control block pointer); the control block holds a vtable pointer, an atomic strong count, an atomic weak count and the deleter or the in-place object. `make_shared` is one allocation instead of two, but the bytes stay until the weak count is zero. The counts are thread-safe; the pointee is not. [2.05](module-05-smart-pointers-and-control-block.md)
7. **Templates.** One instantiation per distinct argument set, emitted as weak symbols the linker de-duplicates; definitions must be visible in the header. SFINAE (`enable_if`) became `if constexpr` in C++17 and concepts in C++20. [2.06](module-06-templates.md), [2.15](module-15-cpp20-essentials.md)
8. **Container internals.** `vector`: three pointers, doubles (1, 2, 4, ...) in libstdc++, reallocation invalidates all iterators, pointers and references. `map`: red-black tree, about 2 log n dependent loads per lookup. `unordered_map`: prime bucket counts, rehash at load factor 1.0, rehash invalidates iterators but not references. `string`: 15 characters inline (SSO). [2.07](module-07-stl-containers-internals.md)
9. **Lambdas and `std::function`.** A lambda is a compiler-generated struct with an inlinable `operator()`, which is why `std::sort` with a lambda beats `qsort`. `std::function` is 32 bytes with a 16-byte inline buffer for small trivially copyable callables, otherwise a heap allocation, plus an indirect call. [2.08](module-08-iterators-algorithms-lambdas.md)
10. **Exception cost and rules.** Zero cost on the happy path; a throw costs microseconds (about 2,000 times a return on one laptop). An exception escaping a destructor, a `noexcept` function or a thread function calls `std::terminate`. Catch by `const&`. [2.09](module-09-exceptions-vs-error-codes.md)
11. **Virtual dispatch.** A hidden 8-byte vptr per object points to a per-class vtable; a call is two dependent loads and an indirect call, and it blocks inlining. It matters in fine-grained hot loops, not around a network request. `final` lets the compiler devirtualise. [2.10](module-10-inheritance-and-virtual-dispatch.md)
12. **Singletons and dependency injection.** A singleton is a hidden global that blocks testing and invites the static initialisation order fiasco; if forced, a function-local static is thread-safe since C++11. Prefer building objects in `main` and passing them by reference, which made the app server testable with a fake database. [2.11](module-11-design-patterns-in-systems-code.md)
13. **The `string_view` rule.** The owner must outlive every use of the view. Never store a view in a member or return one into a temporary, and never pass `.data()` to a C function (no NUL). Views are parameters; owners are members. [2.12](module-12-memory-and-ownership-design.md), [2.16](module-16-cpp-mini-project-protocol-parser.md)
14. **Measuring performance.** Never benchmark `-O0`; use `steady_clock`, warm-up, repetitions, the median and a sink so the optimiser cannot delete the loop. Amdahl: speedup = 1 / ((1 - p) + p / s). Profile with `perf record`, explain with `perf stat`. [2.13](module-13-performance-optimisation.md)
15. **What ASan misses.** Uninitialised reads (Valgrind, MSan), iterator invalidation without a free (`-D_GLIBCXX_DEBUG`), strict aliasing (no reliable tool: use `memcpy`), data races (TSan), ODR violations (`-flto -Wodr`), and views into reused rather than freed buffers. [2.14](module-14-ub-aware-cpp.md)

## Mistakes that cost marks

| Mistake | Bug it causes | What to do instead | Module |
|---|---|---|---|
| A resource wrapper with a destructor but default copy operations | Double close: the kernel reuses the descriptor number and a write goes to the wrong file, with no crash | `= delete` the copies; add `noexcept` moves that reset the source | [2.03](module-03-raii-and-rule-of-0-3-5.md) |
| Using an object after `std::move`, or writing `return std::move(local);` | Reading empty or unspecified state; blocked NRVO and an extra move | Assign to a moved-from object or leave it alone; `return local;` | [2.04](module-04-move-semantics.md) |
| Move constructor without `noexcept` | `std::vector` copies every element on growth | Mark moves and swaps `noexcept`; `static_assert(std::is_nothrow_move_constructible_v<T>)` | [2.04](module-04-move-semantics.md), [2.07](module-07-stl-containers-internals.md) |
| `shared_ptr` everywhere, or `shared_ptr<T>(this)` | Cycles that never free; a second control block and a double delete | `unique_ptr` by default; `weak_ptr` for back-references; `enable_shared_from_this` | [2.05](module-05-smart-pointers-and-control-block.md) |
| Holding an iterator, reference or view across `push_back`, a rehash, an `erase`, or after releasing a lock | Use-after-free or silently skipped elements | Re-find after modifying; copy the value out under the lock; `it = m.erase(it)` | [2.07](module-07-stl-containers-internals.md), [2.14](module-14-ub-aware-cpp.md) |
| `[&]` or bare `[this]` in a task stored for later | `stack-use-after-return` or `heap-use-after-free` in a worker thread | Capture by value, move resources in with init-capture, or `[self = shared_from_this()]` | [2.08](module-08-iterators-algorithms-lambdas.md) |
| Catching by value, throwing from a destructor, or letting an exception leave a worker thread | Sliced exceptions; `std::terminate` and the whole server dies | `catch (const T&)`; destructors never throw; top-level `catch` in every worker | [2.09](module-09-exceptions-vs-error-codes.md) |
| Polymorphic base without a virtual destructor, or passing it by value | Derived members leak on `delete`; slicing runs base code with no warning | `virtual ~Base() = default;`; pass by reference or `unique_ptr<Base>`; delete base copies | [2.10](module-10-inheritance-and-virtual-dispatch.md) |
| Benchmarking `-O0`, one run, or a loop whose result is unused | Wrong winner, or a "0 ns" result after dead-code elimination | `-O2`, repetitions, median, a sink (`volatile` or `asm volatile`) | [2.13](module-13-performance-optimisation.md) |
| Treating one `recv` as one command, or storing `string_view` in `Command` | Garbage commands across a WAN; use-after-free on the next `append` | Per-connection `LineBuffer` cut at `\n`; `Command` owns `std::string` | [2.16](module-16-cpp-mini-project-protocol-parser.md) |

## Resume lines this phase supports

| Claim | What it says | Evidence you now have (one sentence) |
|---|---|---|
| A | C++17 | I rewrote my C hash table in C++ and watched the destroy function disappear, and I can say what C++20 would change and why the project floor stays at C++17. |
| B | RAII, smart pointers, move semantics, templates, STL internals, OOP and patterns, memory and ownership design, UB-aware coding, performance | I reproduced the double-close bug with `strace`, built a move-only descriptor type, found a `shared_ptr` cycle with Valgrind, measured `vector` against `list` and `unordered_map` against `map`, counted zero allocations per request with a replaced `operator new`, and used `perf` and Amdahl before optimising. |
| E | POSIX sockets, TCP/IP | I can explain why TCP delivers bytes, not messages, and how a per-connection line buffer frames them. |
| F | ASan/TSan, memory corruption | I have read a real ASan `stack-use-after-return` report from a lambda that captured by reference, and I know which UB classes ASan cannot see and the tool for each. |
| G | CMake, GoogleTest | My parser builds with CMake and runs 25 GoogleTest cases under `ctest`. |
| H4 | Multithreaded application server, pooled request model, master-table cache | I can describe the handler interface, the factory map, Command objects queued to a pool, dependency injection with a fake database, and a cache snapshot shared as `shared_ptr<const Table>`. |
| H5 | Crash-dump debugging and RCA | I can describe a release-only, ASan-clean wrong-data bug as an RCA: symptom, UB class, the tool that would have caught it, and the design change that removes it. |
| I | tcpkv: RAII socket/fd wrappers, move-only connection handles, `shared_mutex` store, line-based protocol, GoogleTest, `-Wall -Wextra -Werror` | I wrote the RAII `FileDescriptor` and the line-protocol parser that capstone C1 uses unchanged, and I can defend `unordered_map` behind a `shared_mutex` with copy-out reads. |

## Teach it back

Answer each prompt out loud first, then in writing, in your own words, without looking at the modules. Aim for 150 to 300 words each. Write all five answers in `journal/YYYY-MM-DD-phase-2-teach-back.md` (for example `journal/2027-01-10-phase-2-teach-back.md`) and send the file for grading. A good answer covers every point in its checklist, includes at least one number or tool output from your own labs, and avoids the mistakes above.

**Prompt 1. Explain RAII to a C programmer who has never used C++, using the double-close bug as your example.**

A good answer must mention:
- The resource is acquired in the constructor and released in the destructor; the compiler inserts the destructor call on every exit path, including early returns and exception unwinding.
- In C this was `goto cleanup`; in C++ the type does it.
- A class with only a destructor still gets a compiler-written copy constructor that copies the raw descriptor.
- After a copy, the first destructor closes the descriptor, the kernel reuses the number, and the stale copy writes to or closes someone else's file, with no crash.
- Evidence: `strace` shows the reuse; deleting the copy operations turns the bug into a compile error.
- Rule of 0, 3 and 5, and that moves must reset the source.

**Prompt 2. Explain move semantics to a teammate, and why `std::vector` cares whether a move constructor is `noexcept`.**

A good answer must mention:
- Lvalues (named, still in use) versus rvalues (temporaries, or objects the owner has finished with).
- `std::move` is a cast; the move constructor does the stealing and must leave the source empty (for a descriptor, `-1`).
- A moved-from object is valid but unspecified.
- On growth, `vector` must keep the strong guarantee; it moves only if the move cannot throw (`move_if_noexcept`), otherwise it copies every element.
- C++17 guaranteed elision for `return T(...)`; NRVO for named locals; `return std::move(local)` only hurts.
- Move-only types give exactly one owner at every moment (tcpkv's connection handles).

**Prompt 3. Explain `unique_ptr`, `shared_ptr` and `weak_ptr` to a teammate, including what is inside the control block and when each one is right.**

A good answer must mention:
- `unique_ptr`: one owner, move-only, 8 bytes, same machine code as `new`/`delete`; the default.
- `shared_ptr`: 16 bytes; control block with a vtable pointer, atomic strong and weak counts, and the deleter or the in-place object.
- `make_shared` is one allocation instead of two; its memory stays until the weak count reaches zero.
- Use `shared_ptr` only when the last user is unknown at compile time (for example a cache snapshot read by many threads).
- A cycle of `shared_ptr`s leaks (Valgrind: definitely plus indirectly lost); break it with `weak_ptr` and `lock()`.
- The counts are thread-safe; the object is not. Non-owning access is a reference or raw pointer.

**Prompt 4. Design the in-memory store for tcpkv and defend every choice: container, locking, how a `GET` reads a value, ownership, and whether to put it behind a virtual `IStore` interface.**

A good answer must mention:
- `std::unordered_map<std::string, std::string>`: exact-key lookups, no range queries, O(1) average with a few cache misses; short keys fit in SSO.
- `std::shared_mutex`: `shared_lock` for `GET`, `unique_lock` for `SET` and `DEL`.
- A `GET` copies the value out while holding the shared lock, because an `erase` destroys the node and a rehash invalidates iterators; a reference held after unlocking would dangle.
- The map owns keys and values; no `shared_ptr` per value (atomic traffic per read, invisible lifetimes).
- `reserve` up front for the expected key count.
- Keep the store a concrete `final` class: one implementation on the hottest path, so no virtual calls; use a template parameter if a second implementation appears.
- Measure p50 and p99 under the load generator before and after any change.

**Prompt 5. Explain why a TCP server cannot assume that one `recv` returns one command, and how your parser handles it.**

A good answer must mention:
- TCP is a byte stream: the kernel splits and joins data freely (segment size, Nagle), so one command can arrive in several reads and several commands in one read.
- Symptom: works on localhost or a LAN, breaks over a WAN with long values.
- A per-connection `LineBuffer` appends every `recv`, emits only complete lines cut at `\n`, strips `\r`, and keeps the remainder.
- A line may be at most 4096 bytes including its `\n`; an unterminated tail that reaches 4096 bytes is rejected with `ERR line too long` and the connection closed, which bounds memory per connection.
- `parse_line` is a pure function over `std::string_view` that returns an owning `Command` or an error, so it is tested without a socket.
- Tests cover partial lines, multiple lines per chunk, byte-at-a-time input, CRLF split across reads, and both sides of the 4096-byte limit.

---

Back to: [Course README](../README.md) | Take the quiz: [Phase 2 quiz](quiz.md) | Next phase: [Module 3.01: Processes](../phase-03-os-internals/module-01-processes.md)
