# Phase 0 quiz: How a computer runs a program + lab setup

## Instructions

- **Closed book.** No modules, no notes, no search, no AI. You may use a terminal only where a question says so.
- **Time: 45 minutes.** Set a timer before you start.
- **Pass mark: 12 out of 15.** Each question is worth 1 mark. A question with several parts needs every part right unless it says otherwise.
- Write all your answers first (on paper or in a scratch file). Only then open the `<details>` blocks and mark yourself honestly.
- Questions get harder as you go: 1 to 5 are recall, 6 to 10 are apply (predict output, pick the command, spot the bug), 11 to 15 are reasoning.
- Where output contains your user name, write `<you>`.

---

## Part A: recall

**Q1. Put these in order from fastest to slowest and give the approximate time for one access: RAM, SSD, a CPU register, a network round trip inside a data centre, an L1 cache hit.**

<details>
<summary>Answer</summary>

Register (about 0.3 ns), L1 cache (about 1 ns), RAM (about 100 ns), SSD (about 100 µs), network round trip (about 1 ms).

Each step down is a big jump: RAM is about 100 times slower than L1, and the network is about 10,000 times slower than RAM. That is why data layout and caching matter more than raw instruction count. You must give the order and roughly the right magnitudes (order of 10) to get the mark.

Revisit: [Module 0.01](module-01-what-a-computer-does.md)

</details>

**Q2. Convert the binary byte `1011 0110` to hexadecimal and to decimal. How many different values can one byte hold?**

<details>
<summary>Answer</summary>

`1011` is `B` and `0110` is `6`, so the byte is `0xB6`. In decimal that is 11 × 16 + 6 = **182**. One byte (8 bits) holds 2^8 = **256** different values (0 to 255).

Each hex digit stands for exactly four bits, which is why one byte is always two hex digits. You will read addresses and memory in hex in every crash dump from now on.

Revisit: [Module 0.01](module-01-what-a-computer-does.md)

</details>

**Q3. Name five things the kernel gives every process. Then say what a system call is and roughly what it costs.**

<details>
<summary>Answer</summary>

Any five of: a process ID (PID), its own virtual address space (memory), at least one thread, a file descriptor table (handle table on Windows), a current working directory, a user identity, environment variables.

A system call is the controlled entry from user mode (ring 3) into the kernel (ring 0): the program puts a request number and arguments in registers and executes the `syscall` instruction; the kernel checks the request, does the work and returns. It costs roughly 100 to 300 ns, which is why servers batch I/O into larger reads and writes.

Revisit: [Module 0.02](module-02-operating-system-processes-files.md)

</details>

**Q4. In one sentence each, say what these four tools do: a compiler, a build system (CMake), a debugger (GDB), a memory checker (Valgrind). Then say where in WSL2 your source code should live, and why.**

<details>
<summary>Answer</summary>

- The **compiler** (`gcc`, `clang`) turns source files into machine code (preprocess, compile, assemble, link).
- The **build system** decides which files need rebuilding, in what order, with which flags and libraries; CMake generates those build files from `CMakeLists.txt`.
- The **debugger** pauses a running program at breakpoints so you can step and print variables.
- The **memory checker** runs the program and reports leaks and bad memory accesses with the line that caused them.

Code lives on the Linux file system, for example `~/course` (ext4 inside the VM). Files under `/mnt/c` or `/mnt/d` are reached through the 9P protocol across the VM boundary, so every `open` and `stat` is a round trip and builds are several times slower.

Revisit: [Module 0.04](module-04-linux-lab-setup.md)

</details>

**Q5. For each of PostgreSQL, YugabyteDB (YSQL), Redis and Berkeley DB: is it a server or a library, and which port does it listen on?**

<details>
<summary>Answer</summary>

| Tool | Server or library | Port |
|---|---|---|
| PostgreSQL 16 | Server (separate process, reached over a socket) | 5432 |
| YugabyteDB YSQL | Server (a cluster of processes) | 5433 (web console 15433) |
| Redis | Server (in-memory) | 6379 |
| Berkeley DB | Library linked into your process (`-ldb`) | None |

YugabyteDB uses 5433 so it can run beside a real PostgreSQL while speaking the same wire protocol. Berkeley DB has no port because its B-tree code runs on your own thread, in your own address space, on a file you name.

Revisit: [Module 0.05](module-05-data-lab-setup.md)

</details>

---

## Part B: apply

**Q6. Predict the exact output of this script, run with `bash` in Ubuntu.**

```bash
mkdir -p ~/quiz && cd ~/quiz
printf 'ERROR disk full\nINFO started\nERROR timeout\n' > app.log
grep -c ERROR app.log
grep ERROR app.log > errors.txt
grep ERROR app.log >> errors.txt
wc -l < errors.txt
false | true
echo $?
set -o pipefail
false | true
echo $?
```

<details>
<summary>Answer</summary>

```text
2
4
0
1
```

`grep -c` counts the 2 matching lines. `>` truncates and writes 2 lines; `>>` appends 2 more, so `errors.txt` has 4. By default `$?` after a pipeline is the exit code of the **last** command (`true`, so 0); with `set -o pipefail` it is the first non-zero code in the pipeline (`false`, so 1). This is why every script you write should start with `set -o pipefail`.

Revisit: [Module 0.03](module-03-terminal-and-bash-basics.md)

</details>

**Q7. `goto_tmp.sh` contains the lines below and is executable (`chmod +x`). `LOAN_ENV` is not set before you start. Predict the four lines of output.**

```bash
#!/bin/bash
cd /tmp
export LOAN_ENV=test
```

```bash
cd ~/quiz
./goto_tmp.sh
pwd
echo "env=${LOAN_ENV:-unset}"
source goto_tmp.sh
pwd
echo "env=${LOAN_ENV:-unset}"
```

<details>
<summary>Answer</summary>

```text
/home/<you>/quiz
env=unset
/tmp
env=test
```

`./goto_tmp.sh` runs in a **child** process. Its `cd` and `export` change the child's working directory and environment; the child exits and your shell is unchanged. `source` runs the same lines **in your current shell**, so the `cd` and the variable stick. This is also why `cd` must be a shell built-in: the working directory belongs to a process, and a child cannot change its parent's.

Revisit: [Module 0.03](module-03-terminal-and-bash-basics.md)

</details>

**Q8. You build and check this program with `gcc -Wall -Wextra -Werror leak.c -o leak && valgrind --leak-check=full ./leak`. Part of the report is shown. (a) Is there a leak, and how big? (b) Why is there no file name or line number? (c) Give the exact compile command you should have used.**

```c
#include <stdio.h>
#include <stdlib.h>

int main(void) {
    int *ids = malloc(10 * sizeof *ids);   /* room for 10 loan ids */
    if (ids == NULL) {
        return 1;
    }
    ids[0] = 1001;
    printf("first id %d\n", ids[0]);
    return 0;                               /* forgot free(ids) */
}
```

```text
==2813== 40 bytes in 1 blocks are definitely lost in loss record 1 of 1
==2813==    at 0x4846828: malloc (in /usr/libexec/valgrind/vgpreload_memcheck-amd64-linux.so)
==2813==    by 0x10917E: main (in /home/<you>/quiz/leak)
```

<details>
<summary>Answer</summary>

(a) Yes. 40 bytes (10 × 4-byte `int`) in 1 block are **definitely lost**: no pointer reaches the block at exit, so it can never be freed.

(b) The binary was built without `-g`, so it has no debug information (DWARF) mapping addresses to source lines. Valgrind can only say "somewhere in `main` in this file".

(c) `gcc -Wall -Wextra -Werror -g -O0 leak.c -o leak`. Valgrind then prints `by 0x10917E: main (leak.c:5)`. The fix is `free(ids);` before `return 0;`. `-g` costs nothing at run time; it only makes the file bigger.

Revisit: [Module 0.04](module-04-linux-lab-setup.md)

</details>

**Q9. A Windows service crashed. `!analyze -v` in WinDbg shows this excerpt. What happened, in one sentence, and what is your first hypothesis about the bug?**

```text
EXCEPTION_RECORD:  (.exr -1)
ExceptionAddress: 00007ff6b2a11a5a (loansvc!apply_payment+0x2a)
   ExceptionCode: c0000005 (Access violation)
  ExceptionFlags: 00000000
NumberParameters: 2
   Parameter[0]: 0000000000000001
   Parameter[1]: 0000000000000010
Attempt to write to address 0000000000000010
```

<details>
<summary>Answer</summary>

The function `apply_payment` tried to **write** (parameter 0 = 1) to address **0x10** (parameter 1), which is never mapped, so the CPU raised an access violation (`c0000005`).

First hypothesis: a **null pointer plus a field offset**. The code wrote to a member 16 bytes (0x10) into a struct or class through a pointer that was null. Confirm by looking at the faulting instruction (a store through a register holding 0, plus 0x10) and at which type in that frame has a member at offset 16; then ask why the pointer was null (never set, already freed, or an unchecked lookup that returned null).

Revisit: [Module 0.06](module-06-windows-lab-setup.md)

</details>

**Q10. Pick the right Git command for each situation. (Full mark: at least 4 of 5 correct.)**

(a) You edited `notes.md` but have not staged it, and you want to throw the edit away.
(b) You ran `git add secret.env` by mistake. You have not committed yet.
(c) A commit you pushed to the shared `main` yesterday broke the build.
(d) You want to see exactly what will go into your next commit.
(e) You want to download the remote's new commits without changing your current branch.

<details>
<summary>Answer</summary>

(a) `git restore notes.md` (copies the index version back over the working tree).
(b) `git restore --staged secret.env` (resets that path in the index; then add it to `.gitignore`).
(c) `git revert <hash>`, then `git push origin main` (a new commit that undoes the bad one; history stays append-only).
(d) `git diff --staged` (index compared with the last commit).
(e) `git fetch` (updates `origin/main` only; `git pull` would also merge into your branch).

The pattern: `restore` for the working tree, `restore --staged` for the index, `revert` for anything already pushed. Never `reset --hard` plus `push --force` on a shared branch.

Revisit: [Module 0.07](module-07-git-from-zero.md)

</details>

---

## Part C: reason

**Q11. A small service works perfectly when you start it by hand from its folder. When the service manager starts it at boot, it fails with "No such file or directory" while opening `config/app.ini`. Diagnose it and give the fix.**

<details>
<summary>Answer</summary>

The path is **relative**, and relative paths are resolved against the process's **current working directory**. By hand, you started it from the application folder, so `config/app.ini` existed there. The service manager starts the process from a different directory (often `/` on Linux or `C:\Windows\System32` on Windows), so the same relative path points at nothing.

Fix: use an absolute path, or build the path from configuration, an environment variable or the executable's own location. Also check that the service's user can read the file; that failure gives a different error (`EACCES`, permission denied), not "No such file or directory".

Revisit: [Module 0.02](module-02-operating-system-processes-files.md)

</details>

**Q12. A colleague starts a second PostgreSQL container with `docker run -d --name pg-test -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16` while `pg16` is already running with the same `-p`. It fails with "port is already allocated". (a) Explain why, given that each container has its own network. (b) Give two fixes. (c) The colleague then gives the container a 512 MB memory limit and configures PostgreSQL to use more than that. Is it slowed down or killed, and why?**

<details>
<summary>Answer</summary>

(a) `-p host:container` maps a port on the **host** to a port inside the container. Inside, each container has its own network namespace and both can listen on 5432. But host port 5432 can have only one listener, and `pg16` already holds it.

(b) Publish the second one on another host port, `-p 5434:5432`, and connect with `psql -h localhost -p 5434 -U postgres`. Or do not publish at all and let containers talk to each other by name over a Docker network.

(c) It is **killed**, not slowed. A container is an ordinary process with a cgroup memory limit on the shared kernel; when it goes over the limit the kernel's OOM killer ends it. There is no separate VM with its own kernel and swap to absorb the overrun.

Revisit: [Module 0.05](module-05-data-lab-setup.md)

</details>

**Q13. Your loan-servicing program will run as a Windows service on bank branch servers you cannot log into. Before the first release, what must you set up so that a crash there can be diagnosed? Explain why each item is needed.**

<details>
<summary>Answer</summary>

1. **Debug information in Release builds** (`/Zi` and `/DEBUG`; optimisation `/O2` is independent) and the **PDB archived for every shipped build**, indexed by its GUID. The executable only stores the GUID; without the matching PDB, the dump shows `module+0x1234` instead of function, file and line.
2. **Automatic dump capture**: Windows Error Reporting LocalDumps in the registry with a full dump (`DumpType` = 2) and a known folder, set by the installer. Nobody is there when it crashes, and a process that has already died cannot be dumped by hand. A full dump is needed if the bug might be heap corruption.
3. **A Git tag for every production build**, and the service logs its build version, so you can check out the exact source that matches the dump.

Then: open the dump in WinDbg, point the symbol path at the archive, `.reload`, `!analyze -v`, read the exception code, the two parameters and the stack, and write the RCA from facts.

Revisit: [Module 0.06](module-06-windows-lab-setup.md), [Module 0.07](module-07-git-from-zero.md)

</details>

**Q14. A teammate pushed a bad commit to the shared `main`. Another teammate suggests `git reset --hard HEAD~1` followed by `git push --force`. Argue against it, and explain why Git can detect that history was changed.**

<details>
<summary>Answer</summary>

`reset --hard` plus `push --force` rewrites the shared branch to pretend the commit never existed. Everyone who already pulled it now disagrees with the server: their next pull is a messy merge or they lose work, and commits built on top of the bad one are orphaned. It also destroys the record of what was in production at the time of the incident, which the RCA needs. The right fix is `git revert <hash>`: a new commit that undoes the change, which everyone simply pulls.

Git detects rewriting because every object is named by the SHA-1 of its content. A commit contains its tree hash and its parents' hashes, so changing any byte in any old file or message changes that object's hash and every hash above it. The new tip hash no longer matches what others hold. Rewriting is never silent; it creates a visibly different history.

Revisit: [Module 0.07](module-07-git-from-zero.md)

</details>

**Q15. Walk through every system call the shell makes to run `ls -l > out.txt`, and explain why `ls` does not need any code for redirection.**

<details>
<summary>Answer</summary>

1. The shell reads the line from fd 0 and parses it into `ls`, `-l` and "redirect fd 1 to `out.txt`".
2. It finds `/usr/bin/ls` by searching the directories in `$PATH`.
3. `fork` creates a child with a copy of the shell's memory and descriptor table.
4. In the child, before running `ls`: `open("out.txt", O_WRONLY|O_CREAT|O_TRUNC)` returns, say, fd 3; `dup2(3, 1)` makes fd 1 refer to the file; `close(3)`.
5. `execve("/usr/bin/ls", ["ls", "-l"], envp)` replaces the child's code with `ls`. The descriptor table survives `execve`.
6. `ls` writes its listing to fd 1, exactly as it always does.
7. The parent calls `wait4` on the child's PID, stores its exit status in `$?`, and prints the next prompt.

`ls` needs no redirection code because the shell set up fd 1 in the gap between `fork` and `exec`. A program only ever writes to "fd 1"; whether that is a terminal, a file or a pipe was decided before it started. That gap is the design reason Unix splits process creation into two calls.

Revisit: [Module 0.03](module-03-terminal-and-bash-basics.md), [Module 0.02](module-02-operating-system-processes-files.md)

</details>

---

## Scoring

| Score | What it means | What to do next |
|---|---|---|
| 15 | Ready. | Do the teach-back in [revision.md](revision.md), then start [Module 1.01](../phase-01-c-from-zero-to-systems/module-01-first-c-program.md). |
| 12 to 14 | Pass, with gaps. | Re-read the modules listed under "Revisit" for every question you missed, then do the teach-back. |
| Below 12 | Not yet. | Find the modules where you lost two or more marks, redo their `## Lab` sections from scratch, then retake this quiz in two or three days. |

Record your score and the questions you missed in your teach-back journal entry. The mistakes you make here are the questions an interviewer will find.

---

Back to: [Phase 0 revision](revision.md) | [Course README](../README.md) | Next phase: [Module 1.01: Your first C program](../phase-01-c-from-zero-to-systems/module-01-first-c-program.md)
