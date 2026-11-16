## Task

Read three integers: the **principal in rupees**, the **annual rate in basis points** (1 bp = 0.01%, so 850 means 8.50%) and the **term in months**. Print the simple interest, exact to the paisa (rounded down):

```text
interest_paise = principal_paise * rate_bps * months / (10000 * 12)
```

Input `100000 850 12` prints:

```text
interest = 8500.00 rupees
```

## What is wrong with the starter

It uses `int`. Run it on the first test: the intermediate product does not fit in 32 bits. In C, **signed overflow is undefined behaviour**. The build has UndefinedBehaviorSanitizer on, so it stops the program and names the line. Without the sanitizer you would just get a wrong number.

Fix the types so all four tests pass. This is module 1.02 made real: choosing a type is choosing a range.
