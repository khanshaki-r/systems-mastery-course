## Task

A `Customer` owns its `Loan`s, and each `Loan` points back at its customer. With `shared_ptr` in both directions the reference counts never reach zero. The objects keep each other alive forever: a **leak** that no `delete` can fix, because nobody owns the loop from outside.

Change the back-pointer so that:

- the customer is destroyed when the last outside owner lets go,
- a loan that outlives its customer reports `(gone)` instead of crashing,
- LeakSanitizer finds nothing.

Expected output:

```text
LN-1 belongs to Asha
customer use_count = 1
LN-1 use_count = 2
customer Asha destroyed
loan LN-2 destroyed
after scope, LN-1 belongs to (gone)
end of main
loan LN-1 destroyed
```

Module 2.05 explains the control block, which holds a strong count and a weak count. This exercise is that diagram running live.
