## Task

Read latency samples in milliseconds, one per line, and print a report:

```text
count = 10
min = 11.0 ms
p50 = 14.0 ms
p90 = 240.0 ms
p99 = 900.0 ms
max = 900.0 ms
mean = 125.1 ms
```

Use the **nearest-rank** percentile: sort the samples; the p-th percentile is the value at rank `ceil(p/100 * n)`, counting from 1. Print every value with one decimal. With no samples, print `no samples`.

This is the report your tcpkv load generator produces (module 5.11). Press **Visualize** to step through `percentile()` and watch the rank being computed.
