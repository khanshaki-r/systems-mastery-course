## Task

The program reads an account balance **in paise** (1 rupee = 100 paise) from stdin and must print:

```text
Branch: BR001
Account: SB-1001
Balance: 2500.75
```

for input `250075`. The first line is done for you. Add the other two.

## Rules

- Print the balance from the integer `balance_paise` using `/` and `%`. Do **not** convert to `double`: floating point cannot represent most decimal amounts exactly, and banks never store money that way.
- Output must match exactly, including the capital letters and the space after each colon.

## How to work

Press **Run** to try your code with the input in the stdin box. Press **Check** to run every test.
