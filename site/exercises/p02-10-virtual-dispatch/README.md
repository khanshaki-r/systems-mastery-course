## Task

A lending platform has many products that share a shape but differ in rules. The code holds them as `std::unique_ptr<Loan>`, but the starter's base class is not polymorphic, so every product is priced at the base rate.

Fix the class hierarchy so the right product's `rate_bps()` and `kind()` are used through a `Loan` pointer:

- `virtual` on the base functions, `override` on the derived ones;
- a **virtual destructor**, because the objects are deleted through `unique_ptr<Loan>`. Deleting a derived object through a base pointer without one is undefined behaviour.

Expected for the test input:

```text
home 2500000: 850 bps, yearly interest 212500
personal 300000: 1399 bps, yearly interest 41970
gold 150000: 920 bps, yearly interest 13800
unknown loan type: car
total yearly interest: 268270
```

Then press **Layout**. The polymorphic `Loan` gains a hidden 8-byte `vtable pointer` at offset 0. That pointer is the cost of `virtual` (module 2.10).
