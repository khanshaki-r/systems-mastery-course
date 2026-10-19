# Phase 1 revision: C from zero to systems level

Phase 1 turned you from someone who had never written code into someone who can write, build, debug and reason about systems-level C. You know what `gcc` really does (four stages, then a loader at run time), how numbers live in memory as bytes with a type, and why signed overflow, out-of-bounds access and use-after-free are undefined behaviour that an optimiser will exploit. You can draw a process's memory map, place a crash address on it, and classify the bug before reading a line of code. You decode packed binary records byte by byte instead of casting buffers, you give every heap block exactly one documented owner, and you clean up with `goto cleanup`. You finished by building a hash map and a record parser that pass their tests with Valgrind reporting `All heap blocks were freed`. That is the exact skill set behind the migration-engine claims (H1, H2) and the crash-dump claims (F, H5).

Use this sheet the day before the quiz and again before any interview. Each line links to the module that teaches it in full.

## One idea per module

| Module | The one idea to remember | The command or code pattern to remember |
|---|---|---|
| [1.01 First C program](module-01-first-c-program.md) | `gcc` translates once (preprocess, compile, assemble, link); the kernel runs the file as a process; `main`'s return becomes `$?` (0 to 255). | `gcc -std=c17 -Wall -Wextra -Werror -g -o hello hello.c && ./hello; echo $?` |
| [1.02 Variables, types, memory](module-02-variables-types-and-memory.md) | A variable is bytes plus a type; two's complement; unsigned wraps, signed overflow is UB; x86-64 is little-endian; money is `int64_t` paise. | `#include <stdint.h>`; `int64_t principal_paise;`; `INT_MAX` is 2,147,483,647 |
| [1.03 Control flow](module-03-control-flow.md) | Every decision is a compare plus a jump; `&&` and `\|\|` stop early; `case` labels fall through unless you `break`. | `if (count > 0 && total / count > limit)`; `/* fall through */` plus `-Wimplicit-fallthrough` |
| [1.04 Functions and the call stack](module-04-functions-and-the-call-stack.md) | Each call pushes a frame (return address, saved `rbp`, locals) at a lower address; arguments are copies; the main stack is typically 8 MB. | `ulimit -c unlimited`; `gdb -q ./prog core`; `bt`, `info frame` |
| [1.05 Pointers](module-05-pointers.md) | A pointer is a typed address; `p + 1` moves `sizeof(*p)` bytes; out-parameters return several values; `const T *` promises read-only. | `int f(const T *in, T *out)` returns a status; `ASAN_OPTIONS=detect_stack_use_after_return=1` |
| [1.06 Arrays and strings](module-06-arrays-and-strings.md) | Arrays store no length and decay to a pointer when passed; a C string ends in a NUL; fixed-width fields are not strings. | `snprintf(buf, sizeof buf, "%s", src)`; `memcpy(b, field, 6); b[6] = '\0';` |
| [1.07 Structs, unions, packed layouts](module-07-structs-unions-packed-layouts.md) | The compiler pads for alignment (24 bytes can become 16 by reordering largest-first); anything leaving the process gets an explicit byte layout. | `offsetof`; `get_u32_le(p)` = `p[0] \| p[1] << 8 \| ...`; never `fwrite(&rec, ...)` or a cast of the buffer |
| [1.08 Dynamic memory](module-08-dynamic-memory.md) | Heap memory lives until you `free` it; one owner per block; grow by doubling; `realloc` into a temporary. | `tmp = realloc(p, n); if (tmp == NULL) { ... } p = tmp;`; `valgrind --leak-check=full ./prog` |
| [1.09 File I/O and binary files](module-09-file-io-and-binary-files.md) | Record `n` is at byte `n * size`; binary mode always; loop on the read's result; `fflush` reaches the kernel, `fsync` reaches the disk. | `fopen(path, "rb")`; `fseek(f, n * REC_SIZE, SEEK_SET)`; `while (fread(buf, 1, REC_SIZE, f) == REC_SIZE)` |
| [1.10 Process memory layout](module-10-process-memory-layout.md) | Text, rodata, data, bss, heap, mmap regions, stack; the region a fault address lands in names the bug class. | `cat /proc/<pid>/maps`; `size ./prog`; `grep -E 'VmSize\|VmRSS' /proc/<pid>/status` |
| [1.11 Undefined behaviour](module-11-undefined-behaviour.md) | UB means no requirements; the compiler assumes it never happens and deletes checks built on it. | `-fsanitize=address,undefined`; check before the operation, not after |
| [1.12 Preprocessor, compiler, linker](module-12-preprocessor-compiler-linker.md) | Objects have defined (`T`) and undefined (`U`) symbols; the linker matches them; libraries go after objects; shared libraries are found again at run time. | `gcc -E/-S/-c`; `nm -C main.o`; `ldd ./app`; `gcc main.o -L. -lloan -o app` |
| [1.13 Multi-file programs and Make](module-13-multi-file-programs-and-make.md) | Declarations in guarded headers, each definition in exactly one `.c`; `static` hides helpers; Make rebuilds only what changed. | `#ifndef LOAN_H`; `extern int loans_priced;`; `CFLAGS := ... -MMD -MP` and `-include $(DEPS)` |
| [1.14 Error handling and ownership](module-14-error-handling-and-ownership-in-c.md) | Status codes, `errno` read immediately after a failure, `goto cleanup` with `NULL`-initialised resources, and OWNED or BORROWED on every pointer. | `goto cleanup;` ... `cleanup: free(b); if (f) fclose(f); return status;` |
| [1.15 Mini-project: hash map and parser](module-15-c-mini-project-hash-map-and-parser.md) | A chaining hash map (FNV-1a, resize at load factor 0.75) whose header states who owns keys and values; records decoded byte by byte. | `make test` prints `ALL TESTS PASSED`; Valgrind prints `All heap blocks were freed` and `0 errors` |

## Must-know for interviews

1. **What `gcc main.c` does.** Preprocess (`-E`, one translation unit), compile (`-S`, assembly), assemble (`-c`, object file with symbols and relocations), link (resolve every undefined symbol, add start-up code that calls `main`). "Undefined reference" is always the linker. [1.12](module-12-preprocessor-compiler-linker.md)
2. **Integer facts.** `INT_MAX` is 2,147,483,647. -1 in 32 bits is `0xFFFFFFFF`. Unsigned arithmetic wraps by definition; signed overflow is undefined. `-1 > 1u` is true because the signed side is converted to unsigned. [1.02](module-02-variables-types-and-memory.md)
3. **Money is never a `double`.** 0.1 + 0.2 is 0.30000000000000004, so two systems disagree. Store `int64_t` paise and round in one documented place. [1.02](module-02-variables-types-and-memory.md)
4. **Endianness.** x86-64 stores the low byte first. Network order and byte-compared keys (Berkeley DB B-tree) need big-endian, or 256 sorts before 1. [1.02](module-02-variables-types-and-memory.md), [1.07](module-07-structs-unions-packed-layouts.md)
5. **Lost output before a crash.** stdout is line-buffered on a terminal and fully buffered to a file or pipe; a crash loses the buffer. Use `\n`, `fflush`, or stderr; trust the core dump over the log. [1.01](module-01-first-c-program.md)
6. **Three crash fingerprints.** Null dereference: short backtrace, fault address 0 or a small offset. Stack overflow: huge repetitive backtrace, `rsp` just below the `[stack]` mapping. Heap corruption: crash inside `malloc` or `free`, far from the cause. [1.04](module-04-functions-and-the-call-stack.md), [1.05](module-05-pointers.md), [1.08](module-08-dynamic-memory.md)
7. **`sizeof` versus `strlen`.** `sizeof` of an array is its bytes where it is declared, but 8 (a pointer) inside a function it was passed to. `strlen` counts characters before the NUL. `strncpy` may leave no NUL; `snprintf` always terminates and reports truncation. [1.06](module-06-arrays-and-strings.md)
8. **Struct padding.** `uint8_t, uint32_t, uint8_t, int64_t` is 14 data bytes but `sizeof` is 24; ordering largest-first makes it 16. A packed struct still has the wrong byte order and misaligned members. [1.07](module-07-structs-unions-packed-layouts.md)
9. **Which tool catches which bug.** Valgrind: leaks and uninitialised reads. ASan: out-of-bounds, use-after-free, double free, stack-use-after-return. UBSan: signed overflow, bad shifts, misalignment. TSan: data races. Nothing reliable catches strict-aliasing violations; use `memcpy` or byte-wise decoding. [1.08](module-08-dynamic-memory.md), [1.11](module-11-undefined-behaviour.md)
10. **`fflush` versus `fsync`.** `fflush` moves bytes from the C library buffer into the kernel page cache (survives a process crash). `fsync` makes the kernel write them to the device and waits (survives a power cut). Databases `fsync` the log before saying "committed". [1.09](module-09-file-io-and-binary-files.md)
11. **Where memory comes from.** Small `malloc` blocks come from `[heap]` grown with `brk`; blocks of 128 KB and up get their own `mmap` region. A zeroed global goes to bss and costs nothing in the file. `VmRSS` is resident memory, `VmSize` is only mapped. [1.10](module-10-process-memory-layout.md)
12. **How UB deletes code.** `x + 1 > x` folds to true because overflow "cannot happen"; a null check after a dereference is removed. The 2009 Linux kernel bug (CVE-2009-1897) was the second one. [1.11](module-11-undefined-behaviour.md)
13. **`-g` is free at run time.** It adds DWARF sections that are never loaded. Production is built `-O2 -g` (often with `-fno-omit-frame-pointer`) so dumps have line numbers. [1.12](module-12-preprocessor-compiler-linker.md), [1.04](module-04-functions-and-the-call-stack.md)
14. **`errno` rules and ownership words.** Read `errno` only after a call reports failure, and save it before calling anything else. Every pointer in an API is OWNED (caller frees exactly once) or BORROWED (never free, valid until a stated event). Berkeley DB's `DB->get` result is borrowed until the next call on the handle. [1.14](module-14-error-handling-and-ownership-in-c.md), [1.13](module-13-multi-file-programs-and-make.md)
15. **Hash map numbers.** Average O(1) lookup, worst case O(N) when every key collides; resize by doubling at load factor 0.75 so each insert is amortised O(1). [1.15](module-15-c-mini-project-hash-map-and-parser.md), [1.08](module-08-dynamic-memory.md)

## Mistakes that cost marks

| Mistake | Bug it causes | What to do instead | Module |
|---|---|---|---|
| Building without `-Wall -Wextra -Werror`, or ignoring a warning | Format mismatches, signed/unsigned compares and fall-throughs reach production | Treat every warning as an error from the first commit | [1.01](module-01-first-c-program.md), [1.12](module-12-preprocessor-compiler-linker.md) |
| `for (i = 0; i <= n; i++)` over `n` elements | Reads or writes one past the end: a buffer overflow | Write the first and last index; `0..n-1` needs `<` | [1.03](module-03-control-flow.md), [1.06](module-06-arrays-and-strings.md) |
| Returning or storing the address of a local | Dangling pointer that "works" until the next call reuses the frame | Caller owns the buffer and passes its address, or the callee allocates and documents who frees | [1.04](module-04-functions-and-the-call-stack.md), [1.05](module-05-pointers.md) |
| `strcpy`, `strncpy`, or passing a fixed-width field to `%s` | Overflow, missing NUL, over-read into the next field | `snprintf`; `memcpy` a known width and add the NUL yourself | [1.06](module-06-arrays-and-strings.md) |
| Casting a byte buffer to a struct pointer, or `fwrite(&struct)` | Wrong offsets (padding), `SIGBUS` on strict CPUs, wrong values at `-O2` (aliasing) | Documented offsets and byte-wise `get_*_le` helpers | [1.07](module-07-structs-unions-packed-layouts.md), [1.11](module-11-undefined-behaviour.md) |
| `p = realloc(p, n)` | If it fails you lose the only pointer: a leak exactly when memory is short | Assign to a temporary, check for `NULL`, then replace | [1.08](module-08-dynamic-memory.md) |
| `while (!feof(f))`, or opening a record file without `b` | One extra iteration on stale data; records shifted on Windows by CRLF translation | Loop on the read's return value; always `"rb"` / `"wb"` | [1.09](module-09-file-io-and-binary-files.md) |
| Checking for overflow after the operation (`if (a + b < a)`) | The optimiser deletes the check because signed overflow "never happens" | Check against the limits first, or use `__builtin_add_overflow`; test under UBSan | [1.02](module-02-variables-types-and-memory.md), [1.11](module-11-undefined-behaviour.md) |
| Defining a variable in a header, or putting `-lname` before the objects | `multiple definition` or `undefined reference` at link time | `extern` declaration in the header, one definition in a `.c`; libraries last on the link line | [1.12](module-12-preprocessor-compiler-linker.md), [1.13](module-13-multi-file-programs-and-make.md) |
| Early `return` in a function that holds resources, or reading `errno` late | Leaks only on error paths; the wrong reason in the log and the RCA | Single exit with `goto cleanup`; save `errno` immediately | [1.14](module-14-error-handling-and-ownership-in-c.md) |

## Resume lines this phase supports

| Claim | What it says | Evidence you now have (one sentence) |
|---|---|---|
| A | C | I can explain each `gcc` stage, I built a multi-file C program with a Makefile, and I wrote a hash map and record parser that pass their tests Valgrind-clean. |
| B | Memory and ownership design; UB-aware coding; performance | I shrank a struct from 24 to 16 bytes by reordering, I have watched `-O2` delete an overflow check, and I state OWNED or BORROWED on every pointer in my headers. |
| D | Berkeley DB | I have written the `db_create`, `open`, `put`, `get`, `close` lifecycle, linked with `-ldb`, and know that `get` returns a borrowed pointer and that keys compare as raw bytes. |
| F | Core dumps, GDB, Valgrind, ASan, memory corruption | I produced a core dump of a stack overflow and read it with `gdb`, found a stack-use-after-return with ASan, and read Valgrind reports for a leak, a double free and an uninitialised read. |
| G | Linux, GCC/Clang | I can read `nm`, `ldd`, `size` and `/proc/<pid>/maps`, and explain link-time versus run-time library search. |
| H1 | C migration engine: arena allocator, ownership contracts, restartable leak-free batches | I can explain one owner per block, `goto cleanup`, why a per-batch arena makes leaks within a batch structurally impossible, and how Valgrind becomes a CI gate. |
| H2 | Decoding packed key/record layouts and composite keys | I decoded fixed-width little-endian records by offset with byte-wise helpers and explicit NUL terminators, never by casting the buffer. |
| H3 | Data-parity suite | I can explain why byte-for-byte parity needs integer money, and how a fixed-size binary snapshot lets you `fseek` straight to a mismatched record. |
| H4 | In-memory master-table cache | I built a hash map with O(1) average lookups and can explain the load factor and resize cost. |
| H5 | Crash-dump debugging and RCA | I place the faulting address and instruction pointer on the memory map first, which tells me null pointer, heap bug, stack exhaustion or wild write before I read code. |
| I | Clean under `-Wall -Wextra -Werror` | Every lab in this phase built with those flags; I can name a bug class each flag catches. |

## Teach it back

Answer each prompt out loud first, then in writing, in your own words, without looking at the modules. Aim for 150 to 300 words each. Write all five answers in `journal/YYYY-MM-DD-phase-1-teach-back.md` (for example `journal/2026-11-20-phase-1-teach-back.md`) and send the file for grading. A good answer covers every point in its checklist, includes at least one number or real tool output from your labs, and avoids the mistakes above.

**Prompt 1. Explain to a non-programmer what a pointer is, and why a dangling pointer is so dangerous.**

A good answer must mention:
- Memory is a row of numbered boxes; a pointer is a box that holds another box's number (an address), not the value itself.
- `&x` gives the address; `*p` uses the thing at the address; the type says how many bytes to read and how far `p + 1` moves.
- `NULL` means "points at nothing"; using it crashes at a small address, at the exact line.
- A dangling pointer holds the address of something that has died (a returned function's local, a freed block).
- The memory is reused, so the bug often "works" in tests and fails later, far from the cause.
- How it is caught: ASan (`stack-use-after-return`, `heap-use-after-free`), and how it is prevented: a named owner that outlives every use.

**Prompt 2. Walk through what happens from typing `gcc -o app main.c loan.c -ldb` to `main` running.**

A good answer must mention:
- Preprocessing pastes headers and expands macros into one translation unit per `.c` file.
- Compilation to assembly, then assembly to object files with defined and undefined symbols.
- The linker matches every undefined symbol to a definition; order matters (libraries after objects); `undefined reference` and `multiple definition` are linker errors.
- `-ldb` is a shared library: the executable only records that it needs it.
- At run time the loader (`ld-linux`) finds and maps the shared libraries (`ldd` shows them), then start-up code `_start` calls `main`.
- `main`'s return value becomes the exit code in `$?`.

**Prompt 3. A Berkeley DB cursor hands you a 32-byte packed loan record as a `void *` and a length. Explain how you decode it safely so it gives the same answer on any compiler and CPU.**

A good answer must mention:
- The layout is documented in one header: offset, width and byte order of every field.
- Check the length first (`len >= REC_SIZE`).
- Never cast the buffer to a struct pointer: padding makes the offsets wrong, the address may be misaligned, and it breaks strict aliasing.
- Integers are assembled from bytes with shifts (`get_u32_le`, `get_i64_le`); money is `int64_t` paise.
- Fixed-width text is copied with `memcpy` into a buffer one byte longer and NUL-terminated by hand.
- The data pointer is borrowed: copy what you need before the next cursor call.
- Proof: unit tests on hand-built bytes, runs under ASan, UBSan and Valgrind.

**Prompt 4. Explain what undefined behaviour is and why a program can give a different answer at `-O2` than at `-O0`.**

A good answer must mention:
- UB means the C standard places no requirements on what happens; crashing is only one possible outcome.
- The optimiser assumes UB never happens and uses that as a fact.
- Example: an overflow guard like `if (next < count)` after `next = count + 1` is deleted at `-O2`; a null check after a dereference is deleted.
- At `-O0` the code mirrors the source, so the hardware's "natural" result shows through; at `-O2` it does not.
- Common kinds: out-of-bounds, use-after-free, uninitialised reads, signed overflow, bad shifts, aliasing casts, data races.
- Tools and rules: UBSan, ASan, Valgrind, TSan; check before the operation; decode bytes instead of casting; `-Wall -Wextra -Werror`.

**Prompt 5. A long-running C service grows by about 1 MB per hour, and only when requests fail. Explain how you find the leak, fix it, and design C APIs so the bug class cannot come back.**

A good answer must mention:
- Confirm it is a leak: watch RSS over time and correlate the growth with error-log lines.
- Reproduce the error path under `valgrind --leak-check=full` (or ASan's leak checker); read the allocation stack of the "definitely lost" blocks.
- Typical cause: an early `return` on an error path that skips a `free` or `fclose`, or unclear ownership when a call fails.
- Fix: single exit with `goto cleanup`, every resource initialised to `NULL`, released in reverse order, and the pointer set to `NULL` after handing it to the caller.
- Prevention: OWNED or BORROWED in every header, `warn_unused_result` on fallible functions, a test for each error path, a CI job that fails on any leak.
- For batch work: allocate from an arena and release the whole batch with one reset.

---

Back to: [Course README](../README.md) | Take the quiz: [Phase 1 quiz](quiz.md) | Next phase: [Module 2.01: From C to C++](../phase-02-cpp17-from-zero-to-modern/module-01-from-c-to-cpp.md)
