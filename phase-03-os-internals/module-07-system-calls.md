# Module 3.07: System calls

**Estimated hours:** 3

**What you will learn**

1. What a system call is at the instruction level: user mode versus kernel mode, the `syscall` instruction, and which registers carry the call number and arguments.
2. How to see every system call a program makes with `strace`, and how buffering turns many `printf`s into one `write`.
3. Why a system call is expensive, how the vDSO lets some "calls" skip the kernel entirely, and why a 64 KB read beats a 1-byte read.

**Prerequisites:** [Module 3.06: Custom allocators: arena, pool, slab](module-06-custom-allocators-arena-pool-slab.md).

---

## 1. One-line intuition

A system call is the one doorway from your program into the kernel: a special instruction that switches the CPU to full privilege, runs a fixed piece of kernel code, and switches back with a result.

## 2. Real-life analogy

Return to the office building from module 0.02. You are a tenant (a user process). You cannot touch the building's wiring, the archive, or the phone lines yourself. To get anything from outside your floor you walk to the **manager's service window**, hand in a numbered request slip, and wait at the window while the manager does the work and hands back a result.

- **The service window** is the `syscall` instruction. There is exactly one window; you cannot sneak into the back office another way.
- **The numbered slip** is the system call number. "Request 1" means write, "request 0" means read, "request 2" means open. You write the number on the slip (in a register) and the arguments beneath it.
- **Walking to the window and back** takes real time even when the request is trivial. That walk is the **mode switch** between user mode and kernel mode. It is why doing a thousand tiny requests is far slower than one big request.
- Some questions are so common the manager posts the answer **on a board in the lobby** that you can read without queueing: "current time", "which page are we on". Reading the board is the **vDSO**: the kernel exposes a little read-only data and code so you get the answer without the walk to the window at all.

The whole module is this window: the slip format, the cost of the walk, and the lobby board that lets you skip it.

## 3. Why it exists: the problem it solves

From module 0.02: user programs run at CPU privilege ring 3, where the instructions that touch hardware are forbidden and the only memory they can see is their own. This isolation is what stops one buggy program from corrupting the disk, the network card, or another process. But a useful program *must* read files, send network packets, and create processes, all of which need hardware.

The system call is the controlled, auditable doorway that resolves the tension. The program cannot do the privileged work itself, so it asks the kernel to do it on its behalf, through a fixed, small set of entry points the kernel fully controls. The kernel checks every argument (is this file descriptor yours? is this address in your own memory?) before doing anything. Linux has roughly 450 system calls.

What breaks without this boundary: MS-DOS-era systems had no privilege separation, so any program could write any byte of memory or disk, and one bad pointer froze or corrupted the whole machine. The boundary is also where **cost** lives: because every trip to the kernel has overhead, the number and size of your system calls is often what determines whether a server is fast or slow. You cannot reason about I/O performance without understanding this boundary.

## 4. Three layers of depth

### Layer 1 (beginner): user mode, kernel mode, and the C library

Your CPU is always in one of two modes:

- **User mode** (ring 3 on x86-64): where your code runs. Limited instructions, only your own memory.
- **Kernel mode** (ring 0): where the kernel runs. Full power over the hardware.

A **system call** is how code in user mode asks the kernel to do something in kernel mode. The classic ones you already met: `open`, `read`, `write`, `close`, `mmap`, `fork`, `execve`, `exit`.

You almost never write a system call directly. You call a **C library function** (glibc on Linux) that wraps it. For example `printf("hello\n")` eventually calls the `write` system call to send the bytes to file descriptor 1 (the screen). `malloc` (module 3.05) calls `brk` or `mmap`. `fopen` calls `openat`. The C library is a thin, convenient layer on top of the kernel's doorway, and it often does extra work such as buffering (Layer 2) so that your many small calls become few large system calls.

A first fact to hold onto: **a function call is not a system call.** Calling `strlen` or your own function stays in user mode and costs a few nanoseconds. Calling `write` crosses into the kernel and costs far more. Telling the two apart is the point of this module.

### Layer 2 (working engineer): the calling convention, strace, and buffering

**How arguments are passed (x86-64 Linux).** A Linux system call uses a fixed register convention, different from the normal function-call convention:

| Register | Holds |
|---|---|
| `rax` | the system call **number** (e.g. 0 = read, 1 = write, 2 = open) |
| `rdi` | argument 1 |
| `rsi` | argument 2 |
| `rdx` | argument 3 |
| `r10` | argument 4 (note: ordinary function calls use `rcx` here; syscalls use `r10`) |
| `r8`  | argument 5 |
| `r9`  | argument 6 |

The program loads these registers, executes the `syscall` instruction, and the return value comes back in `rax`. A negative value in `rax` (specifically between -1 and -4095) means an error; glibc turns it into a -1 return and sets `errno` to the positive value. This is why you saw `errno=2` and `errno=13` in module 0.02.

**strace: watch every system call.** `strace` runs a program and prints every system call it makes, with arguments and results. It is one of the most useful debugging tools you will ever learn.

```bash
strace ./a.out            # print every syscall
strace -c ./a.out         # print a summary count and time per syscall
strace -f ./a.out         # follow child processes (threads, fork)
strace -e trace=write ./a.out        # only write calls
strace -e trace=openat,read,write,close ./a.out   # a chosen set
```

Run `strace` on even a trivial "hello world" and you see far more than one `write`: the kernel has to `execve` the program, `mmap` the C library and the loader, call `brk` to set up the heap, `write` your output, and `exit_group` at the end. Most of those happen before your `main` runs. This is normal and worth seeing once so it never surprises you.

**Buffering: why 100 printfs can be one write.** glibc's `stdio` (the `printf`/`fwrite` family) keeps a user-space buffer, by default about 4 KB. `printf` copies your text into that buffer and returns without calling the kernel. Only when the buffer fills, or you print a newline to a terminal (line buffering), or the program exits, does glibc issue one `write` system call for the whole buffer. So a loop of 100 small `printf`s to a file is typically a single `write` of a few KB, not 100 `write`s. This is the C library doing exactly what module 3.06 taught: batching small operations into few expensive ones. You will see this directly in the lab: `printf` in a loop produces one `write`; a raw `write` per iteration produces many.

**Three ways to send bytes to the screen, from slowest kernel-trips to fewest:**

- `printf` / `fwrite`: buffered. Many calls, few `write` syscalls.
- `write(1, buf, n)`: the glibc wrapper, one syscall per call, no buffering.
- `syscall(SYS_write, 1, buf, n)`: the raw system call with no wrapper at all, same cost as `write` but bypassing even glibc's thin wrapper.

### Layer 3 (internals): the mode switch, its cost, and the vDSO

**What the `syscall` instruction actually does.** On x86-64 the `syscall` instruction is a single hardware instruction that:

1. Saves the current instruction pointer (`rip`) into `rcx` and flags into `r11`.
2. Loads a kernel-defined entry address from a special register (`MSR_LSTAR`) into `rip`, and switches the CPU to ring 0.
3. The kernel's entry code switches to the kernel stack, saves the user registers, reads the call number from `rax`, looks it up in the **system call table**, and calls the matching kernel function.
4. On return, the kernel restores the user registers and executes `sysret`, which switches back to ring 3 and jumps back to the saved `rip`.

This is the "walk to the window and back". Even with no actual work, the switch itself costs time: saving and restoring registers, switching stacks, and (since the Spectre/Meltdown mitigations) possibly flushing CPU state and page-table isolation. A bare system call on current hardware and a 6.x kernel typically costs on the order of **tens to a few hundred nanoseconds**, before the real work (reading a disk block, copying bytes) is even counted. The exact figure varies a lot by CPU and by which mitigations are enabled; measure, do not quote.

**Why a 1-byte read is slow and a 64 KB read is fast.** Suppose you read a 1 MB file. With a 1-byte buffer you make about 1,000,000 `read` system calls, paying the mode-switch cost a million times. With a 64 KB buffer you make about 16 `read` calls. The bytes copied are the same; the number of kernel trips differs by a factor of ~65,000. This is why every buffered reader, every network server, reads in chunks of kilobytes, and why glibc's `stdio` buffers at all. In the lab you will time both and see the difference directly.

**The vDSO: calls that never enter the kernel.** Some system calls only *read* kernel data that changes slowly, such as the current time. Paying a full mode switch for `gettimeofday` or `clock_gettime` millions of times would be wasteful. So the kernel maps a tiny shared page, the **vDSO** (virtual dynamic shared object), into every process. It contains a little code and a little read-only data (like the current time, updated by the kernel). glibc's `clock_gettime` and `gettimeofday` run that vDSO code **entirely in user mode**, reading the time from the shared page with no `syscall` instruction at all. The result is roughly an order of magnitude faster: a vDSO `clock_gettime` is on the order of **a few to ~20 nanoseconds**, versus tens to hundreds for a real system call like `getpid`. You can see the vDSO mapped in `/proc/self/maps` as `[vdso]`. This is why, in the lab, `clock_gettime` in a tight loop is much faster than `getpid`, even though both look like "calls" in your C code.

**Windows, in brief.** Windows has the same boundary. User code calls a Win32 function like `WriteFile` in `kernel32.dll`, which calls a stub in `ntdll.dll` such as `NtWriteFile`. That stub loads a service number and executes the `syscall` instruction into the Windows kernel's System Service Dispatch Table. The structure is the same (a number, a register convention, a mode switch); the names differ. Windows also has its own user-mode shortcut for time via `KeQuerySystemTime` data in the shared user page (`KUSER_SHARED_DATA`), analogous to the vDSO. WinDbg and tools like Process Monitor are the Windows equivalents of `strace`.

## 5. Architecture diagram

```mermaid
sequenceDiagram
    participant App as "Your code (user mode, ring 3)"
    participant Libc as "glibc wrapper"
    participant CPU as "CPU"
    participant Kern as "Kernel (ring 0)"
    App->>Libc: printf("hi") or write(1, buf, n)
    Note over Libc: printf buffers; write does not
    Libc->>CPU: set rax=1 (write), rdi=1, rsi=buf, rdx=n; `syscall`
    CPU->>Kern: switch to ring 0, jump to entry (MSR_LSTAR)
    Note over Kern: look up syscall 1 in the table, check args, copy bytes to the device
    Kern-->>CPU: result in rax; `sysret`
    CPU-->>Libc: back in ring 3
    Libc-->>App: return value (or -1 and errno)
    Note over App,Kern: clock_gettime via vDSO reads a shared page in user mode: NO switch
```

The one costly crossing is the `syscall`/`sysret` pair. The vDSO path avoids it entirely.

## 6. Code

This program sends the same text to standard output three ways and uses `getpid` and `clock_gettime` in a loop so you can time a real system call against a vDSO call. It is C because this is OS-level work.

```c
/* syscall_demo.c
 * Three ways to write bytes, plus a timing of getpid (real syscall) vs
 * clock_gettime (vDSO, no kernel entry).
 * Build: gcc -std=gnu17 -Wall -Wextra -Werror -g -o syscall_demo syscall_demo.c
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <unistd.h>         /* write, getpid */
#include <sys/syscall.h>    /* SYS_write, SYS_getpid */
#include <time.h>           /* clock_gettime */
#include <string.h>

static double now_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec * 1e9 + ts.tv_nsec;
}

int main(void) {
    const char *msg = "hello from three layers\n";
    size_t len = strlen(msg);

    /* 1. Buffered: printf copies to glibc's buffer; the kernel sees it later. */
    printf("1: %s", msg);

    /* 2. The glibc write() wrapper: one `write` syscall, no buffering. */
    write(STDOUT_FILENO, "2: ", 3);
    write(STDOUT_FILENO, msg, len);

    /* 3. The raw syscall with no wrapper at all. Same cost as write(). */
    const char *p3 = "3: ";
    syscall(SYS_write, STDOUT_FILENO, p3, (size_t)3);
    syscall(SYS_write, STDOUT_FILENO, msg, len);

    /* Make sure the buffered line is flushed before timing output below. */
    fflush(stdout);

    /* Time a real syscall vs a vDSO call. Use the raw syscall for getpid so
     * glibc cannot cache it. */
    enum { N = 1000000 };
    volatile long sink = 0;

    double t0 = now_ns();
    for (int i = 0; i < N; ++i) sink += syscall(SYS_getpid);   /* real syscall */
    double t1 = now_ns();

    struct timespec ts;
    double t2 = now_ns();
    for (int i = 0; i < N; ++i) { clock_gettime(CLOCK_MONOTONIC, &ts); sink += ts.tv_nsec; }
    double t3 = now_ns();

    (void)sink;
    printf("getpid()      : %.1f ns per call (real syscall, kernel entry)\n",
           (t1 - t0) / N);
    printf("clock_gettime : %.1f ns per call (vDSO, usually no kernel entry)\n",
           (t3 - t2) / N);
    return 0;
}
```

Compile and run:

```bash
gcc -std=gnu17 -Wall -Wextra -Werror -g -o syscall_demo syscall_demo.c
./syscall_demo
```

Expected output (the two timings vary a lot by CPU and kernel mitigations; the *ordering* is the point, and `getpid` should be clearly slower than `clock_gettime`):

```text
1: hello from three layers
2: hello from three layers
3: hello from three layers
getpid()      : 180.4 ns per call (real syscall, kernel entry)
clock_gettime : 18.7 ns per call (vDSO, usually no kernel entry)
```

Here `getpid` is about ten times slower than `clock_gettime`, because `getpid` makes a real kernel crossing every call while `clock_gettime` reads the vDSO page in user mode. On your machine the numbers differ; record your own. (Note: glibc may cache `getpid` for the wrapper, which is why the program uses `syscall(SYS_getpid)` to force a real crossing every time.)

### Seeing the syscalls with strace

```bash
strace -c ./syscall_demo
```

Expected: a summary table. You should see `write` called a handful of times (your three output groups plus the two timing-result lines), one `execve`, some `mmap`/`brk` for startup, and `exit_group`. Crucially, `getpid` appears with a count of **1000000** calls and a large share of the time, while `clock_gettime` does **not** appear at all (or appears a tiny number of times), because the vDSO path never enters the kernel. That absence is the vDSO made visible.

Now watch buffering:

```bash
# printf in a loop, redirected to a file (full buffering, not line buffering):
printf 'int main(void){for(int i=0;i<1000;i++)printf("x");return 0;}' > buftest.c
gcc -std=gnu17 -Wall -Wextra -Werror -o buftest buftest.c
strace -e trace=write ./buftest > /dev/null
```

Expected: a **single** `write` of about 1000 bytes, not 1000 writes, because glibc buffered all 1000 `printf("x")` calls and flushed once at exit.

## 7. Use case: core-banking loan-origination platform

The tcpkv server (capstone C1) and the application server (claim H4) both read a line-based protocol over TCP. The first working version did the obvious thing: read one byte at a time until it saw a newline, so it could stop exactly at the end of each command.

Under `strace -f -e trace=recvfrom` on a load test, each command of, say, 40 bytes showed **40 `recvfrom` system calls**, one per byte. At tens of thousands of commands per second across hundreds of connections, the server was spending most of its CPU not on the key-value logic but on mode switches: the "walk to the window" from Layer 3, millions of times a second. CPU sat high, throughput sat low, and a flame graph (Phase 8) showed the time inside the kernel's syscall entry path.

**The decision this drove:** switch to a **buffered reader**. Each connection reads up to 64 KB per `recv` into a per-connection buffer, then the line parser scans that buffer in user space, with no system call per byte. A 40-byte command now costs a fraction of one `recv` (several commands often arrive in a single kernel read). `strace` after the change showed one `recvfrom` serving many commands, CPU dropped sharply, and throughput rose. This is the exact same lesson as glibc's `stdio` buffering (Layer 2) and the 1-byte-vs-64 KB read (Layer 3), applied to a socket. In the resume defence for tcpkv, this is the concrete "I reduced syscall overhead with buffered reads, measured with strace" story, with the before/after `recvfrom` counts you record in the lab and capstone journal.

## 8. Lab

You have Ubuntu 24.04 in WSL2 with gcc and strace. Record numbers for your journal.

### Part A: three ways to write, seen under strace (20 minutes)

1. Build and run `syscall_demo.c` from section 6. Confirm all three lines print.
2. Run `strace -e trace=write ./syscall_demo`. Count the `write` calls. Note that `printf`'s output and the raw `syscall(SYS_write, ...)` both show up as the same `write` syscall in the trace: from the kernel's side there is no difference between the glibc wrapper and the raw call.
3. Run `strace -c ./syscall_demo` and read the summary. Find `getpid` with a count near 1,000,000. Confirm `clock_gettime` is absent or near zero.

Expected: `getpid` dominates the syscall count; `clock_gettime` is invisible to `strace` because of the vDSO.

### Part B: time a real syscall vs the vDSO (15 minutes)

1. Run `./syscall_demo` three times and record the two per-call timings each run.
2. Confirm `getpid` is several times slower than `clock_gettime`. Write the ratio.
3. Look at the vDSO mapping: `cat /proc/self/maps | grep vdso`. You will see a line ending in `[vdso]`: the shared page that makes `clock_gettime` fast.

Expected: `getpid` on the order of tens to a few hundred ns; `clock_gettime` on the order of a few to ~20 ns. Your numbers will differ; the ordering will not.

### Part C: 1-byte read vs 64 KB read (25 minutes)

Create a 1 MB file and read it two ways, timing each and counting syscalls.

```bash
head -c 1048576 /dev/urandom > big.bin
```

Write `readbench.c` that reads `big.bin` into a buffer in a loop, once with a 1-byte buffer and once with a 65536-byte buffer, timing each with `clock_gettime`. Open the file twice (or `lseek` back to 0 between runs). Then:

```bash
gcc -std=gnu17 -O2 -Wall -Wextra -Werror -o readbench readbench.c
./readbench
strace -c -e trace=read ./readbench
```

Expected: the 1-byte version makes about 1,048,576 `read` calls and is dramatically slower; the 64 KB version makes about 16 `read` calls and is far faster. The `strace -c` summary shows the `read` count difference starkly. Record both times and both counts. This is the single most important performance lesson about system calls.

### Part D: ltrace for library calls (15 minutes)

`strace` shows system calls; `ltrace` shows **library** calls (the glibc functions before they reach the kernel).

1. Run `ltrace ./syscall_demo` (install with `sudo apt-get install ltrace` if needed). You will see `printf`, `write`, `strlen`, `clock_gettime` as *library* calls. Note that `printf` appears here but, under `strace`, only its resulting `write` appears: `ltrace` sees the library layer, `strace` sees the kernel layer.
2. Run `ltrace -c ./syscall_demo` for a per-function summary.

Expected: `ltrace` and `strace` show two different layers of the same program. Understanding which tool shows which layer is the point.

### Journal

Copy [TEMPLATE.md](../journal/TEMPLATE.md) to `journal/YYYY-MM-DD-system-calls.md`. Record: the `write` and `getpid` counts from Part A; the `getpid` vs `clock_gettime` timings and ratio from Part B; the read times and `read` counts for 1-byte vs 64 KB from Part C; and one sentence on the difference between what `strace` and `ltrace` show. End by connecting Part C to the tcpkv buffered-read decision in section 7.

## 9. Common mistakes and misconceptions

| Mistake | Why it is wrong | Bug it causes later |
|---|---|---|
| "A function call and a system call cost the same" | A function call stays in user mode (~ns); a syscall crosses to the kernel (tens-hundreds of ns) | I/O code that calls the kernel per byte and is mysteriously slow |
| "`printf` writes to the screen immediately" | It buffers in user space and flushes later (or on newline to a terminal) | Output appearing out of order with `write`, or lost output on a crash before flush |
| "Reading 1 byte at a time is fine, the OS caches it" | The page cache helps, but you still pay a mode switch per `read` call | Servers spending all CPU in syscall entry instead of logic |
| "`clock_gettime` is a system call like any other" | It usually runs in the vDSO entirely in user mode | Misjudging timing overhead; being surprised it is absent from `strace` |
| "strace shows everything my program does" | It shows system calls only, not library or user-mode work | Looking for `printf` in strace and not finding it |
| "The syscall register convention is the same as function calls" | Syscalls use `r10` for arg 4, not `rcx`; number is in `rax` | Confusion when reading disassembly or writing raw syscalls |
| "Fewer, bigger syscalls and more, smaller syscalls are equivalent" | Each call has fixed overhead; batching wins | Un-buffered I/O that does not scale under load |

## 10. Resume link

- **Claim H4 / Claim I (tcpkv), "multithreaded application server ... over RPC-over-TCP" and "line-based text protocol".** The section 7 story is the headline: "I found with `strace` that the first version did one `recv` per byte, which is one kernel crossing per byte; I switched to 64 KB buffered reads and the syscall count per command dropped from dozens to a fraction of one, measured before and after." That is a specific, measured decision driven by syscall cost.
- **Claim G, "Linux ... Windows".** You can explain the boundary on both: `syscall` into `MSR_LSTAR` on Linux, `ntdll` stubs into the SSDT on Windows, and the vDSO / `KUSER_SHARED_DATA` shortcuts for time on each.
- **Claim F, "debugging".** `strace -c`, `strace -f -e trace=...` and `ltrace` are first-line tools for "why is this process slow or stuck?": the summary tells you where the kernel time goes, and following a trace shows exactly which call blocks or errors.

Likely follow-up: "Roughly how expensive is a system call, and why?" Answer: tens to a few hundred nanoseconds on current hardware and a 6.x kernel, because of the mode switch, register save/restore, stack switch, and post-Spectre/Meltdown mitigations, all before any real work; which is why efficient I/O batches into large reads and writes and why the vDSO exists for cheap read-only calls like time.

## 11. Interview questions

**Q1 (easy). What is a system call and how does it differ from an ordinary function call?**

<details>
<summary>Model answer</summary>

A system call is the controlled entry point from user mode into the kernel, used whenever a program needs the kernel to do something privileged such as I/O, memory mapping, or process creation. It is triggered by a special instruction (`syscall` on x86-64) that switches the CPU to kernel mode (ring 0), runs kernel code, and switches back. An ordinary function call stays entirely in user mode, just jumping within the process, and costs a few nanoseconds. A system call costs much more (tens to hundreds of ns) because of the mode switch and register save/restore, even before the real work.

</details>

**Q2 (easy). Why does a loop of `printf` calls often result in only one `write` system call?**

<details>
<summary>Model answer</summary>

Because glibc's `stdio` buffers output in a user-space buffer (about 4 KB by default). `printf` copies your text into that buffer and returns without calling the kernel. The buffer is flushed with a single `write` system call only when it fills, when a newline is printed to a terminal (line buffering), or when the program exits. So many small `printf`s become few large `write`s, which is much cheaper because it pays the syscall cost once instead of per call. You can confirm this with `strace -e trace=write`.

</details>

**Q3 (medium). What is the vDSO and why does it make `clock_gettime` faster than `getpid`?**

<details>
<summary>Model answer</summary>

The vDSO (virtual dynamic shared object) is a small page of code and read-only data the kernel maps into every process. For calls that only read slowly-changing kernel data, such as the current time, glibc runs code from the vDSO entirely in user mode, reading the value (for example the current time, which the kernel keeps updated in that page) without executing the `syscall` instruction. So `clock_gettime` usually does no kernel crossing and costs only a few to ~20 nanoseconds, while `getpid` is a real system call that crosses into the kernel every time and costs tens to hundreds of nanoseconds. Under `strace`, `getpid` appears but `clock_gettime` does not, because the latter never enters the kernel.

</details>

**Q4 (medium). You are reading a 1 MB file. Why is reading it with a 64 KB buffer so much faster than with a 1-byte buffer, even though both read the same bytes?**

<details>
<summary>Model answer</summary>

Each `read` is a system call with fixed overhead: the mode switch into the kernel and back, independent of how many bytes you ask for. A 1-byte buffer forces about a million `read` calls, paying that overhead a million times. A 64 KB buffer needs only about sixteen `read` calls. The total bytes copied are the same, but the number of expensive kernel crossings differs by a factor of tens of thousands, so the small-buffer version spends almost all its time in syscall overhead. This is why buffered readers and network servers always read in kilobyte-sized chunks, and it is exactly the optimisation I applied to the tcpkv protocol reader.

</details>

**Q5 (hard). Walk through, at the register and CPU level, what happens when a C program calls `write(1, buf, 5)` on x86-64 Linux.**

<details>
<summary>Model answer</summary>

glibc's `write` wrapper loads the registers per the syscall convention: `rax` = 1 (the number for `write`), `rdi` = 1 (the file descriptor), `rsi` = the address of `buf`, `rdx` = 5 (the count). It then executes the `syscall` instruction. The CPU saves the user `rip` into `rcx` and the flags into `r11`, loads the kernel entry address from the `MSR_LSTAR` register into `rip`, and switches to ring 0. The kernel entry code switches to the kernel stack, saves the user registers, reads `rax`, indexes the system call table to find `sys_write`, and calls it. `sys_write` validates that fd 1 is a valid open descriptor for this process and that `buf`..`buf+5` lies in the process's own readable memory, then copies the five bytes to the file or device behind fd 1. It puts the number of bytes written (or a negative error code) in `rax`, restores the user registers, and executes `sysret`, which switches back to ring 3 and resumes at the saved `rip`. Back in user mode, glibc checks `rax`: if it is between -1 and -4095 it sets `errno` to the negated value and returns -1, otherwise it returns the byte count. The costly part is the `syscall`/`sysret` crossing plus register and stack handling, which is why batching writes matters.

</details>

## 12. Revision

- A system call is the one doorway from user mode (ring 3) to kernel mode (ring 0): load the number into `rax` and args into `rdi`/`rsi`/`rdx`/`r10`/`r8`/`r9`, execute `syscall`, get the result in `rax`; it costs tens to hundreds of ns because of the mode switch.
- glibc wraps syscalls and buffers `stdio`, so many `printf`s become one `write`; `strace` shows system calls, `ltrace` shows library calls, and `strace -c` summarises where kernel time goes.
- The vDSO runs cheap read-only calls like `clock_gettime` in user mode with no kernel crossing (a few to ~20 ns), and reading in large chunks (64 KB) instead of 1 byte cuts the number of expensive syscalls by tens of thousands, which is why servers use buffered reads.

---

Previous: [Module 3.06: Custom allocators: arena, pool, slab](module-06-custom-allocators-arena-pool-slab.md) | Next: [Module 3.08: File descriptors and the VFS](module-08-file-descriptors-and-vfs.md)
