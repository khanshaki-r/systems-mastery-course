# Phase 3 quiz: OS internals (Linux and Windows)

**Instructions**

- Closed book. No modules, no man pages, no compiler. Paper or a blank text file only.
- Time: 45 minutes.
- 15 questions, one mark each. Pass mark: **12/15**.
- Questions 1-5 test recall, 6-10 test application (predict output, spot the bug), 11-15 test reasoning (diagnose a scenario, defend a trade-off).
- Write your answer before you open the `Answer` block. Mark yourself honestly: half an answer is zero.
- All C snippets compile with `gcc -std=c11 -D_GNU_SOURCE -O2 -Wall -Wextra -Werror` on Ubuntu 24.04 (fragments marked as such compile with `-c`).

---

## Part A: recall

**Q1. What does `fork` return in the parent, in the child, and when it fails?**

<details>
<summary>Answer</summary>

In the parent it returns the child's PID (a positive number). In the child it returns 0. On failure it returns -1 in the parent and no child is created.

The code after `fork` runs in both processes, so this return value is the only way each one knows which it is. Which of the two runs first is decided by the scheduler, not by the source code.

Revisit: [Module 3.01: Processes](module-01-processes.md)

</details>

**Q2. A service stopped. The supervisor log says it exited with status 137, and the application's own log has no error line. What killed it, what most often sends that, and what is the first command you run?**

<details>
<summary>Answer</summary>

137 is 128 + 9, so the process was killed by SIGKILL. With no application log line, the usual sender is the kernel's OOM killer (the other option is an operator or a supervisor's stop timeout). First command: `dmesg` (or `journalctl -k`) and look for the OOM-kill line.

SIGKILL cannot be caught, so the program had no chance to log anything. With Linux overcommit, memory is promised at `malloc` time and only taken at first touch, so the kill can happen far from the allocation.

Revisit: [Module 3.01: Processes](module-01-processes.md), [Module 3.04: Virtual memory and paging](module-04-virtual-memory-and-paging.md)

</details>

**Q3. Name four things that all threads of one process share, and four things each thread has for itself.**

<details>
<summary>Answer</summary>

Shared: code, global variables, the heap, open file descriptors, signal handlers, the PID.
Private: the stack, the registers (including instruction and stack pointers), the thread ID (TID), the signal mask, `errno`, `thread_local` variables.

On Linux a thread is a task created by `clone` with `CLONE_VM` and `CLONE_THREAD`, so it shares the address space. That is why sharing data is free and why data races are possible.

Revisit: [Module 3.02: Threads vs processes](module-02-threads-vs-processes.md)

</details>

**Q4. A program calls `getpid()` a million times and `clock_gettime()` a million times. `strace -c` shows about a million `getpid` calls but almost no `clock_gettime`. Why?**

<details>
<summary>Answer</summary>

`clock_gettime` runs in the **vDSO**: a small page of kernel-provided code and data mapped into every process. It reads the time in user mode without executing the `syscall` instruction, so `strace` never sees it. `getpid` is a real system call that crosses into the kernel every time.

A real syscall costs tens to hundreds of nanoseconds because of the mode switch; the vDSO path costs a few to about 20 ns.

Revisit: [Module 3.07: System calls](module-07-system-calls.md)

</details>

**Q5. After a successful `CreateProcess`, which two handles must you close, and what happens if you never do? Also: what does `CreateThread` return on failure, and how is that different from `CreateFile`?**

<details>
<summary>Answer</summary>

Close `pi.hProcess` and `pi.hThread` with `CloseHandle`. If you do not, the process and thread kernel objects stay alive after the child exits (much like a zombie on Linux), and the handle count of your server grows forever.

`CreateThread` returns `NULL` on failure. `CreateFile` returns `INVALID_HANDLE_VALUE`. Checking the wrong value means a failure is never detected.

Revisit: [Module 3.13: Windows internals and the Win32 API](module-13-windows-internals-and-win32.md)

</details>

---

## Part B: apply

**Q6. Predict the output of this program (a) when run directly in a terminal with `./q6`, and (b) when run as `./q6 | cat`.**

```c
#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
    printf("A\n");
    pid_t pid = fork();
    if (pid == 0) {
        printf("C\n");
        return 0;
    }
    waitpid(pid, NULL, 0);
    printf("P\n");
    return 0;
}
```

<details>
<summary>Answer</summary>

(a) Terminal:

```text
A
C
P
```

(b) Through a pipe:

```text
A
C
A
P
```

On a terminal, stdout is line-buffered, so `A\n` is written before `fork`. Into a pipe, stdout is fully buffered, so `A\n` is still in the user-space buffer when `fork` copies the process; the child flushes `A\nC\n` when it returns from `main`, and the parent flushes `A\nP\n` after `waitpid`. The order is fixed because the parent waits before printing. The fix is `fflush(stdout)` before `fork`.

Revisit: [Module 3.01: Processes](module-01-processes.md), [Module 3.07: System calls](module-07-system-calls.md)

</details>

**Q7. The file `data.txt` contains exactly the six bytes `ABCDEF`. What does this program print?**

```c
#include <fcntl.h>
#include <stdio.h>
#include <unistd.h>

int main(void) {
    /* data.txt contains the six bytes ABCDEF */
    int a = open("data.txt", O_RDONLY | O_CLOEXEC);
    int b = dup(a);
    int c = open("data.txt", O_RDONLY | O_CLOEXEC);
    char ch;

    if (read(a, &ch, 1) == 1) putchar(ch);
    if (read(b, &ch, 1) == 1) putchar(ch);
    if (read(c, &ch, 1) == 1) putchar(ch);
    if (read(a, &ch, 1) == 1) putchar(ch);
    putchar('\n');

    close(a);
    close(b);
    close(c);
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
ABAC
```

`dup` creates a second fd that points at the **same open file description**, so `a` and `b` share one offset: `a` reads `A`, `b` reads `B`, then `a` reads `C`. The second `open` creates a **new** open file description with its own offset starting at 0, so `c` reads `A`. All three point at the same inode.

Revisit: [Module 3.08: File descriptors and the VFS](module-08-file-descriptors-and-vfs.md)

</details>

**Q8. On a terminal this program prints `loan 42 approved` and then hangs forever; `done` never appears. Find the bug and give the one-line fix.**

```c
#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
    int fds[2];
    if (pipe(fds) == -1) return 1;

    pid_t pid = fork();
    if (pid == 0) {                       /* child: the writer */
        close(fds[0]);
        const char *msg = "loan 42 approved\n";
        if (write(fds[1], msg, strlen(msg)) < 0) _exit(1);
        close(fds[1]);
        _exit(0);
    }

    /* parent: the reader */
    char buf[64];
    ssize_t n;
    while ((n = read(fds[0], buf, sizeof buf)) > 0) {
        fwrite(buf, 1, (size_t)n, stdout);
    }
    close(fds[0]);
    waitpid(pid, NULL, 0);
    puts("done");
    return 0;
}
```

<details>
<summary>Answer</summary>

The parent never closes its own copy of the write end. Fix: add `close(fds[1]);` at the start of the parent's section, before the `read` loop.

A pipe reader sees EOF (a `read` that returns 0) only when every write end in every process is closed. After `fork`, both processes hold `fds[1]`. The child closes its copy, but the parent's copy keeps the pipe "open for writing", so the parent's last `read` blocks forever, waiting for itself.

Revisit: [Module 3.10: Inter-process communication](module-10-ipc.md)

</details>

**Q9. This server is supposed to log and exit cleanly on SIGTERM. Name three problems in it and say how to fix each.**

```c
#include <signal.h>
#include <stdio.h>
#include <unistd.h>

static int running = 1;

static void on_term(int sig) {
    printf("got signal %d, shutting down\n", sig);
    running = 0;
}

int main(void) {
    signal(SIGTERM, on_term);
    while (running) {
        sleep(1);              /* stands in for "serve one request" */
    }
    puts("clean exit");
    return 0;
}
```

<details>
<summary>Answer</summary>

1. **`printf` in the handler.** It is not async-signal-safe. If the signal lands while the main code is inside `printf` or `malloc` holding a lock, the handler can deadlock or corrupt the buffer. Fix: only set the flag in the handler and log in normal code after the loop.
2. **`running` is a plain `int`.** The only type the standard guarantees for a variable written in a handler and read in normal code is `volatile sig_atomic_t` (or a lock-free atomic). With a plain `int`, the compiler may keep the value in a register when the loop body does not call out, and the loop never ends. Fix: `static volatile sig_atomic_t running = 1;`.
3. **`signal()` instead of `sigaction()`.** `signal` semantics vary between systems (one-shot handlers, system-call restart rules). Fix: install the handler with `sigaction`.

A fixed version:

```c
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static volatile sig_atomic_t running = 1;

static void on_term(int sig) {
    (void)sig;
    running = 0;               /* only async-signal-safe work here */
}

int main(void) {
    struct sigaction sa;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = on_term;
    sigemptyset(&sa.sa_mask);
    sigaction(SIGTERM, &sa, NULL);

    while (running) {
        sleep(1);
    }
    puts("got SIGTERM, clean exit");   /* logging happens in normal code */
    return 0;
}
```

In a multithreaded server, go one step further: block the signals before creating threads and read them from a `signalfd`.

Revisit: [Module 3.09: Signals](module-09-signals.md)

</details>

**Q10. This fragment is the read handler of an epoll server. The fd was registered with `EPOLLIN | EPOLLET`. Small requests work. A client that sends a 2 KB request never gets a reply. Why, and what is the fix?**

```c
#include <sys/epoll.h>
#include <sys/types.h>
#include <unistd.h>

void handle(const char *data, size_t len);

/* The fd was registered with: ev.events = EPOLLIN | EPOLLET; */
void on_readable(int fd) {
    char buf[512];
    ssize_t n = read(fd, buf, sizeof buf);
    if (n > 0) {
        handle(buf, (size_t)n);
    }
}
```

<details>
<summary>Answer</summary>

Edge-triggered epoll reports an fd only when it goes from "not ready" to "ready", that is, when **new** data arrives. The handler reads 512 bytes and stops, leaving about 1.5 KB in the socket buffer. The client is now waiting for a reply and sends nothing more, so no new edge happens and epoll never reports the fd again.

Fix: make the fd non-blocking (`O_NONBLOCK`) and read in a loop until `read` returns -1 with `errno == EAGAIN` (handle 0 as "peer closed" and retry on `EINTR`). Alternatively, use level-triggered mode, which keeps reporting the fd while data remains.

Revisit: [Module 3.11: I/O models](module-11-io-models-blocking-to-epoll.md)

</details>

---

## Part C: reason

**Q11. A nightly migration batch job processes millions of small records. Its RSS climbs to 3 GB and stays there after each batch finishes. Valgrind reports `definitely lost: 0 bytes`. Is this a leak? Explain what is happening and what you would change.**

<details>
<summary>Answer</summary>

It is not a leak; it is retained memory. `free` puts small chunks back on glibc's per-thread tcache and per-arena bins for reuse, not back to the kernel. The `brk` heap can only shrink from the top, so one live chunk near the top pins everything below it, and glibc keeps freed memory as a cache unless the top passes `M_TRIM_THRESHOLD`.

The right change is a per-batch **arena**: bump-allocate every record of the batch, then `arena_reset` in O(1) when the batch commits or fails. Memory becomes flat and reuse is exact. `malloc_trim` is only a stopgap. Mention the ownership contract: the arena owns, the caller borrows, nobody calls `free`.

Revisit: [Module 3.05: malloc internals](module-05-malloc-internals.md), [Module 3.06: Custom allocators](module-06-custom-allocators-arena-pool-slab.md)

</details>

**Q12. A long-running server starts failing new connections with `accept: Too many open files` after about a day. Restarting fixes it for another day. How do you diagnose it, what is the likely root cause, and what is the real fix?**

<details>
<summary>Answer</summary>

The error is `EMFILE`: the process hit its fd limit (`ulimit -n`, commonly 1024). Diagnose on the live process: `ls /proc/<pid>/fd | wc -l` against the limit, then `ls -l /proc/<pid>/fd` or `lsof -p <pid>` to see what the fds point at. A leak shows as hundreds of entries for the same file, socket or pipe. The leak rate is about 1024 per day, roughly one every 85 seconds, which usually matches an error path.

Root cause: an fd closed only on the success path (an early return or exception skips `close`), or children inheriting fds because `O_CLOEXEC` was not set. Real fix: own every fd in an RAII wrapper that closes on every path, open with `O_CLOEXEC`/`SOCK_CLOEXEC`, and add a load test that asserts the fd count stays flat. Raising `ulimit -n` only delays the failure.

Revisit: [Module 3.08: File descriptors and the VFS](module-08-file-descriptors-and-vfs.md)

</details>

**Q13. A thread-per-request server runs 1000 threads on an 8-core machine. CPU shows 100%, yet throughput is lower than when the same server was capped at 16 threads. Explain why. Then size a fixed pool for a workload where each request spends about 80% of its time waiting on the database and 20% computing.**

<details>
<summary>Answer</summary>

Only 8 threads can run at once. The other runnable threads wait in run queues, and the scheduler slices time among all of them. Each switch costs about 1 to 5 µs directly, plus the larger cost of refilling caches and the TLB for the next thread's working set. So a growing share of that 100% CPU is switching and cache refill, not useful work, and each request's latency is spread across many slices. Each thread also costs a stack.

Sizing: start at cores x (1 + wait/compute). Wait/compute = 80/20 = 4, so 8 x (1 + 4) = **40 threads**. Bound the queue in front of the pool, then measure throughput and p99 and adjust.

Revisit: [Module 3.03: Scheduling](module-03-scheduling.md)

</details>

**Q14. Your server writes its log to stdout, which is a pipe to a separate log-shipper process. Under load, every request thread suddenly stops, CPU drops to almost zero, but the process is alive. What happened, how do you confirm it, and how do you fix it?**

<details>
<summary>Answer</summary>

The log shipper stopped draining the pipe (for example its disk filled or it hung). The 64 KB pipe buffer filled, so every `write` to the log fd blocked in the kernel. Each request thread blocks on its next log line, so the whole pool stalls while the process looks healthy.

Confirm: `cat /proc/<pid>/stack` for the threads, or attach `gdb`, and see them sitting in a pipe write; `ls -l /proc/<pid>/fd/1` shows it is a pipe. Fix: do not let request threads block on logging. Use a dedicated logging thread with a bounded in-process queue, or make the log fd non-blocking and drop and count lines on `EAGAIN`. Raising the pipe size with `F_SETPIPE_SZ` only buys time. Pipe back-pressure is right for batch pipelines and dangerous in a latency-sensitive server.

Revisit: [Module 3.10: Inter-process communication](module-10-ipc.md)

</details>

**Q15. A teammate proposes rewriting the loan application server on io_uring "because it is faster than blocking sockets". The server handles a few thousand branch terminals, and every request makes a database call of about 5 ms. Give your answer, with reasons and the condition under which you would change your mind.**

<details>
<summary>Answer</summary>

Keep the blocking fixed thread pool. Reasons:

- **Benefit:** io_uring saves system calls per operation. That matters at hundreds of thousands of operations per second or for true asynchronous disk I/O. Here each request is dominated by a 5 ms database round trip, so the saving is noise. The real limit is database concurrency, which the pool size already controls.
- **Complexity:** a completion model means buffers must outlive operations, completions arrive out of order, and cancellation is asynchronous. The code becomes a state machine that is harder to debug from a crash dump under a support SLA.
- **Deployment:** io_uring may be missing features on older kernels or disabled by policy (Docker's default seccomp profile, `kernel.io_uring_disabled`).

Change your mind when measurement shows the syscall boundary is the bottleneck, or when idle connections grow to tens of thousands; even then, the usual first step is an epoll reactor (IOCP on Windows) for waiting plus the same worker pool for database calls.

Revisit: [Module 3.11: I/O models](module-11-io-models-blocking-to-epoll.md), [Module 3.12: io_uring and Windows IOCP](module-12-io-uring-and-iocp.md)

</details>

---

## Scoring

| Score | What it means | What to do next |
|---|---|---|
| 15/15 | Ready. | Do the [teach-it-back exercise](revision.md#teach-it-back), then start [Phase 4](../phase-04-concurrency-deep-dive/module-01-threads-in-cpp.md). |
| 12-14 | Pass, with gaps. | Revisit the modules listed under every question you missed, re-answer those questions tomorrow, then move on. |
| Below 12 | Not yet. | Find the two or three modules with the most misses and redo their labs (section 8) from scratch before retaking the quiz. |

Back to the [Phase 3 revision sheet](revision.md) or the [course README](../README.md).
