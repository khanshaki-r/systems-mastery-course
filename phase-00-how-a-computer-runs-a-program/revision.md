# Phase 0 revision: How a computer runs a program + lab setup

Phase 0 took you from "what is a CPU?" to a working engineer's lab. You now know that a program is bytes in RAM that the CPU runs with fetch, decode and execute, and that the operating system wraps each running program in a process with its own memory and its own open files. You can drive Bash, chain programs with pipes and redirection, and read an exit code. You have a real toolchain on two platforms: GCC, Clang, CMake, GDB and Valgrind in WSL2 Ubuntu; Docker running PostgreSQL 16 and YugabyteDB; Berkeley DB, Redis and GoogleTest; Visual Studio, MSVC and WinDbg on Windows. You have captured and read a crash dump, found a leak with Valgrind, and kept your work in Git. Every later phase assumes this lab and this vocabulary.

Use this sheet the day before the quiz, and again before any interview. Each line links to the module that teaches it in full.

## One idea per module

| Module | The one idea to remember | The command or code pattern to remember |
|---|---|---|
| [0.01 What a computer does](module-01-what-a-computer-does.md) | The CPU repeats fetch, decode, execute on bytes in RAM; distance from the CPU decides speed (register 0.3 ns, L1 1 ns, RAM 100 ns, SSD 100 µs, network 1 ms). | Read hex: one byte is two hex digits, `0xFF` = 255; `int` is 4 bytes, about ±2.1 billion. |
| [0.02 OS, processes and files](module-02-operating-system-processes-files.md) | A process is a PID plus an address space, threads, a file descriptor table, a working directory and a user; a system call is the only door into the kernel (about 100 to 300 ns). | Use absolute paths in services; close every file you open, because descriptors are freed only at exit. |
| [0.03 Terminal and Bash](module-03-terminal-and-bash-basics.md) | The shell is just a program: read a line, find it in `$PATH`, `fork`, set up redirections, `execve`, `wait`, store the exit code in `$?`. | `grep -c ERROR app.log`, `cmd > out.txt 2> err.txt`, `a \| b`, `set -o pipefail`, `echo $?` |
| [0.04 Linux lab setup](module-04-linux-lab-setup.md) | WSL2 is a real Linux kernel in a light VM; the compiler translates, the build system decides what to rebuild, GDB pauses, Valgrind checks memory. | `gcc -Wall -Wextra -g -O0`, `cmake -S . -B build && cmake --build build`, `valgrind --leak-check=full ./prog` |
| [0.05 Data lab setup](module-05-data-lab-setup.md) | A container is a namespaced process on the shared kernel, not a VM; servers go in containers, libraries come from `apt`. | `docker run -d --name pg16 -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16`; YSQL on 5433; link Berkeley DB with `-ldb` after your `.c` file |
| [0.06 Windows lab setup](module-06-windows-lab-setup.md) | A dump is only readable with the matching PDB; keep PDBs for every shipped build, including Release. | `cl /W4 /WX /EHsc /Zi /Od x.cpp`; `procdump -ma -e x.exe`; in WinDbg `.symfix+`, `.reload`, `!analyze -v` |
| [0.07 Git from zero](module-07-git-from-zero.md) | A commit is a full snapshot (tree) plus parent hashes plus a message, named by its SHA-1; a branch is a pointer file. | `git add`, `git commit -m`, `git restore`, `git restore --staged`, `git revert <hash>`, `git push origin main` |

## Must-know for interviews

These are the facts and numbers an interviewer will probe. Say them in your own words, with the number.

1. **The latency ladder.** Register about 0.3 ns, L1 cache about 1 ns, RAM about 100 ns, SSD about 100 µs, a network round trip about 1 ms. A cache miss to RAM costs about 100 times an L1 hit. [0.01](module-01-what-a-computer-does.md)
2. **Why an in-memory cache wins.** RAM at 100 ns against a database round trip at about 1 ms is roughly 10,000 times faster. That is the one-sentence justification for the master-table cache in claim H4. [0.01](module-01-what-a-computer-does.md)
3. **Fetch, decode, execute.** The CPU reads the instruction at the program counter (`rip` on x86-64), works out what it means, does it, and moves on. Code and data live in the same memory. [0.01](module-01-what-a-computer-does.md)
4. **What a crash is.** An instruction touched an address the OS has not mapped. The CPU faults, and the OS delivers `SIGSEGV` on Linux or `0xC0000005` on Windows. Address zero or a small number means a null pointer. [0.01](module-01-what-a-computer-does.md), [0.06](module-06-windows-lab-setup.md)
5. **User mode and kernel mode.** Programs run in ring 3 and cannot touch hardware. They ask the kernel (ring 0) through a system call, which costs about 100 to 300 ns, so fast servers batch their I/O. [0.02](module-02-operating-system-processes-files.md)
6. **Program versus process.** The program is the file on disk; a process is one running instance with its own PID, memory and descriptor table. Two processes of one program share nothing by default. [0.02](module-02-operating-system-processes-files.md)
7. **Descriptor leaks.** Open files and sockets are closed automatically only when the process exits. A server never exits, so a leak ends in `EMFILE`, "Too many open files". This is why tcpkv uses RAII wrappers. [0.02](module-02-operating-system-processes-files.md)
8. **How the shell runs `ls > out.txt`.** `fork`, then in the child `open` the file and `dup2` it onto fd 1, then `execve` `ls`, then the parent `wait`s and stores the exit code in `$?`. `ls` never knows about the redirection. [0.03](module-03-terminal-and-bash-basics.md)
9. **stdin 0, stdout 1, stderr 2.** Data goes to stdout, complaints to stderr, success or failure to the exit code (0 means success, only 0 to 255 survive). `$?` of a pipeline is the last command's code unless `set -o pipefail`. [0.03](module-03-terminal-and-bash-basics.md)
10. **`-g` and `-O` are separate.** `-g` adds debug information with no run-time cost; `-O0` is for debugging, `-O2` is for measuring and shipping. Never benchmark a `-O0` build. [0.04](module-04-linux-lab-setup.md)
11. **"Definitely lost" in Valgrind.** A heap block that no pointer reaches at exit: a true leak. "Leak-free" means `definitely lost: 0 bytes`, ideally `All heap blocks were freed`. [0.04](module-04-linux-lab-setup.md)
12. **Container, not VM.** A container is ordinary processes with namespaces (own PIDs, own mounts, own ports) and cgroups (memory and CPU limits) on the host kernel. Its data dies with `docker rm` unless it lives in a volume. [0.05](module-05-data-lab-setup.md)
13. **The four data tools.** PostgreSQL 16 on port 5432 and YugabyteDB YSQL on 5433 speak the same wire protocol; Redis is an in-memory server on 6379; Berkeley DB is a library inside your process with no port at all. [0.05](module-05-data-lab-setup.md)
14. **Reading a Windows access violation.** Code `c0000005`; parameter 0 is the access type (0 read, 1 write, 8 execute); parameter 1 is the address. "Write to address 8" means a null struct pointer plus the field at offset 8. [0.06](module-06-windows-lab-setup.md)
15. **What a commit is.** A text object with a tree hash (full snapshot), parent hashes, author and message, named by the SHA-1 of that text. Change any old byte and every hash above it changes, so history is tamper-evident. On a shared branch, undo with `git revert`, never with `reset --hard` plus `push --force`. [0.07](module-07-git-from-zero.md)

## Mistakes that cost marks

| Mistake | Why it is wrong | What to do instead | Module |
|---|---|---|---|
| Treating memory and storage as the same thing | RAM is about 1000 times faster than an SSD and forgets everything at power off | Say which one you mean; caches live in RAM and do not survive a restart | [0.01](module-01-what-a-computer-does.md) |
| Relative paths in a server or service | The working directory depends on who started the process | Use absolute paths or paths derived from config or the executable's location | [0.02](module-02-operating-system-processes-files.md) |
| Forgetting to close files and sockets in a long-running process | Descriptors are freed only at exit | Close on every path; later, let RAII do it | [0.02](module-02-operating-system-processes-files.md) |
| `>` when you meant `>>`, or an unquoted path with spaces | `>` truncates first; spaces split one path into two arguments | Read the line twice; quote every path | [0.03](module-03-terminal-and-bash-basics.md) |
| Trusting `$?` after a pipeline | It is only the last command's exit code | `set -o pipefail` in every script | [0.03](module-03-terminal-and-bash-basics.md) |
| Keeping source code under `/mnt/d` in WSL2 | Every file operation crosses the VM boundary through 9P | Clone into `~/course` on the Linux file system | [0.04](module-04-linux-lab-setup.md) |
| Debugging a build without `-g`, or benchmarking `-O0` | No line numbers; and debug code can be 5 to 10 times slower | `-g -O0` to debug, `-g -O2` to measure | [0.04](module-04-linux-lab-setup.md) |
| Connecting to YugabyteDB on 5432, or starting two containers on one host port | YSQL listens on 5433; one host port has one listener | Use 5433; publish the second server as `-p 5434:5432` | [0.05](module-05-data-lab-setup.md) |
| Deleting the PDB, or trying to dump a crashed process after it died | The dump is unreadable without the matching PDB; a dead process cannot be dumped | Archive PDBs per build; configure WER LocalDumps or `procdump -ma -e` before the crash | [0.06](module-06-windows-lab-setup.md) |
| `git push --force` or `git reset --hard` to fix a shared branch | It rewrites history others already have and destroys the audit trail | `git revert <hash>` and push the new commit | [0.07](module-07-git-from-zero.md) |

## Resume lines this phase supports

You cannot claim any of these lines yet on Phase 0 alone. But each one now has a first, true piece of evidence from your own lab.

| Claim | What it says | Evidence you now have (one sentence) |
|---|---|---|
| A | Bash | I can count errors in a large log without opening it (`grep -c ERROR app.log`), redirect stdout and stderr separately, and explain fork, exec and wait. |
| B | Memory design, performance | I can quote the latency ladder and explain why a cache miss (about 100 ns) matters more than instruction count. |
| D | PostgreSQL, YugabyteDB, Berkeley DB, Redis | I run PostgreSQL 16 and YugabyteDB in Docker on my laptop and can explain why Berkeley DB is a library and PostgreSQL is a server. |
| F | Crash dumps, GDB, WinDbg, Valgrind | I captured a full dump with ProcDump, read an access violation at a small address in WinDbg as a null pointer plus a field offset, and had Valgrind name the line of a 40-byte leak. |
| G | Linux, GCC/Clang, CMake, GoogleTest, Git, Docker, Win32, MSVC, Visual Studio, MSBuild | I built the same kind of program with `gcc`, `clang`, CMake, `cl` and MSBuild, ran a GoogleTest under `ctest`, and keep my work in Git with a daily push. |
| H1 | Restartable, leak-free batches | I can explain how per-batch exit codes and `$?` let a Bash runner resume at the failed batch, and how `valgrind --error-exitcode=1` becomes a leak gate. |
| H3 | Gated cutover to a multi-node cluster | I can explain why the production shape is rehearsed in Docker and why merges are blocked unless CI passes. |
| H4 | In-memory master-table cache | I can justify it with numbers: about 100 ns from RAM against about 1 ms per database round trip. |
| H5 | Crash-dump debugging and RCA under SLAs | I know the two decisions that make remote dumps readable (PDB archive per build, WER LocalDumps on every server) and that a Git tag names the exact source of a build. |
| I | tcpkv with RAII socket/fd wrappers and CI | I can explain why a server must own its descriptors explicitly (they close only at exit) and that CI is a workflow file triggered by a Git push. |

## Teach it back

Answer each prompt out loud first, then in writing, in your own words, without looking at the modules. Aim for 150 to 300 words each. Write all five answers in `journal/YYYY-MM-DD-phase-0-teach-back.md` (for example `journal/2026-10-25-phase-0-teach-back.md`) and send the file for grading. A good answer covers every point in its checklist, uses at least one number, and avoids the mistakes above.

**Prompt 1. Explain to a non-programmer what happens when you double-click a program, from the file on disk to the program closing.**

A good answer must mention:
- The program file sits on storage (SSD), which is slow but keeps data without power.
- The operating system creates a process: a new PID, its own memory, its own list of open files.
- The program's bytes are copied into RAM, because the CPU can only run what is in memory.
- The CPU runs fetch, decode, execute billions of times per second.
- Anything outside its own memory (files, screen, network) is requested from the kernel through system calls.
- On exit the program returns an exit code and the OS takes back the memory and closes the files.

**Prompt 2. Explain what happens, step by step, when you type `ls -l > out.txt` in Bash and press Enter.**

A good answer must mention:
- The shell reads the line, splits it into words and finds `ls` by searching `$PATH`.
- `fork` creates a child process that is a copy of the shell.
- In the child, the shell opens `out.txt` (truncating it) and makes it fd 1 with `dup2`.
- `execve` replaces the child with the `ls` program, keeping the descriptor table.
- `ls` writes to fd 1 as usual and does not know it is a file.
- The parent waits, stores the exit code in `$?`, and prints the next prompt.

**Prompt 3. A teammate asks why the loan server keeps master tables (branches, products, rates) in memory instead of querying the database each time. Explain, with numbers.**

A good answer must mention:
- RAM access is about 100 ns; a database round trip over the network is about 1 ms.
- That is roughly 10,000 times faster, and the lookup happens on every request (the hot path).
- Layout matters too: a cache miss costs about 100 times an L1 hit, so keep hot fields together.
- The cost: memory use, the data can go stale, and the cache is empty after a restart.
- So master data that changes rarely is a good fit; fast-changing data is not.

**Prompt 4. A Windows service crashes at a customer site you cannot log into. Explain everything you set up in advance and how you read the dump afterwards.**

A good answer must mention:
- Build Release with debug information (`/Zi`, `/DEBUG`) and archive the PDB for every shipped build; the GUID must match.
- Configure Windows Error Reporting LocalDumps (full dump, known folder) or run `procdump -ma -e`.
- Tag every production build in Git so you can check out the exact source.
- In WinDbg: set the symbol path, `.reload`, `!analyze -v`.
- Read the exception code (`c0000005`), the two parameters (read or write, and the address), and the stack with file and line.
- A small address is a null pointer plus a field offset.

**Prompt 5. Explain to a teammate who thinks "a commit stores a diff" what a Git commit really is, and why you fix a bad pushed commit with `git revert`.**

A good answer must mention:
- Three areas: working tree, index (staging), repository; `git add` and `git commit` move content between them.
- A commit points at a tree, a full snapshot; diffs are computed when you ask for them.
- A commit holds parent hashes, author and message, and is named by the SHA-1 of its content.
- Changing any old byte changes every hash above it, so history is tamper-evident.
- `git revert` adds a new commit that undoes the change; everyone just pulls it, and the audit trail stays.
- `reset --hard` plus `push --force` rewrites shared history and breaks everyone else's clone.

---

Back to: [Course README](../README.md) | Take the quiz: [Phase 0 quiz](quiz.md) | Next phase: [Module 1.01: Your first C program](../phase-01-c-from-zero-to-systems/module-01-first-c-program.md)
