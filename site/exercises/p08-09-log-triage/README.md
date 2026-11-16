## Task

During an incident (module 8.09), the first ten minutes go on one question: *what is failing, and since when?* Write the script you would run on the logs.

Each line is `<timestamp> <LEVEL> <service> <message...>`. Known levels are `ERROR`, `WARN` and `INFO`. Print:

```text
ERROR 3
WARN 1
INFO 1
skipped 2
top error service: loan-svc (2)
first error: 2026-11-16T10:00:02Z loan-svc timeout calling cbs
```

- Blank lines are ignored. Lines with fewer than 3 fields, or an unknown level (such as `DEBUG`), count as `skipped`.
- The top error service is the one with the most `ERROR` lines; break ties alphabetically. With no errors, print `none` on both of the last two lines.
