# Phase 5 quiz: Networking and servers

**Instructions**

- Closed book. No modules, no man pages, no compiler, no network tools. Paper or a blank text file only.
- Time: 45 minutes.
- 15 questions, one mark each. Pass mark: **12/15**.
- Questions 1-5 test recall, 6-10 test application (predict output, pick the right option, spot the bug), 11-15 test reasoning (diagnose a scenario, defend a trade-off).
- Write your answer before you open the `Answer` block. Mark yourself honestly: half an answer is zero.
- All code compiles on Ubuntu 24.04 with `gcc -std=c11 -D_GNU_SOURCE -O2 -Wall -Wextra -Werror` (C) or `g++ -std=c++17 -O2 -Wall -Wextra -Werror` (C++). Snippets without a `main` are fragments and compile with `-c`.

---

## Part A: recall

**Q1. What exactly identifies one TCP connection? Use it to explain how one server listening on port 7000 can talk to thousands of clients at once. Then: what is the difference between binding to `127.0.0.1` and to `0.0.0.0`?**

<details>
<summary>Answer</summary>

The **5-tuple**: protocol, source IP, source port, destination IP, destination port. All connections to the server share the same destination IP and port 7000, but each client side has a different source IP or source (ephemeral) port, so every 5-tuple is unique and the kernel can route each segment to the right socket.

`127.0.0.1` is loopback: only connections from the same machine are accepted. `0.0.0.0` means every interface, so other machines can connect too (and, on an internet-facing host, so can the whole internet).

Revisit: [Module 5.01: How the internet works](module-01-how-the-internet-works.md)

</details>

**Q2. Name the three packets of the TCP handshake. After a connection closes, which side sits in TIME_WAIT, for how long on Linux, and why? What does a socket in CLOSE_WAIT tell you?**

<details>
<summary>Answer</summary>

SYN (client), SYN-ACK (server), ACK (client): one round trip.

TIME_WAIT is on the side that **closed first**, for 60 seconds on Linux (2 x MSL). It lets that side answer a retransmitted FIN if its last ACK was lost, and lets old segments die before the same 5-tuple is reused. It is normal.

CLOSE_WAIT means this side received the peer's FIN and **its application has not called `close`**. A growing count is a descriptor leak in your code.

Revisit: [Module 5.02: TCP](module-02-tcp.md)

</details>

**Q3. List, in order, the system calls a TCP server makes from creating its socket to finishing with one client. What does `accept` return?**

<details>
<summary>Answer</summary>

`socket`, `setsockopt(SO_REUSEADDR)`, `bind` (address and `htons(port)`), `listen`, `accept`, then `recv`/`send` on the client fd, then `close` on the client fd.

`accept` returns a **new** file descriptor for that one connection. The listening descriptor stays open and keeps accepting; closing it by mistake after the first `accept` makes the server serve exactly one client.

Revisit: [Module 5.03: POSIX sockets API](module-03-posix-sockets-api.md)

</details>

**Q4. A client sends each RPC as two `send` calls (a header, then a body) and then waits for the reply. Every call takes about 40 ms, even on loopback. Name the two TCP mechanisms responsible and the two fixes.**

<details>
<summary>Answer</summary>

**Nagle's algorithm** on the sender holds the small body back until the header is acknowledged. **Delayed ACK** on the receiver holds that acknowledgement back, hoping to piggyback it on a reply that cannot come until the body arrives. Together they stall each round trip by about 40 ms.

Fixes: send each message with **one `send`** (build it in one buffer), and set **`TCP_NODELAY`** on request-response sockets. Either removes the stall; do both.

Revisit: [Module 5.04: TCP internals](module-04-tcp-internals.md)

</details>

**Q5. Where does TLS use asymmetric cryptography and where symmetric, and why the split? Why does the TLS 1.3 handshake need only one round trip? What does `sslmode=verify-full` add over `sslmode=require`?**

<details>
<summary>Answer</summary>

Asymmetric crypto is used only in the handshake: an ephemeral key exchange (usually X25519) to agree a secret, and a signature with the server's private key to prove it owns the certificate. Symmetric AEAD encryption (AES-GCM or ChaCha20-Poly1305) protects all application data. The split exists because asymmetric operations are roughly a thousand times slower.

TLS 1.3 is one round trip because the client guesses the key-exchange group and sends its key share in the very first message (ClientHello), so the server can answer with its own share, certificate, signature and Finished in one flight.

`require` encrypts but does not verify who answered. `verify-full` checks the certificate chain against a trusted root and that the certificate's SAN matches the hostname, which stops impersonation.

Revisit: [Module 5.09: TLS basics](module-09-tls-basics.md)

</details>

---

## Part B: apply

**Q6. What does this program print on an x86-64 machine? If a server put `5555` straight into `sin_port` without `htons`, which port would it actually listen on?**

```c
#include <arpa/inet.h>
#include <stdint.h>
#include <stdio.h>

int main(void) {
    uint16_t port = 5555;
    uint16_t wire = htons(port);
    const unsigned char *b = (const unsigned char *)&wire;

    printf("%02X %02X\n", b[0], b[1]);
    printf("%u\n", (unsigned)wire);
    return 0;
}
```

<details>
<summary>Answer</summary>

```text
15 B3
45845
```

5555 is `0x15B3`. Network byte order is big-endian, so after `htons` the bytes in memory are `15 B3` (most significant first). Read back as a host integer on little-endian x86, those bytes are `0xB315`, which is 45845.

Without `htons`, the kernel copies the host bytes `B3 15` into the header as they are, so the server listens on port **45845** and clients connecting to 5555 get "connection refused".

Revisit: [Module 5.03: POSIX sockets API](module-03-posix-sockets-api.md), [Module 5.06: Wire protocol design](module-06-wire-protocol-design.md)

</details>

**Q7. This function reads one frame of the RPC protocol (a 4-byte big-endian length, then the body). It passes every test on loopback and fails across the WAN. Name three bugs and write a correct version.**

```c
#include <arpa/inet.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/socket.h>

/* Reads one frame: a 4-byte big-endian length, then that many body bytes. */
char *read_frame(int fd, uint32_t *out_len) {
    uint32_t len;
    recv(fd, &len, sizeof len, 0);
    len = ntohl(len);
    char *body = malloc(len);
    recv(fd, body, len, 0);
    *out_len = len;
    return body;
}
```

<details>
<summary>Answer</summary>

1. **Short reads.** TCP is a byte stream: each `recv` may return fewer bytes than asked. The header can arrive as 2 + 2 bytes (the rest of `len` is then garbage) and the body in several pieces. Loop until every byte has arrived.
2. **Return values ignored.** `recv` returning 0 (peer closed) or -1 (error, or `EINTR` to retry) is never checked, and neither is `malloc`.
3. **The length is trusted.** A hostile or corrupt peer can send `0xFFFFFFF0`, causing a 4 GiB allocation or an endless wait. Cap it before allocating.

```c
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/types.h>

#define MAX_FRAME (1u << 20)   /* 1 MiB: refuse anything larger */

/* Returns 1 when all n bytes arrived, 0 on EOF before any byte, -1 on error. */
static int recv_exact(int fd, void *buf, size_t n) {
    char *p = buf;
    size_t got = 0;
    while (got < n) {
        ssize_t r = recv(fd, p + got, n - got, 0);
        if (r > 0) {
            got += (size_t)r;
        } else if (r == 0) {
            return got == 0 ? 0 : -1;      /* EOF in the middle is an error */
        } else if (errno != EINTR) {
            return -1;
        }
    }
    return 1;
}

char *read_frame(int fd, uint32_t *out_len) {
    unsigned char hdr[4];
    if (recv_exact(fd, hdr, sizeof hdr) != 1) return NULL;
    uint32_t len = ((uint32_t)hdr[0] << 24) | ((uint32_t)hdr[1] << 16) |
                   ((uint32_t)hdr[2] << 8) | (uint32_t)hdr[3];
    if (len > MAX_FRAME) return NULL;      /* never trust the peer's length */
    char *body = malloc(len > 0 ? len : 1);
    if (body == NULL) return NULL;
    if (recv_exact(fd, body, len) != 1) {
        free(body);
        return NULL;
    }
    *out_len = len;
    return body;
}
```

On loopback the frame usually arrives in one piece, which is why the bug hides in tests.

Revisit: [Module 5.02: TCP](module-02-tcp.md), [Module 5.06: Wire protocol design](module-06-wire-protocol-design.md)

</details>

**Q8. A colleague sends loan requests like this. On x86-64 with GCC, what is `sizeof(LoanRequest)`? List four problems with sending it this way, and say how to encode it instead.**

```cpp
#include <cstdint>
#include <sys/socket.h>

struct LoanRequest {
    std::uint8_t  type;
    std::uint32_t customer_id;
    double        amount;       // rupees
    char          branch[6];
};

void send_request(int fd) {
    LoanRequest r{1, 42, 250000.10, "BR001"};
    send(fd, &r, sizeof r, 0);
}
```

<details>
<summary>Answer</summary>

`sizeof(LoanRequest)` is **24**: `type` at offset 0, 3 padding bytes, `customer_id` at 4, `amount` at 8, `branch` at 16 to 21, and 2 padding bytes at the end so the size is a multiple of 8.

Problems:

1. **Padding.** 5 of the 24 bytes are compiler padding: their layout depends on the compiler and flags, and they can carry leftover memory onto the wire.
2. **Host byte order.** `customer_id` and `amount` go out little-endian; a big-endian reader, or a protocol that says "big-endian", misreads them.
3. **`double` for money.** 250000.10 has no exact binary value, so ledgers drift by paise. Use an integer number of paise (`int64_t`).
4. **No framing, version or bounds.** No length prefix, no version field, a fixed 6-byte string, and the `send` return value (a possible short send) is ignored.

Encode field by field instead: a length-prefixed frame with an opcode, each integer in explicit width and big-endian order, money as integer paise, strings as length + bytes, and a decoder that bounds-checks every read.

Revisit: [Module 5.07: RPC and serialization](module-07-rpc-and-serialization.md)

</details>

**Q9. Pick the socket call, option or flag that fixes each symptom.**

| | Symptom |
|---|---|
| (a) | After a restart, `bind` fails with `EADDRINUSE` for about a minute. |
| (b) | The server process disappears with exit status 141 when a client disconnects in the middle of a reply. |
| (c) | Worker threads stay blocked in `recv` for hours on connections whose branch VPN dropped without sending FIN. |
| (d) | A batch client sends its last request and wants the server to see end-of-stream while it keeps reading all the replies. |
| (e) | `ss -ltn` shows the listener's `Recv-Q` full during a login storm, and clients see slow connects. The code has `listen(fd, 5)`. |

<details>
<summary>Answer</summary>

- (a) **`SO_REUSEADDR`** on the listening socket before `bind`. Old connections on that port are in TIME_WAIT for 60 s; the option lets `bind` succeed anyway.
- (b) **`MSG_NOSIGNAL`** on every `send`, plus `signal(SIGPIPE, SIG_IGN)`. 141 is 128 + 13 (SIGPIPE); with the fix, the write fails with `EPIPE` and you close that one client.
- (c) **`SO_KEEPALIVE`** with short per-socket timers, for example `TCP_KEEPIDLE` 60, `TCP_KEEPINTVL` 10, `TCP_KEEPCNT` 3, so a dead peer is detected in about 90 s and `recv` returns `ETIMEDOUT`. The defaults (2 hours plus 9 probes at 75 s) are far too slow.
- (d) **`shutdown(fd, SHUT_WR)`**. It sends FIN now but keeps the fd readable; the client reads until `recv` returns 0, then calls `close`.
- (e) A larger **`listen` backlog** (for example 1024; the effective size is `min(backlog, net.core.somaxconn)`). When the accept queue is full the kernel drops SYNs silently, so clients only see retransmits after 1 s, 2 s, 4 s.

Revisit: [Module 5.03: POSIX sockets API](module-03-posix-sockets-api.md), [Module 5.04: TCP internals](module-04-tcp-internals.md)

</details>

**Q10. This health check is written by hand against an HTTP/1.1 server on port 8080. Name the two bugs, say what each one causes, and fix the request.**

```c
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/types.h>

int send_all(int fd, const char *buf, size_t len);   /* loops over short sends */

void get_health(int fd) {         /* fd is connected to the server's port 8080 */
    const char *req = "GET /health HTTP/1.1\r\n\r\n";
    if (send_all(fd, req, strlen(req)) != 0) return;

    char buf[4096];
    ssize_t n;
    while ((n = recv(fd, buf, sizeof buf, 0)) > 0) {
        fwrite(buf, 1, (size_t)n, stdout);
    }
}
```

<details>
<summary>Answer</summary>

1. **No `Host:` header.** It is mandatory in HTTP/1.1; a real server answers `400 Bad Request`.
2. **Reading until EOF on a keep-alive connection.** HTTP/1.1 keeps connections open by default, so after the response the server waits for the next request and never closes. The loop prints the response and then blocks forever in `recv`.

Fix: send the `Host` header, and either ask the server to close or read exactly `Content-Length` bytes of body after the blank line.

```c
const char *req = "GET /health HTTP/1.1\r\n"
                  "Host: localhost:8080\r\n"
                  "Connection: close\r\n"
                  "\r\n";
```

A long-lived client would instead keep the connection, parse the headers, and read the body by `Content-Length` (or chunked framing).

Revisit: [Module 5.08: HTTP/1.1, HTTP/2 and HTTP/3](module-08-http.md)

</details>

---

## Part C: reason

**Q11. A thread-pool server slowly loses workers over a day. `ss -tanp` shows two groups of sockets owned by the process: many `ESTABLISHED` connections whose `lastrcv` is millions of milliseconds, and a steadily rising number in `CLOSE-WAIT`. Explain each group, its cause, and its fix.**

<details>
<summary>Answer</summary>

They are two different bugs.

- **ESTABLISHED with a huge `lastrcv`: half-open connections.** The peers vanished without a FIN (VPN drop, rebooted PC), so the server's kernel still thinks the connection is alive and a worker sits in `recv` forever. Nothing will notice on an idle socket. Fix: `SO_KEEPALIVE` with short `TCP_KEEPIDLE`/`TCP_KEEPINTVL`/`TCP_KEEPCNT` (about 90 s to detection), plus `TCP_USER_TIMEOUT` where data is pending, and an application idle timeout.
- **CLOSE-WAIT: leaked descriptors.** The peer did send FIN, the kernel delivered EOF, and the handler took a path (an early return, an exception) that never called `close`. These end in `EMFILE`. Fix: own every socket in a move-only RAII wrapper whose destructor closes on every path; alert on a rising CLOSE-WAIT count, never on TIME-WAIT.

Confirm with `ss -tanp` per process over time and `ls /proc/<pid>/fd | wc -l`.

Revisit: [Module 5.04: TCP internals](module-04-tcp-internals.md)

</details>

**Q12. An interviewer asks: "tcpkv uses a fixed thread pool with one connection per task. Why not epoll? What is the limit of your design, and when would you change it?" Give your answer.**

<details>
<summary>Answer</summary>

Why a pool: each connection's state lives on one worker's stack, the code is straight-line blocking I/O, the thread count is bounded, and TSan runs are meaningful. For tens or hundreds of clients doing short map lookups, that is simpler and fast enough, and I measured it with the load generator.

The limit: with one connection per task, **K workers serve at most K connections at once**; connection K+1 waits in the queue even if the others are idle. A few slow clients can also hold every worker (head-of-line blocking). Mitigations in the current design are a connection cap with `ERR busy`, idle timeouts and bounded queues.

When to change: when the number of mostly idle connections grows far beyond the worker count (thousands and up). Then use N epoll loops (one per core) with non-blocking sockets and per-connection buffers. The parser already handles partial lines, so it carries over. Handlers on a reactor must never block; slow work goes to a pool. For the loan application server the answer is different again: its requests block on the database for milliseconds, so the database is the bottleneck and a reactor would not help.

Revisit: [Module 5.05: Server architectures](module-05-server-architectures.md)

</details>

**Q13. A server takes 200 requests per second, each taking about 50 ms end to end. Its task queue is unbounded. Then the database slows down for ten minutes. (a) How many requests are in flight on average in normal operation? (b) Describe what happens during the slowdown. (c) What would you change?**

<details>
<summary>Answer</summary>

(a) Little's law: `L = λ × W = 200/s × 0.05 s = 10` requests in flight on average.

(b) Arrivals continue at 200/s while completions drop, so the queue grows by the difference every second. Memory grows until the OOM killer ends the process. Every queued request waits behind all the others, so latency passes every client's timeout; clients retry and add more load. When the database recovers, the server spends a long time serving requests nobody is waiting for.

(c) Bound the queue at a small multiple of the worker count and reply `BUSY` immediately when it is full, so clients retry with backoff. Put a timeout on every wait, each shorter than the one upstream (for example a database `statement_timeout`), so one slow query frees its worker. Size the database pool below the worker count so the wait is inside the server, measured and timed out. Run the hot stage at 60 to 70% utilisation, because time in system grows like `1 / (1 - ρ)`.

Revisit: [Module 5.10: Backpressure, timeouts and flow control](module-10-backpressure-timeouts-flow-control.md)

</details>

**Q14. A branch client calls `CreateLoan` over your RPC layer and the call times out after 5 seconds. The developer wants to retry automatically "with the same request id, so the server can spot duplicates". Is the retry safe? Is the request id the right tool? What would you build?**

<details>
<summary>Answer</summary>

The retry is **not safe by default**. A timeout means the outcome is unknown: the server may have created the loan and only the reply was lost. A blind retry can create a duplicate loan.

The request id is **not** the right tool. It is scoped to one connection and one attempt and is used to match a reply to its call; after a reconnect it means nothing, and the server does not remember it.

Build an **idempotency key**: the client creates one unique key per logical operation (for example a UUID per loan application) and sends it on the first attempt and every retry. The server stores the key with the result inside the same transaction that creates the loan, and for a repeated key returns the stored reply instead of creating another loan. Alternatively make the operation naturally idempotent, for example the client supplies the application id. Keep client timeouts, retry with backoff, and never treat a timeout as "it did not happen".

Revisit: [Module 5.07: RPC and serialization](module-07-rpc-and-serialization.md)

</details>

**Q15. A teammate writes in the project README: "tcpkv handles 60,000 ops/s with 80 µs average latency." The numbers came from one 1-second run with 64 generator threads on a 4-core laptop, generator and server on the same machine, no warm-up. List what is wrong with the claim and how you would measure and report it instead.**

<details>
<summary>Answer</summary>

What is wrong:

- **Average latency** hides the tail: one request in a hundred can be fifty times slower and barely move the mean.
- **A 1-second run** gives too few tail samples; p99 needs thousands and p99.9 tens of thousands, and the numbers jump between runs.
- **64 generator threads on 4 cores**, sharing the machine with the server, measures the scheduler and the tool's own contention, not the server.
- **No warm-up**: connection setup, page faults and cold caches land in the samples.
- **Missing context**: no thread count, duration, read/write ratio, key space or machine, so the number cannot be checked or compared.
- **Closed loop**: under stalls it under-reports latency (coordinated omission), which should be stated.

How to report: run a thread sweep with the generator using no more threads than free cores (better, on another machine), a warm-up phase, a measured window of many seconds, and several repeats. Time each request with `steady_clock`, merge and sort the samples, and report throughput together with p50, p99 and p99.9 by nearest rank. Write one sentence with the thread count, duration, ratio, key space, machine, warm-up, repeats and "closed loop".

Revisit: [Module 5.11: Load generator and latency percentiles](module-11-load-generator-and-latency.md)

</details>

---

## Scoring

| Score | What it means | What to do next |
|---|---|---|
| 15/15 | Ready. | Do the [teach-it-back exercise](revision.md#teach-it-back), then start [Phase 6](../phase-06-databases-from-zero-to-internals/module-01-what-a-database-is.md). |
| 12-14 | Pass, with gaps. | Revisit the modules listed under every question you missed, re-answer those questions tomorrow, then move on. |
| Below 12 | Not yet. | Find the two or three modules with the most misses and redo their labs (section 8) from scratch before retaking the quiz. |

Back to the [Phase 5 revision sheet](revision.md) or the [course README](../README.md).
