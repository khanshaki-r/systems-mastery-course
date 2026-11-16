## Task

`copy_id` copies an account id into a fixed 8-byte buffer with `strcpy`. Any id longer than 7 characters writes past the end of the buffer. That is **undefined behaviour** (module 1.11): it may seem to work, corrupt a neighbouring variable, or crash later somewhere unrelated. These are the bugs that end up as crash dumps (claim H5).

Rewrite `copy_id` so that it:

- copies at most `cap - 1` characters and always writes the terminating `'\0'`;
- returns `0` if the whole id fit, `1` if it was truncated, and `-1` if `cap == 0` (no room at all).

```text
[SB-1001] -> [SB-1001]
[SB-100234] -> [SB-1002] (truncated)
```

Run the starter first and read AddressSanitizer's report. Learning to read one is half the skill.
