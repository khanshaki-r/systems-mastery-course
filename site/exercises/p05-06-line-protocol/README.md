## Task

tcpkv speaks a **line-based text protocol** (claim I, module 5.06): one request per line, one reply per line. Implement `handle(store, line)`:

| Request | Reply |
|---|---|
| `PING` | `PONG` |
| `SET <key> <value...>` | `OK` (the value is the rest of the line, spaces included) |
| `GET <key>` | the value, or `NOT_FOUND` |
| `DEL <key>` | `DELETED` or `NOT_FOUND` |
| `KEYS` | the count, then every key in sorted order: `2 acct:1 acct:2` |
| a blank line | no reply at all |
| an unknown command | `ERR unknown command '<as typed>'` |
| wrong argument count | `ERR wrong number of arguments for '<COMMAND>'` |

Commands are case-insensitive (`get` = `GET`). Lines may end in `\r\n`.

The socket code comes later (module 5.03). Keeping the protocol a pure function of `(store, line) -> reply` is what lets you unit-test it with GoogleTest, which is exactly how this test works.
