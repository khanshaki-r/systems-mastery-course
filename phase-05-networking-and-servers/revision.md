# Phase 5 revision: Networking and servers

Phase 5 put your programs on the network. You learned what an IP address, a port and a 5-tuple are, how TCP opens, numbers, retransmits and closes a byte stream, and why that byte stream has no message boundaries. You wrote a server with the raw POSIX sockets API, wrapped every descriptor in a move-only RAII type, and read live socket state with `ss` and `nstat`. You compared thread-per-connection, a fixed pool and an epoll reactor, wrote the tcpkv protocol spec, built a small RPC layer with length-prefixed binary frames and safe retries, took HTTP/1.1, HTTP/2 and HTTP/3 apart, saw what TLS does and does not protect, designed overload behaviour with bounded queues and timeouts, and built the load generator that turns "it is fast" into p50 and p99 with a method behind them. Together this is resume claim E, the transport under claim H4, and most of the tcpkv capstone (claim I).

## The phase on one page

| Module | The one idea to remember | The command or code pattern to remember |
|---|---|---|
| [5.01 How the internet works](module-01-how-the-internet-works.md) | A connection is a 5-tuple; routers read only the IP header; NAT lets inside hosts reach out but not outside hosts reach in. | `ip addr`, `ip route`, `ss -tulpn`, `dig <name>`, `ping -M do -s 1472 <host>`, `traceroute <host>` |
| [5.02 TCP](module-02-tcp.md) | TCP is an ordered byte stream with no message boundaries; the side that closes first waits in TIME_WAIT for 60 s. | `ss -tan` and read the State column; loop until a whole message has arrived |
| [5.03 POSIX sockets API](module-03-posix-sockets-api.md) | `accept` returns a new fd per connection; `send` and `recv` can be short; SIGPIPE kills a server unless you stop it. | `socket`, `setsockopt(SO_REUSEADDR)`, `bind` with `htons(port)`, `listen`, `accept`; `send(fd, p, n, MSG_NOSIGNAL)` inside a `send_all` loop |
| [5.04 TCP internals](module-04-tcp-internals.md) | Full buffers plus the window are TCP's backpressure; Nagle plus delayed ACK is a 40 ms stall; CLOSE_WAIT means your code forgot `close`. | `setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one)`; `ss -tani`, `ss -ltn`, `nstat` |
| [5.05 Server architectures](module-05-server-architectures.md) | Iterative, thread-per-connection, fixed pool, reactor; a reactor handler must never block. | epoll loop: `epoll_wait`, drain to `EAGAIN`, per-connection buffers, close only after EOF and an empty output buffer |
| [5.06 Wire protocol design](module-06-wire-protocol-design.md) | Framing puts message boundaries back: a delimiter or a length prefix, always with a maximum size. | tcpkv: LF-terminated lines, 64 KiB max, `ERR <code> <message>`; RPC: 4-byte big-endian length, sanity-capped |
| [5.07 RPC and serialization](module-07-rpc-and-serialization.md) | A timeout means "outcome unknown", so mutating calls need idempotency keys; encode field by field, never `send(&struct)`. | Frame `len u32 BE \| op u16 \| req_id u32 \| payload`; money as integer paise; bounds-check every read |
| [5.08 HTTP/1.1, HTTP/2, HTTP/3](module-08-http.md) | HTTP/1.1 is CRLF text framed by `Content-Length`, chunked or close; HTTP/2 multiplexes binary streams on TCP; HTTP/3 does it on QUIC. | `curl -v http://localhost:8080/health`; every request carries `Host:` |
| [5.09 TLS basics](module-09-tls-basics.md) | Asymmetric crypto in the handshake, symmetric AEAD for data; verify the chain and the hostname, not just "encrypted". | `openssl s_client -connect host:443 -servername host` and read `Verify return code`; `sslmode=verify-full` |
| [5.10 Backpressure, timeouts, flow control](module-10-backpressure-timeouts-flow-control.md) | Bound every queue, cap connections, put a timeout on every wait (shorter than upstream), and shed load fast. | `L = λ × W`; time in system grows like `s / (1 - ρ)`; reply `BUSY` / `ERR busy` when full |
| [5.11 Load generator and latency](module-11-load-generator-and-latency.md) | Report p50 and p99 with the thread count, duration and machine, never the average; closed loop under-reports stalls. | `steady_clock` around each request, per-thread sample vectors, merge, sort, nearest rank; `load_gen --threads 16` |

## Must-know for interviews

1. **Addresses and the 5-tuple.** Protocol plus source and destination address and port identify one connection, which is why one server port serves thousands of clients. `127.0.0.1` never leaves the machine; `0.0.0.0` listens on every interface. DNS answers are cached until their TTL expires. ([5.01](module-01-how-the-internet-works.md))
2. **MTU.** Ethernet MTU is 1500 bytes, so a TCP segment carries at most 1460 bytes (MSS). "Small requests work, large responses hang" after a VPN change is a path-MTU problem; test with `ping -M do -s 1472`. ([5.01](module-01-how-the-internet-works.md))
3. **Handshake and retransmission.** SYN, SYN-ACK, ACK costs one round trip, and the SYN uses one sequence number. Before any RTT is measured the initial RTO is 1 s, doubling on each loss (minimum RTO is 200 ms on Linux). "Connection refused" is a RST from a live host; a timeout is silence (host down or firewall dropping). ([5.02](module-02-tcp.md))
4. **TIME_WAIT vs CLOSE_WAIT.** The side that closes first sits in TIME_WAIT for 60 s on Linux: that is the protocol working. CLOSE_WAIT means the peer sent FIN and your application has not called `close`: that is a bug and ends in `EMFILE`. ([5.02](module-02-tcp.md), [5.04](module-04-tcp-internals.md))
5. **Byte stream rules.** One `send` can arrive as several `recv`s, and several sends as one `recv`. `recv` returning 0 means the peer sent FIN, not "no data yet". `send` returning means "copied into my kernel buffer", not "delivered". ([5.02](module-02-tcp.md), [5.03](module-03-posix-sockets-api.md))
6. **Byte order and SIGPIPE.** Ports and lengths go on the wire big-endian: forgetting `htons(5555)` on x86 makes the server listen on 45845. Writing to a socket the peer closed raises SIGPIPE, whose default kills the process with exit status 141; use `MSG_NOSIGNAL` and ignore SIGPIPE. ([5.03](module-03-posix-sockets-api.md))
7. **`shutdown` vs `close`.** `shutdown(SHUT_WR)` sends FIN now and keeps the fd readable, so a client can send its last request and still read every reply. `close` sends FIN only when the last reference goes, or RST if unread data remains. ([5.03](module-03-posix-sockets-api.md))
8. **Nagle and delayed ACK.** Two small writes and then a read stall for about 40 ms per round trip. Fix: send each message with one `send`, and set `TCP_NODELAY` on request-response sockets. ([5.04](module-04-tcp-internals.md))
9. **Accept queue and keepalive.** The accept queue holds `min(backlog, net.core.somaxconn)` connections (4096 by default on recent kernels); when it overflows the kernel drops SYNs silently and clients see slow connects. Keepalive defaults are 2 hours idle plus 9 probes at 75 s; per-socket `TCP_KEEPIDLE` 60, `TCP_KEEPINTVL` 10, `TCP_KEEPCNT` 3 detects a dead peer in about 90 s. ([5.04](module-04-tcp-internals.md))
10. **Ephemeral ports.** A client that opens a connection per request and closes first leaves a TIME_WAIT socket for 60 s each; with about 28,000 ephemeral ports it runs out at about 470 connections per second (`EADDRNOTAVAIL`). Reuse connections. ([5.04](module-04-tcp-internals.md))
11. **Reactors.** epoll's cost grows with ready sockets, not connected ones, so waiting on 10,000 idle sockets costs one sleeping thread. One epoll loop uses one core. nginx and Redis are reactors; PostgreSQL is process-per-connection; tcpkv is a fixed pool with one connection per task. ([5.05](module-05-server-architectures.md))
12. **Framing and versioning.** tcpkv: LF-terminated lines, 65,536-byte maximum line, 256-byte maximum key, every command idempotent. RPC: a 4-byte big-endian length, capped before any allocation. Evolve formats additively: append optional fields, never reorder, retype or reuse a field position, and upgrade servers before clients. ([5.06](module-06-wire-protocol-design.md), [5.07](module-07-rpc-and-serialization.md))
13. **RPC failure modes.** Lost request, lost reply, slow server, duplicate on retry. The frame's request id is per connection and per attempt, so it cannot detect a retry after reconnect; mutating calls need an idempotency key that the client reuses on every retry. ([5.07](module-07-rpc-and-serialization.md))
14. **HTTP and TLS facts.** HTTP/1.1 requires `Host:` and keeps connections alive by default; head-of-line blocking is per connection in HTTP/1.1, per TCP connection in HTTP/2, and per stream in HTTP/3 (QUIC). TLS 1.3 needs one round trip and is always forward-secret; public certificates last at most 398 days; `sslmode=require` encrypts but does not verify, `verify-full` does. ([5.08](module-08-http.md), [5.09](module-09-tls-basics.md))
15. **Queueing numbers.** Little's law `L = λ × W`: 200 requests per second at 50 ms means 10 in flight. Time in system grows like `1 / (1 - ρ)`: twice the service time at 50% busy, ten times at 90%. Run hot stages at 60 to 70%. A p99 needs thousands of samples, a p99.9 tens of thousands. ([5.10](module-10-backpressure-timeouts-flow-control.md), [5.11](module-11-load-generator-and-latency.md))

## Mistakes that cost marks

1. **Assuming one `send` is one `recv`, or treating `recv` returning 0 as "try again".** Messages merge and split under load, and a loop on a closed socket spins forever. ([5.02](module-02-tcp.md))
2. **Forgetting `htons`/`htonl`, or trusting the peer's length prefix.** The port or length is wrong on the wire, or a hostile 4 GiB length becomes a huge allocation or an endless wait. ([5.03](module-03-posix-sockets-api.md), [5.06](module-06-wire-protocol-design.md))
3. **Not ignoring SIGPIPE.** The whole server exits with status 141 when one client hangs up mid-reply. ([5.03](module-03-posix-sockets-api.md))
4. **Missing `close` on an error path.** Sockets pile up in CLOSE_WAIT and the server ends in `EMFILE`. A move-only RAII `Socket` makes it impossible. ([5.03](module-03-posix-sockets-api.md), [5.04](module-04-tcp-internals.md))
5. **Writing a header and a body in two `send` calls.** With Nagle on, each request-response round trip stalls about 40 ms. ([5.04](module-04-tcp-internals.md))
6. **Blocking inside a reactor handler.** One slow database call freezes every connection on that loop. ([5.05](module-05-server-architectures.md))
7. **Sending a struct with `send(&s, sizeof s)` or using `double` for money.** Padding, host byte order and pointers make the bytes an accident; 0.10 has no exact binary value. ([5.07](module-07-rpc-and-serialization.md))
8. **Retrying a mutating call after a timeout without an idempotency key.** The first attempt may have succeeded, so the retry creates a duplicate loan. ([5.07](module-07-rpc-and-serialization.md))
9. **`sslmode=require` or `SSL_VERIFY_NONE` and calling the link secure.** Anyone on the path can present any certificate and read everything. ([5.09](module-09-tls-basics.md))
10. **An unbounded queue, no timeouts, or quoting the average latency.** The first database slowdown becomes an OOM kill and a retry storm, and the average hides the users who suffered. ([5.10](module-10-backpressure-timeouts-flow-control.md), [5.11](module-11-load-generator-and-latency.md))

## Resume lines this phase supports

| Claim | Evidence you now have |
|---|---|
| E. POSIX sockets, TCP/IP, RPC, HTTP, client-server architecture | You wrote a server and client on the raw sockets API, watched handshakes and closes in `ss`, built an RPC layer with framing, request ids and timeouts, and wrote an HTTP/1.1 keep-alive server tested with `curl` and `nc`. |
| H4. RPC-over-TCP application server, pooled request model | You can explain the length-prefixed frame, additive versioning with server-first rollout, idempotency keys, keepalive freeing workers from dead branch links, the Nagle fix, and a bounded pool answering `BUSY` fast. |
| I. tcpkv (line protocol, RAII socket wrappers, move-only handles, concurrent load generator) | You wrote the protocol spec first (LF framing, 64 KiB limit, `ERR` codes, idempotent commands), a move-only `Socket` whose copy is a compile error, and the closed-loop `load_gen` that reports p50/p99 with its method. |
| F. Incident triage | You can read `ss -tani`, `ss -ltn` and `nstat` (`Recv-Q`, `Send-Q`, `CLOSE-WAIT`, `ListenOverflows`), and tell the MTU, SIGPIPE, CLOSE_WAIT and ephemeral-port stories with their exact symptoms. |
| B. Undefined-behaviour-aware coding | Your RPC `Reader` bounds-checks every field and assembles integers byte by byte instead of casting a buffer pointer. |
| G. GoogleTest | `rpc_test.cpp` tests round trips, version skew, truncation and hostile lengths. |
| H7. Login-latency fix | You can tell it as a percentile story: the average looked fine while p99 was seconds, and the same generator run proved the fix. |

## Teach it back

Answer each prompt in your own words, without looking at the modules. Write your answers in `journal/YYYY-MM-DD-phase-5-teach-back.md` (use today's date) and send them for grading. Aim for one or two paragraphs each. A good answer mentions every point in its checklist.

**1. Explain why an application protocol on TCP needs framing, and how tcpkv and your RPC layer frame messages.**

- [ ] TCP is a byte stream: send boundaries are not preserved, so reads can split or merge messages.
- [ ] `recv` returns what has arrived; 0 means FIN; the reader must loop until a message is complete.
- [ ] tcpkv uses LF-terminated lines with a 64 KiB maximum; the RPC layer uses a 4-byte big-endian length prefix.
- [ ] Every length is capped before allocation, and integers are converted to and from network byte order.
- [ ] The framer and the parser are separate layers, so the parser can be unit-tested and fuzzed alone.

**2. Walk through the life of a TCP connection, and say what TIME_WAIT and CLOSE_WAIT each mean in production.**

- [ ] SYN, SYN-ACK, ACK: one round trip, options negotiated (MSS, window scaling, SACK).
- [ ] Every byte is numbered; ACKs, the receive window and the congestion window control what is in flight; loss is repaired after the RTO or on three duplicate ACKs.
- [ ] Close is FIN, ACK in each direction; `shutdown(SHUT_WR)` sends FIN early while still reading.
- [ ] TIME_WAIT (60 s) is on the side that closed first and is normal; it only hurts a connect-per-request client through port exhaustion.
- [ ] CLOSE_WAIT means your application received FIN and did not `close`: a leak to alert on.

**3. Explain how a server applies backpressure end to end, from TCP to the database.**

- [ ] TCP's receive window and full send buffers slow a sender with no application code.
- [ ] Any unbounded queue in the server breaks that chain; every queue gets a bound and a block-or-reject policy.
- [ ] A connection cap plus an idle timeout stops slow or silent clients from holding every slot.
- [ ] Every wait has a timeout shorter than the one upstream; the database pool is smaller than the worker count so the wait is measured inside the server.
- [ ] Little's law and the `1 / (1 - ρ)` curve explain why you run hot stages at 60 to 70% and reject fast with `BUSY`.

**4. A "create loan" RPC times out. Explain whether the client may retry, and how you make retries safe.**

- [ ] A timeout means the outcome is unknown: the loan may already exist.
- [ ] A retry is safe only if the operation is idempotent.
- [ ] An idempotency key is chosen once per logical operation and reused on every retry; the server stores it with the reply and returns the same reply for a repeat.
- [ ] The frame's request id is per connection and per attempt, so it cannot play this role; replies are matched by request id, not by order.
- [ ] Client timeouts exist so a dead server cannot wedge every worker.

**5. Explain how you benchmark a server so the numbers survive an interview.**

- [ ] Report p50 and p99 (and p99.9 with enough samples), never only the average, because the mean hides the tail.
- [ ] Always state the thread count, duration, read/write ratio, key space, machine, warm-up and number of repeats.
- [ ] Throughput and latency are independent until the knee; after it, throughput flattens and latency grows with the queue.
- [ ] Use `steady_clock`, keep generator threads at or below the free cores, and warm up before recording.
- [ ] A closed-loop generator suffers coordinated omission: honest for stable runs, optimistic during stalls.

## Next steps

- Take the [Phase 5 quiz](quiz.md).
- [Back to the course README](../README.md)
- Next phase: [Module 6.01: What a database is](../phase-06-databases-from-zero-to-internals/module-01-what-a-database-is.md)
