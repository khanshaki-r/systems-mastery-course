## Task

Claim **H6**: put validation rules in the database, so every client gets the same checks in one round trip. Write

```sql
validate_loan(p_customer_id bigint, p_amount numeric, p_term int) RETURNS text
```

in **PL/pgSQL**. It returns the first rule that fails, checked in this order:

| # | Rule | Returns |
|---|---|---|
| 1 | no such customer | `NO_CUSTOMER` |
| 2 | `customers.blocked` is true | `BLOCKED` |
| 3 | amount below 10,000 or above 50,00,000 | `AMOUNT_OUT_OF_RANGE` |
| 4 | term below 6 or above 360 months | `TERM_OUT_OF_RANGE` |
| 5 | (sum of the customer's `APPROVED` and `DISBURSED` loans) + amount > `exposure_limit` | `EXPOSURE_LIMIT` |
| 6 | otherwise | `OK` |

Try it with `SELECT validate_loan(1, 200000, 120);`. The test calls it for ten cases, including the edge cases.
