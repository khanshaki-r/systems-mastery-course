# Phase 3 revision: OS internals (Linux and Windows)

Phase 3 took you under your own programs. You now know how the kernel creates a process (`fork`, `exec`, `wait`), what a thread really is (a task that shares an address space), how the scheduler shares the cores, how virtual memory and page faults work, what `malloc` does with your bytes, and why an arena allocator fixes "RSS that never drops". You crossed the system-call boundary with `strace`, learned the three-level file descriptor model, built a clean signal-driven shutdown, used pipes, shared memory and Unix sockets, and compared blocking I/O, epoll, io_uring and IOCP. On the Windows side you met handles, `CreateProcess`, reserve versus commit, the CRT flavours and the path from an access violation to a `.dmp` file. Every later phase stands on this: the thread pool in Phase 4, the servers in Phase 5, the buffer pool in Phase 6 and every crash dump in Phase 8.

## The phase on one page

| Module | The one idea to remember | The command or code pattern to remember |
|---|---|---|
| [3.01 Processes](module-01-processes.md) | `fork` copies the process, `exec` replaces the program, `wait` collects the status; a signal death shows as 128 + signal. | `pid = fork(); if (pid == 0) { execvp(...); _exit(127); } waitpid(pid, &st, 0);` then `WIFEXITED`/`WEXITSTATUS`, `WIFSIGNALED`/`WTERMSIG` |
| [3.02 Threads vs processes](module-02-threads-vs-processes.md) | A thread is a kernel task made by `clone` with `CLONE_VM` and `CLONE_THREAD`; it owns only its stack, registers, TID, signal mask and TLS. | `ps -L -p <pid>`, `ls /proc/<pid>/task`, `top -H` |
| [3.03 Scheduling](module-03-scheduling.md) | A context switch costs about 1 to 5 µs directly plus cache and TLB refill; CPU-bound throughput plateaus at the core count. | `perf stat -e context-switches,cpu-migrations ./prog`, `taskset -c 0 ./prog`, `grep ctxt /proc/<pid>/status` |
| [3.04 Virtual memory and paging](module-04-virtual-memory-and-paging.md) | Pages are mapped lazily on first touch; a segfault is "no VMA" (`SEGV_MAPERR`) or "wrong permission" (`SEGV_ACCERR`). | `cat /proc/<pid>/maps`, `grep Vm /proc/<pid>/status`, `dmesg \| grep -i oom` |
| [3.05 malloc internals](module-05-malloc-internals.md) | `free` returns small chunks to glibc's bins, not to the OS; blocks of 128 KB and up come from `mmap` and do go back. | `strace -e trace=brk,mmap ./prog` |
| [3.06 Custom allocators](module-06-custom-allocators-arena-pool-slab.md) | Match the allocator to the lifetime: an arena for build-and-discard batches, a pool for many objects of one size. | `p = arena_alloc(a, n);` ... `arena_reset(a);` on success and on failure; never `free` an arena pointer |
| [3.07 System calls](module-07-system-calls.md) | A syscall crosses from ring 3 to ring 0 and costs tens to hundreds of ns, so batch your I/O. | `strace -c ./prog`, `strace -f -e trace=read,write ./prog`, `ltrace ./prog` |
| [3.08 File descriptors and the VFS](module-08-file-descriptors-and-vfs.md) | fd table, then open file description (offset, flags), then inode; `dup` and `fork` share the offset, a second `open` does not. | `open(path, O_RDONLY \| O_CLOEXEC)`, `ls -l /proc/<pid>/fd`, `lsof -p <pid>` |
| [3.09 Signals](module-09-signals.md) | A handler may only call async-signal-safe functions; better still, block the signals and read them from a `signalfd`. | `pthread_sigmask(SIG_BLOCK, &set, NULL)` before creating threads, then `signalfd(-1, &set, SFD_CLOEXEC)`; `signal(SIGPIPE, SIG_IGN)` |
| [3.10 Inter-process communication](module-10-ipc.md) | A pipe is a one-way byte stream; the reader sees EOF only when every write end in every process is closed. | `pipe(fds); fork();` then close the end you do not use; `shm_open` + `mmap` for shared memory |
| [3.11 I/O models](module-11-io-models-blocking-to-epoll.md) | A blocked thread uses 0% CPU; epoll returns only ready fds; edge-triggered means "read until `EAGAIN`". | `epoll_create1(EPOLL_CLOEXEC)`, `epoll_ctl(ep, EPOLL_CTL_ADD, fd, &ev)`, `epoll_wait(ep, evs, n, -1)` |
| [3.12 io_uring and IOCP](module-12-io-uring-and-iocp.md) | epoll is readiness ("you may read now"); io_uring and IOCP are completion ("I read it for you"); buffers must outlive the operation. | `CreateIoCompletionPort`, `GetQueuedCompletionStatus`; io_uring SQE/CQE pairs matched by `user_data` |
| [3.13 Windows internals and Win32](module-13-windows-internals-and-win32.md) | Everything is a kernel object behind a reference-counted handle; no `fork`; commit is charged up front, no overcommit. | `CreateProcess(...)` then `CloseHandle(pi.hProcess); CloseHandle(pi.hThread);`, `GetLastError()` immediately, WinDbg `!analyze -v` |

## Must-know for interviews

1. **`fork` returns twice.** The parent gets the child's PID, the child gets 0, and on failure the parent gets -1 and no child exists. `exec` never returns on success. ([3.01](module-01-processes.md))
2. **Exit status numbers.** A shell reports a signal death as 128 + signal: 139 is SIGSEGV, 134 is SIGABRT, 137 is SIGKILL (often the OOM killer, so check `dmesg`), 143 is SIGTERM. The raw `waitpid` status for `exit(1)` is 256, so always decode it with the `W*` macros. ([3.01](module-01-processes.md), [3.04](module-04-virtual-memory-and-paging.md))
3. **Thread stacks.** A Linux thread gets 8 MB of virtual stack by default with a guard page below; a Windows thread reserves 1 MB. A crash only in pool threads often means stack overflow on a smaller stack. ([3.02](module-02-threads-vs-processes.md), [3.13](module-13-windows-internals-and-win32.md))
4. **Context switch cost.** About 1 to 5 µs directly, plus the hidden cost of refilling caches and the TLB. Linux used CFS until 6.5 and EEVDF from 6.6; `nice` is a weight, not an on/off switch. Size a pool at about cores x (1 + wait time / compute time). ([3.03](module-03-scheduling.md))
5. **Paging.** 4 KB pages, a 4-level page table, and the TLB caching translations. A minor fault fixes a mapping without disk I/O (microseconds); a major fault reads from disk or swap. `fork` shares pages copy-on-write. 2 MB huge pages cut TLB misses. ([3.04](module-04-virtual-memory-and-paging.md))
6. **`malloc(1 GB)` is fast** because `mmap` only records the region. VSZ grows at once, RSS grows as pages are written. With Linux overcommit the OOM killer may strike at first touch; Windows refuses at commit time instead. ([3.04](module-04-virtual-memory-and-paging.md), [3.13](module-13-windows-internals-and-win32.md))
7. **glibc numbers.** Blocks of 128 KB or more (`M_MMAP_THRESHOLD`, adjusted dynamically up to 32 MB) use `mmap` and are unmapped on `free`. Smaller ones come from the `brk` heap. The minimum chunk is 32 bytes, 16-byte aligned, and tcache keeps 7 chunks per size per thread with no lock. ([3.05](module-05-malloc-internals.md))
8. **Arena contract.** The arena owns every object, the caller borrows, pointers are valid until reset or destroy, and the caller never calls `free`. Reset on both success and failure makes a batch restartable and leak-free. Poison reset memory so ASan can still see use-after-reset. ([3.06](module-06-custom-allocators-arena-pool-slab.md))
9. **Syscall cost and the vDSO.** A syscall costs tens to hundreds of ns. `clock_gettime` usually runs in the vDSO in user mode (a few to about 20 ns) and does not appear in `strace`. Reading 1 MB with a 64 KB buffer is about 16 `read` calls; with a 1-byte buffer it is about a million. ([3.07](module-07-system-calls.md))
10. **fd limits and inheritance.** New fds take the lowest free number. The soft limit `ulimit -n` is commonly 1024, and hitting it gives `EMFILE` ("Too many open files"). Without `O_CLOEXEC`, every fd leaks into any program you `exec`. ([3.08](module-08-file-descriptors-and-vfs.md))
11. **Signals.** SIGKILL and SIGSTOP cannot be caught, blocked or ignored. Standard signals do not queue: three SIGTERMs may be delivered once. `printf`, `malloc` and `exit` are not async-signal-safe (`man 7 signal-safety`). Servers ignore SIGPIPE. ([3.09](module-09-signals.md))
12. **Pipes.** The kernel buffer is typically 64 KB. A full pipe blocks the writer; writing with no reader raises SIGPIPE, or `EPIPE` if it is ignored. Unix domain sockets use the same API as TCP and give peer credentials with `SO_PEERCRED`. ([3.10](module-10-ipc.md))
13. **select vs epoll.** `select` is limited to `FD_SETSIZE` (1024) and scans every fd on each call. epoll registers once, and its cost grows with the number of ready fds, not watched fds. Level-triggered repeats while data remains; edge-triggered fires only on new arrivals. ([3.11](module-11-io-models-blocking-to-epoll.md))
14. **IOCP concurrency.** A completion port is created with a concurrency limit, usually the CPU count, and releases waiting threads in LIFO order so a warm thread keeps working. io_uring is disabled by policy in some places (Docker's default seccomp profile, `kernel.io_uring_disabled`). ([3.12](module-12-io-uring-and-iocp.md))
15. **Windows codes and handles.** `CreateThread` returns `NULL` on failure but `CreateFile` returns `INVALID_HANDLE_VALUE`. `0xC0000005` is an access violation, `0xC0000374` heap corruption, `0xC00000FD` stack overflow. Use one CRT flavour (`/MD` or `/MDd`) per process and free memory in the module that allocated it. ([3.13](module-13-windows-internals-and-win32.md))

## Mistakes that cost marks

1. **Forgetting `fflush(stdout)` before `fork`.** When stdout is a pipe or file, the unflushed buffer is copied into the child and printed twice. In a child whose `exec` failed, call `_exit`, not `exit`. ([3.01](module-01-processes.md))
2. **Never calling `wait` on children.** Each one stays a zombie holding a PID, until `fork` fails with `EAGAIN`. ([3.01](module-01-processes.md))
3. **Calling high RSS a leak.** Freed small chunks stay in glibc's bins for reuse. Check with Valgrind first; the fix for batch workloads is an arena, not a hunt for a leak that does not exist. ([3.05](module-05-malloc-internals.md))
4. **Assuming `read` or `write` moves the full count.** Pipes and sockets return partial results. Loop until done, EOF or a real error, and retry on `EINTR` (but never retry `close`). ([3.08](module-08-file-descriptors-and-vfs.md))
5. **Opening fds without `O_CLOEXEC`.** A child you `exec` inherits the listening socket, and the restart fails with `EADDRINUSE`. ([3.08](module-08-file-descriptors-and-vfs.md))
6. **Calling `printf` or `malloc` in a signal handler.** If the signal lands inside `malloc`, the handler deadlocks on the heap lock. Set a `volatile sig_atomic_t` flag, write to a self-pipe, or use `signalfd`. ([3.09](module-09-signals.md))
7. **Not ignoring SIGPIPE in a server.** One client disconnecting mid-reply kills the whole process. ([3.09](module-09-signals.md))
8. **Leaving the unused pipe end open after `fork`.** The reader never sees EOF because it holds a write end itself. ([3.10](module-10-ipc.md))
9. **Edge-triggered epoll without draining to `EAGAIN`.** The rest of the request sits in the buffer, no new event comes, and the client hangs. ([3.11](module-11-io-models-blocking-to-epoll.md))
10. **Freeing a buffer or `OVERLAPPED` before its completion arrives.** The kernel is still writing into it, which corrupts memory only under load. ([3.12](module-12-io-uring-and-iocp.md))

## Resume lines this phase supports

| Claim | Evidence you now have |
|---|---|
| A. Bash | You decode `$?` and `128 + signal`, and use `strace -f`, `/proc` and `dmesg` to check whether a step really succeeded. |
| B. C++ and systems (memory and ownership design, performance) | You can explain chunk headers, bins and the `mmap` threshold, and you built an arena and a pool with written ownership contracts. |
| C. Concurrency (threads, Win32 wait objects) | You saw threads as kernel tasks in `/proc/<pid>/task`, measured context switches as the thread count grew, and waited on a thread handle with `WaitForSingleObject`. |
| F. Debugging and reliability | You produced a core dump on purpose (`ulimit -c unlimited`, `core_pattern`, `gdb ./prog core`, `bt`), matched a faulting address against `maps`, and know ASan finds the real write behind `corrupted top size`. |
| G. Linux and Windows platforms | You can compare fds with handles, `fork` + `exec` with `CreateProcess`, overcommit with commit charge, and `/MT` with `/MD`. |
| H1. Migration engine (arena allocator, restartable leak-free batches) | You built the arena that resets in O(1) on success and on failure, and you can explain why `malloc`/`free` left RSS high without a leak. |
| H4. Multithreaded application server | You can defend "one process, fixed thread pool, blocking I/O" with scheduling cost, the lack of `fork` on Windows and database-bound requests, and say when you would move to epoll or IOCP. |
| H5. Crash-dump and incident debugging | You start from the exit status and the faulting address, check `dmesg` for the OOM killer, and know the first WinDbg commands: `!analyze -v`, `~*k`, `!handle`, `!heap -p -a`. |
| I. tcpkv | You can describe RAII fds opened with `O_CLOEXEC`, buffered reads instead of one `recv` per byte, and the `signalfd` graceful-shutdown sequence with SIGPIPE ignored. |

## Teach it back

Answer each prompt in your own words, without looking at the modules. Write your answers in `journal/YYYY-MM-DD-phase-3-teach-back.md` (use today's date) and send them for grading. Aim for one or two paragraphs each. A good answer mentions every point in its checklist.

**1. Explain what happens from `fork` to the parent reading the child's exit status.**

- [ ] `fork` returns the child's PID to the parent and 0 to the child.
- [ ] Page tables are copied and pages are shared copy-on-write; a page is copied only when someone writes to it.
- [ ] `exec` replaces the program but keeps the PID and the open fds (except those marked close-on-exec).
- [ ] On exit the child is a zombie until the parent calls `wait`/`waitpid`; an orphan is adopted by PID 1 or a subreaper.
- [ ] The status is decoded with `WIFEXITED`/`WEXITSTATUS` or `WIFSIGNALED`/`WTERMSIG`, and the shell shows a signal death as 128 + signal.

**2. Explain why a batch job's RSS stays high after `free`, and how an arena fixes it.**

- [ ] Small chunks go back to glibc's bins (tcache and arena bins), not to the kernel.
- [ ] The `brk` heap can only shrink from the top, so one live chunk near the top pins everything below it.
- [ ] Valgrind or ASan tells you whether it is a real leak (unreachable memory) or retained memory.
- [ ] An arena bump-allocates and resets in O(1); there is no per-object `free`.
- [ ] The ownership contract (arena owns, caller borrows, valid until reset, never `free`) and reset-on-failure make batches restartable and leak-free.

**3. Explain how a thread-pool server shuts down cleanly on SIGTERM.**

- [ ] Block SIGINT and SIGTERM in `main` before creating threads, so workers inherit the mask.
- [ ] Consume the signal in one place: a `signalfd` in the `poll` loop, or `sigwait` on one thread.
- [ ] Set an atomic stop flag and `shutdown`/`close` the listening socket so a blocked `accept` returns.
- [ ] Workers finish their current request; `main` joins them under a deadline shorter than the service manager's stop timeout, because SIGKILL follows.
- [ ] SIGPIPE is ignored and RAII closes every fd; you prove it with a flat `/proc/<pid>/fd` count, exit code 0 and clean sanitizer runs.

**4. Compare blocking I/O with a thread pool, epoll, and io_uring or IOCP. Which would you choose for the loan application server, and why?**

- [ ] A blocked thread sleeps at 0% CPU; it costs memory and scheduler work, not cycles.
- [ ] epoll is readiness: it says an fd is ready and you do the read; edge-triggered needs draining to `EAGAIN`.
- [ ] io_uring and IOCP are completion: the kernel does the I/O into your buffer and returns your tag; buffers must outlive the operation.
- [ ] For a few thousand terminals with a database call per request, the database is the bottleneck, so a blocking fixed pool sized to database concurrency is simpler and easier to debug from a dump.
- [ ] Name the trigger to change: tens of thousands of mostly idle connections means an epoll (or IOCP) front end plus a worker pool.

**5. Walk through a null-pointer write from the CPU to your first commands in the debugger, on Linux and on Windows.**

- [ ] The CPU raises a page fault; the kernel finds no VMA, or the wrong permission, for the address.
- [ ] Linux sends SIGSEGV (`SEGV_MAPERR` or `SEGV_ACCERR`); the shell shows 139; a core is written only if `ulimit -c` and `core_pattern` allow it.
- [ ] In GDB: `bt`, then look the faulting address up in the mappings (`info proc mappings`).
- [ ] Windows raises `0xC0000005`, walks the `__except` filters, then WER writes a dump if `LocalDumps` is configured.
- [ ] In WinDbg: `!analyze -v`, `.exr -1`, `~*k`, and `!heap -p -a <addr>` to tell use-after-free from overflow.

## Next steps

- Take the [Phase 3 quiz](quiz.md).
- [Back to the course README](../README.md)
- Next phase: [Module 4.01: Threads in C++](../phase-04-concurrency-deep-dive/module-01-threads-in-cpp.md)
