# Phase 1 quiz: C from zero to systems level

## Instructions

- **Closed book.** No modules, no notes, no search, no AI, and do not compile the code until you have written your answer.
- **Time: 45 minutes.** Set a timer before you start.
- **Pass mark: 12 out of 15.** Each question is worth 1 mark. A question with several parts needs every part right unless it says otherwise.
- Write all your answers first (on paper or in a scratch file). Only then open the `<details>` blocks and mark yourself honestly.
- Questions get harder as you go: 1 to 5 are recall, 6 to 10 are apply (predict output, spot the bug), 11 to 15 are reasoning.
- Every program here was compiled with GCC 13 on Ubuntu 24.04 (x86-64) and its output checked. Unless a question says otherwise, assume `gcc -std=c17 -Wall -Wextra -Werror -g`.
- After marking, you may compile any snippet in WSL to see the answer for yourself.

---

## Part A: recall

**Q1. Name the four stages `gcc` runs to turn `main.c` into an executable, the `gcc` flag that stops after each of the first three, and what file each stage produces. Which stage prints "undefined reference to `foo`"?**

<details>
<summary>Answer</summary>

| Stage | Flag to stop after it | Output |
|---|---|---|
| Preprocess (expand `#include`, `#define`) | `-E` | one translation unit of pure C (`main.i`) |
| Compile | `-S` | assembly text (`main.s`) |
| Assemble | `-c` | object file with symbols and relocations (`main.o`) |
| Link | (none: the default) | executable |

"Undefined reference" comes from the **linker**: some object uses a symbol (`U` in `nm`) that no object or library on the link line defines.

Revisit: [Module 1.01](module-01-first-c-program.md), [Module 1.12](module-12-preprocessor-compiler-linker.md)

</details>

**Q2. (a) What is `INT_MAX` for a 32-bit `int`? (b) How is -1 stored in a 32-bit `int`, in hex? (c) What happens when you add 1 to an `int` holding `INT_MAX`? (d) What is `0u - 1` for a 32-bit `unsigned int`?**

<details>
<summary>Answer</summary>

(a) 2,147,483,647.
(b) `0xFFFFFFFF` (two's complement: all bits set).
(c) **Undefined behaviour.** The hardware would produce the bit pattern `0x80000000` (-2,147,483,648), but the C standard places no requirement on the result, and the optimiser may assume it never happens.
(d) 4,294,967,295 (`UINT_MAX`). Unsigned arithmetic wraps by definition; it is not UB.

Revisit: [Module 1.02](module-02-variables-types-and-memory.md)

</details>

**Q3. For each item, name the region of a Linux process's memory where it lives: (a) the machine code of `main`; (b) the string literal `"MUM01"`; (c) `int counter = 5;` at file scope; (d) `static char buf[1 << 20];` with no initialiser; (e) a local `int i` inside a function; (f) the block returned by `malloc(64)`; (g) the block returned by `malloc(1 << 20)`.**

<details>
<summary>Answer</summary>

(a) **text** (read and execute).
(b) **rodata** (read-only; writing to it gives `SIGSEGV`).
(c) **data** (initialised globals, stored in the file).
(d) **bss** (zero-initialised; only its size is stored in the file, the kernel zero-fills it on demand).
(e) **stack** (in the current function's frame).
(f) **heap** (`[heap]`, grown with `brk`, for small blocks).
(g) a separate anonymous **mmap** region: glibc serves requests of 128 KB and up with their own mapping, so 1 MiB is not in `[heap]`.

Revisit: [Module 1.10](module-10-process-memory-layout.md)

</details>

**Q4. Name the tool you reach for first for each bug: (a) a memory leak; (b) use-after-free; (c) signed integer overflow; (d) reading an uninitialised variable; (e) a data race between two threads; (f) a write one past the end of a heap array.**

<details>
<summary>Answer</summary>

(a) Valgrind `--leak-check=full` (or ASan's LeakSanitizer).
(b) AddressSanitizer (`-fsanitize=address`).
(c) UBSan (`-fsanitize=undefined`).
(d) Valgrind memcheck (UBSan and ASan do not catch it; Clang's MemorySanitizer does).
(e) ThreadSanitizer (`-fsanitize=thread`).
(f) AddressSanitizer (Valgrind also reports `Invalid write of size 4`).

The point an interviewer wants: no single tool catches everything. UBSan does arithmetic, ASan does memory addressing, Valgrind does leaks and uninitialised values, TSan does races.

Revisit: [Module 1.08](module-08-dynamic-memory.md), [Module 1.11](module-11-undefined-behaviour.md)

</details>

**Q5. A program writes an audit line with `fprintf` and then the process crashes. In a second case, the machine loses power right after `fflush`. Explain what `fflush` and `fsync` each do and which one would have saved the line in each case.**

<details>
<summary>Answer</summary>

`fprintf` only copies into the C library's user-space buffer. `fflush` moves the buffered bytes into the kernel (the page cache) with a `write` system call. `fsync` tells the kernel to write the file's data to the physical device and waits until it is done.

- **Process crash:** the user-space buffer dies with the process. `fflush` after the line would have saved it, because the kernel still holds the bytes after the process dies.
- **Power cut:** the page cache is RAM and is lost too. Only `fsync` (after the `fflush`) would have saved it.

This is why databases `fsync` the write-ahead log before acknowledging a commit.

Revisit: [Module 1.09](module-09-file-io-and-binary-files.md)

</details>

---

## Part B: apply

**Q6. Predict the exact output.**

```c
#include <stdio.h>

int main(void) {
    const char codes[] = "ALXM";
    int late = 0, active = 0, other = 0;

    for (int i = 0; codes[i] != '\0'; i++) {
        switch (codes[i]) {
        case 'L':
            late++;
            /* fall through */
        case 'A':
            active++;
            break;
        case 'X':
            break;              /* leaves the switch, not the loop */
        default:
            other++;
        }
    }
    printf("late=%d active=%d other=%d\n", late, active, other);
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
late=1 active=2 other=1
```

`'A'` adds 1 to `active`. `'L'` adds 1 to `late` and then **falls through** into `case 'A'`, adding another 1 to `active`. `'X'` hits `break`, which leaves only the `switch`; the loop carries on. `'M'` matches no case and goes to `default`. The `/* fall through */` comment tells `-Wimplicit-fallthrough` (part of `-Wextra`) that the fall-through is intended; without it this file would not compile under `-Werror`.

Revisit: [Module 1.03](module-03-control-flow.md)

</details>

**Q7. This file is compiled with `gcc -std=c17 -Wall -Wextra -g -o q7 q7.c` (no `-Werror`). The compiler prints one warning. Name the warning, then predict the four lines of output.**

```c
#include <stdio.h>

int main(void) {
    int balance = -1;
    unsigned int limit = 1;

    if (balance > limit) {
        printf("A: -1 is bigger\n");
    } else {
        printf("A: -1 is smaller\n");
    }
    printf("B: %u\n", (unsigned int)balance);
    printf("C: %d\n", (int)3.99);
    printf("D: %d\n", 7 / 2);
    return 0;
}
```

<details>
<summary>Answer</summary>

The warning is `-Wsign-compare`: "comparison of integer expressions of different signedness: 'int' and 'unsigned int'", on the `if` line.

```text
A: -1 is bigger
B: 4294967295
C: 3
D: 3
```

In `balance > limit`, the `int` is converted to `unsigned int`, so -1 becomes 4,294,967,295, which is bigger than 1. Line B prints that same bit pattern as unsigned. Casting a `double` to `int` truncates toward zero (3, not 4), and integer division also truncates (7 / 2 is 3). With `-Werror` this file would not build, which is exactly why you build that way.

Revisit: [Module 1.02](module-02-variables-types-and-memory.md)

</details>

**Q8. Predict the exact output (x86-64 Linux).**

```c
#include <stdio.h>
#include <string.h>

static size_t size_inside(const char *s) {
    return sizeof s;
}

int main(void) {
    char branch[8] = "MUM01";
    int emi[4] = {10, 20, 30, 40};
    int *p = emi;

    printf("%zu %zu %zu\n", sizeof branch, strlen(branch), size_inside(branch));
    printf("%d %d\n", *(p + 2), p[3]);
    printf("%td\n", (char *)(p + 3) - (char *)p);
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
8 5 8
30 40
12
```

`sizeof branch` is the 8 bytes the array owns; `strlen` counts the 5 characters before the NUL. When `branch` is passed to `size_inside`, it **decays** to a pointer, and `sizeof s` is the size of a pointer: 8 on x86-64. `p + 2` moves by two `int`s, so `*(p + 2)` is 30, and `p[3]` means `*(p + 3)`, which is 40. In bytes, `p + 3` is 3 × 4 = 12 bytes past `p`.

Revisit: [Module 1.05](module-05-pointers.md), [Module 1.06](module-06-arrays-and-strings.md)

</details>

**Q9. Predict the exact output (x86-64 Linux).**

```c
#include <stdio.h>
#include <stdint.h>
#include <stddef.h>

struct loan_a {
    uint8_t  status;
    uint32_t rate_bp;
    uint8_t  tenure;
    int64_t  principal_paise;
};

struct loan_b {
    int64_t  principal_paise;
    uint32_t rate_bp;
    uint8_t  status;
    uint8_t  tenure;
};

int main(void) {
    printf("%zu %zu\n", sizeof(struct loan_a), sizeof(struct loan_b));
    printf("%zu %zu\n", offsetof(struct loan_a, rate_bp),
           offsetof(struct loan_a, principal_paise));
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
24 16
4 16
```

Both structs hold 14 bytes of data. In `loan_a`, `rate_bp` must start at a multiple of 4, so 3 padding bytes follow `status` (offset 4). `tenure` sits at 8, and `principal_paise` must start at a multiple of 8, so 7 padding bytes follow (offset 16); total 24. In `loan_b`, largest-first order leaves only 2 bytes of tail padding to round 14 up to 16. This is why you never `fwrite` a struct or cast a record buffer to one: the in-memory layout is not the file layout.

Revisit: [Module 1.07](module-07-structs-unions-packed-layouts.md)

</details>

**Q10. Spot the bugs.**

Part 1. Both `loan.c` and `main.c` include this header. Each file compiles, but the link fails with `multiple definition of 'loans_priced'`. Why does the header guard not prevent this, and what is the fix?

```c
/* loan.h */
#ifndef LOAN_H
#define LOAN_H

int loans_priced = 0;

void price_loan(void);

#endif
```

Part 2. After the fix, a teammate packs `loan.o` into `libloan.a` and links with `gcc -L. -lloan main.o -o app`. The linker reports `undefined reference to 'price_loan'`. Why, and what is the correct command?

<details>
<summary>Answer</summary>

**Part 1.** The guard only stops the header being pasted twice **into the same translation unit**. `loan.c` and `main.c` are two separate translation units, so each gets its own copy of `int loans_priced = 0;`, which is a **definition**. Two definitions of one external name means the linker cannot choose. Fix: put only a declaration in the header and the one definition in one `.c` file.

```c
/* loan.h */
extern int loans_priced;   /* declaration: no storage */

/* loan.c */
int loans_priced = 0;      /* the one definition */
```

**Part 2.** The linker reads the command line left to right and only pulls members out of a library to satisfy symbols that are **already undefined** when it reaches that library. At `-lloan` nothing needs `price_loan` yet, so nothing is taken; then `main.o` adds the undefined symbol and nothing is left to satisfy it. Correct: objects first, libraries after:

```bash
gcc main.o -L. -lloan -o app
```

Revisit: [Module 1.12](module-12-preprocessor-compiler-linker.md), [Module 1.13](module-13-multi-file-programs-and-make.md)

</details>

---

## Part C: reason

**Q11. Three core dumps, all with `SIGSEGV`. Classify each one and say what you check next.**

(a) Backtrace of 4 frames. Faulting address `0x18`. The faulting instruction is a store through `rax`, and `rax` is 0.
(b) Backtrace of about 170,000 frames, all `walk_branch_tree`. `rsp` is just below the lowest address of the `[stack]` line in the memory map.
(c) Instruction pointer inside libc's `memcpy`. The faulting address is just past the end of an anonymous `rw-p` mapping of about 8 MB.

<details>
<summary>Answer</summary>

(a) **Null pointer dereference**: a struct pointer that was null, plus a field at offset 0x18 (24 bytes in). Next: find which pointer in that frame is null and which member sits at offset 24, then why it was null (never set, freed, or an unchecked lookup).

(b) **Stack overflow** from runaway recursion: the repetitive backtrace and `rsp` just under the stack mapping (into the guard area) are the fingerprints. Next: why the recursion did not stop (a cycle in the data, a missing base case, or simply too deep for the 8 MB stack); fix with a depth limit or an explicit loop.

(c) **Overrun by `memcpy`**: the crash is in a library routine, so the real culprit is the caller. An 8 MB anonymous mapping is a large `malloc` served by `mmap` (or a thread stack). A fault just past its end means the copy length was larger than the block. Next: `bt` to find our caller, check the length argument against the block's allocated size, and reproduce under ASan, which names the exact overflowing access.

The method: place the fault address and instruction pointer on the memory map **before** reading code.

Revisit: [Module 1.04](module-04-functions-and-the-call-stack.md), [Module 1.10](module-10-process-memory-layout.md)

</details>

**Q12. This function is meant to refuse to overflow. Called with `INT_MAX`, the program printed the first result at `-O0` and the second at `-O2`. Explain the difference, and write a guard that works at every optimisation level.**

```c
int add_one(int count) {
    int next = count + 1;
    if (next < count) {             /* intended overflow guard */
        handle_overflow();
        return count;
    }
    return next;
}
```

```text
-O0:  guard fired: yes, r = 2147483647
-O2:  guard fired: no, r = -2147483648
```

<details>
<summary>Answer</summary>

`count + 1` with `count == INT_MAX` is **signed overflow, which is undefined behaviour**. At `-O0` the code follows the source line by line, the hardware add wraps to `INT_MIN`, and the comparison happens to catch it. At `-O2` the optimiser reasons: "signed overflow never happens, so `count + 1` is always greater than `count`, so `next < count` is always false", and deletes the guard. The overflow then goes through unchecked.

A correct guard checks **before** the operation, so no overflow ever happens:

```c
if (count == INT_MAX) {          /* or, for general a + b: b > 0 && a > INT_MAX - b */
    handle_overflow();
    return count;
}
return count + 1;
```

`__builtin_add_overflow(a, b, &result)` also works. Building the tests with `-fsanitize=undefined` reports the original overflow at its exact line.

Revisit: [Module 1.02](module-02-variables-types-and-memory.md), [Module 1.11](module-11-undefined-behaviour.md)

</details>

**Q13. A Berkeley DB cursor returns a packed 19-byte loan record as `data` and `len`. A colleague writes the code below. It "works" in testing, prints wrong amounts for some records in the `-O2` build, and crashes with `SIGBUS` on a new ARM server. The in-memory `struct loan_record` is 24 bytes and the record's `principal_paise` is at byte offset 11. List every problem and describe the correct code.**

```c
struct loan_record *r = (struct loan_record *)data;
printf("%lld\n", (long long)r->principal_paise);
```

<details>
<summary>Answer</summary>

Four problems:

1. **Layout.** The struct has padding, so the compiler reads `principal_paise` at its own offset (16 in a 24-byte struct), not at byte 11 of the record. The value is whatever bytes happen to be there.
2. **Alignment.** `data` points anywhere in a byte buffer. An 8-byte load from an address that is not a multiple of 8 is tolerated (slowly) by x86 but faults with `SIGBUS` on strict CPUs.
3. **Strict aliasing.** Reading bytes through an `int64_t` lvalue that were not written as one is undefined behaviour; at `-O2` the optimiser may reorder or drop the load, which is why the debug build hides it.
4. **No length check.** If `len < 19`, the read runs past the buffer.

Correct code: check `len >= 19` first; decode each field from its documented offset with a byte-wise helper, for example `principal = get_i64_le((const unsigned char *)data + 11);`, which assembles the value from bytes with shifts (always aligned, never aliased, byte order stated); copy fixed-width text with `memcpy` and add the NUL yourself. Also copy what you need before the next cursor call, because `data` is borrowed. Run the decoder over the whole source under ASan and UBSan, and let the parity suite compare decoded values.

Revisit: [Module 1.07](module-07-structs-unions-packed-layouts.md), [Module 1.11](module-11-undefined-behaviour.md), [Module 1.15](module-15-c-mini-project-hash-map-and-parser.md)

</details>

**Q14. A binary file of fixed-size records, written by a Linux tool, is read correctly by the Linux build of a reader. The Windows build of the same reader decodes the first record correctly and garbage from the second onwards. The reader uses `fopen(path, "r")` and `fread`. Explain exactly what happens at the byte level, the fix, and how you would prove the fix.**

<details>
<summary>Answer</summary>

On Windows, `"r"` opens the file in **text mode**. The C runtime then translates on read: every `0D 0A` pair (`\r\n`) becomes a single `0A`, and a `1A` byte is treated as end of file. A record file holds arbitrary bytes, so somewhere a little-endian integer contains `0D` followed by `0A`; the runtime deletes the `0D`, and from that point every later byte arrives one position early. Each following record is decoded from a shifted window, so every field is wrong. On Linux, text and binary mode are identical, which is why the bug never showed there.

Fix: open with `"rb"` (and write with `"wb"`), which turns off translation on every platform.

Proof: check that the file size equals record count times record size; hex-dump the first few records (`xxd`) and check a known field, such as a loan id at a known offset, decodes identically on both platforms; and assert that every `fread` returned exactly the record size, so a shifted or short file fails loudly instead of producing garbage.

Revisit: [Module 1.09](module-09-file-io-and-binary-files.md)

</details>

**Q15. This loader leaks under error conditions. (a) Say exactly what leaks on each failing path. (b) Rewrite it with the `goto cleanup` pattern. (c) Say how you would prove the fix in CI.**

```c
int load_branch(const char *path, struct branch **out) {
    unsigned char raw[BRANCH_REC_SIZE];
    FILE *f = fopen(path, "rb");
    if (f == NULL) return -1;
    struct branch *b = malloc(sizeof *b);
    if (b == NULL) return -1;
    if (fread(raw, 1, sizeof raw, f) != sizeof raw) return -1;
    if (branch_decode(raw, b) != 0) return -1;
    fclose(f);
    *out = b;
    return 0;
}
```

<details>
<summary>Answer</summary>

(a) `fopen` fails: nothing to leak. `malloc` fails: the open `FILE` (and its descriptor) leaks. `fread` is short (for example a truncated file) or `branch_decode` fails: both `b` and the `FILE` leak. In a long-running service each failed request leaks one block and one descriptor, ending in out-of-memory or "Too many open files".

(b)

```c
int load_branch(const char *path, struct branch **out) {
    int            status = -1;
    FILE          *f = NULL;
    struct branch *b = NULL;
    unsigned char  raw[BRANCH_REC_SIZE];

    f = fopen(path, "rb");
    if (f == NULL) goto cleanup;
    b = malloc(sizeof *b);
    if (b == NULL) goto cleanup;
    if (fread(raw, 1, sizeof raw, f) != sizeof raw) goto cleanup;
    if (branch_decode(raw, b) != 0) goto cleanup;

    *out = b;       /* ownership moves to the caller */
    b = NULL;       /* so cleanup does not free it */
    status = 0;

cleanup:
    free(b);        /* free(NULL) is a no-op */
    if (f != NULL) fclose(f);
    return status;
}
```

Every resource starts as `NULL`, there is one exit, cleanup releases in reverse order, and `*out` is left untouched on failure. The header should say: on success the caller OWNS `*out` and must free it.

(c) Write a test for each failure path (missing file, truncated file, bad record), run the tests under `valgrind --leak-check=full --error-exitcode=1 --track-fds=yes` (or ASan's leak checker), and make CI fail on any lost block and on any open descriptor beyond the three standard ones. On the original code, a truncated file shows one block "definitely lost" and `Open file descriptor 3` at exit; the fixed version shows `All heap blocks were freed` and only the standard descriptors. Mark the function `__attribute__((warn_unused_result))` so callers cannot ignore its status.

Revisit: [Module 1.14](module-14-error-handling-and-ownership-in-c.md), [Module 1.08](module-08-dynamic-memory.md)

</details>

---

## Scoring

| Score | What it means | What to do next |
|---|---|---|
| 15 | Ready. | Do the teach-back in [revision.md](revision.md), then start [Module 2.01](../phase-02-cpp17-from-zero-to-modern/module-01-from-c-to-cpp.md). |
| 12 to 14 | Pass, with gaps. | Re-read the modules listed under "Revisit" for every question you missed, compile and run the snippets you got wrong, then do the teach-back. |
| Below 12 | Not yet. | Find the modules where you lost two or more marks, redo their `## Lab` sections from scratch (especially 1.05, 1.07, 1.08 and 1.11 if they appear), then retake this quiz in three or four days. |

Record your score and the questions you missed in your teach-back journal entry.

---

Back to: [Phase 1 revision](revision.md) | [Course README](../README.md) | Next phase: [Module 2.01: From C to C++](../phase-02-cpp17-from-zero-to-modern/module-01-from-c-to-cpp.md)
