## Task

The first line is `N`, followed by `N` loan amounts in rupees. For each amount print `<amount>: <class>`, then one summary line with the count of each class.

| Amount | Class |
|---|---|
| 0 or less | `invalid` |
| below 50,000 | `micro` |
| below 5,00,000 | `small` |
| below 50,00,000 | `medium` |
| 50,00,000 or more | `large` |

Example input `6 25000 50000 499999 2500000 5000000 -10` gives:

```text
25000: micro
50000: small
499999: small
2500000: medium
5000000: large
-10: invalid
micro=1 small=2 medium=1 large=1 invalid=1
```

Watch the boundaries: exactly 50,000 is **small**, not micro.
