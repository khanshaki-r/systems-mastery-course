# Module 6.02: SQL from scratch

**Estimated hours:** 6

**What you will learn**

1. How to read data with `SELECT`, `WHERE`, `ORDER BY`, `LIMIT`, expressions, `DISTINCT`, the five join types, `GROUP BY`/`HAVING`, subqueries, CTEs, `CASE` and a first window function.
2. How to change data with `INSERT`, `UPDATE`, `DELETE`, `RETURNING` and UPSERT (`ON CONFLICT`), and how NULL and three-valued logic change the answers.
3. How to think in sets: replace a row-by-row loop with one statement, and measure the difference yourself (resume claim H2).

**Prerequisites:** [Module 6.01: What a database is](module-01-what-a-database-is.md). The `lending` database must exist and `~/.pgpass` must be set up.

---

## 1. One-line intuition

SQL is a language for describing the table you want back; the database works out the loops, the order of work and the shortcuts.

## 2. Real-life analogy

Go back to the records room and its registrar.

- A **SELECT** is a slip that describes a result, not a procedure: "every customer at MUM01, with name and PAN, oldest first". You never say "open register 3, start at page 1, check each line".
- **WHERE** is a stencil laid over the register: only lines that show through are kept.
- A **JOIN** is laying two registers side by side and drawing a line between entries that share a value, such as the same branch code.
- **GROUP BY** is sorting slips into piles (one pile per branch) and writing one summary card per pile: how many, how much in total.
- A **subquery** is a slip that needs the answer to another slip first: "applications bigger than the average application".
- An **UPDATE** with no WHERE is the registrar correcting every line in the register at once. That is either the most efficient thing you can ask for or the worst mistake of your week.

## 3. Why it exists: the problem it solves

Databases before SQL (the 1960s and 70s network and hierarchical systems, such as CODASYL and IBM's IMS) were navigated by programs: "find the first loan record, follow the pointer to its customer, get next". Every new question was a new program, and changing the storage layout broke every program.

IBM's System R project (1974) produced SEQUEL, later SQL: a declarative language over Codd's relational model. You describe the result; the database's planner chooses the access path. SQL became an ANSI standard in 1986 and every relational database since speaks a dialect of it. PostgreSQL's dialect is very close to the standard.

What breaks without it is exactly what the lending platform lived through before its migration. Data sat in Berkeley DB, which has no query language. Each management report was a C program that opened a cursor, walked records one by one, decoded each one and accumulated totals in memory. Twelve reports, twelve programs, twelve places to fix when the record layout changed. Bulk changes, such as repricing every floating-rate loan, ran as loops that touched one record per call. Resume claim H2 is about replacing that style with set-based SQL, and section 6 measures what that is worth.

## 4. Three layers of depth

Run the setup script from section 6 before reading on. It builds six tables of the lending schema with a small, fixed data set (5 branches, 6 customers, 4 products, 8 applications, 3 loans, 6 repayments), so every output below matches yours exactly. Run each example in `psql -h localhost -U postgres -d lending`.

Money is stored as integer **paise** (1 rupee = 100 paise) in `bigint` columns, and rates as **basis points** (1 bp = 0.01%, so 850 = 8.50%). Module 6.03 explains why.

### Layer 1 (beginner): reading and changing rows

**The shape of a query.** Clauses always appear in this order; only `SELECT` and `FROM` are needed.

```sql
SELECT   columns or expressions     -- what to show
FROM     table                      -- where from
WHERE    condition                  -- which rows to keep
ORDER BY column [DESC]              -- sort (ascending by default)
LIMIT    n;                         -- keep only the first n
```

**Filter and sort.**

```sql
SELECT branch_code, city, region
FROM branches
WHERE region = 'SOUTH'
ORDER BY branch_code;
```

```text
 branch_code |   city    | region
-------------+-----------+--------
 BLR01       | Bengaluru | SOUTH
 CHN01       | Chennai   | SOUTH
(2 rows)
```

**Top N.** The three largest applications:

```sql
SELECT application_id, customer_id, amount_paise
FROM loan_applications
ORDER BY amount_paise DESC
LIMIT 3;
```

```text
 application_id | customer_id | amount_paise
----------------+-------------+--------------
           5006 |        1005 |    600000000
           5001 |        1001 |    450000000
           5007 |        1001 |    120000000
(3 rows)
```

`LIMIT` without `ORDER BY` gives you "some 3 rows", not "the first 3". There is no first without an order.

**Expressions and functions.** A `SELECT` list can compute. `AS` names the result column.

```sql
SELECT product_code,
       round(base_rate_bp / 100.0, 2)                   AS rate_pct,
       max_amount_paise / 100                           AS max_rupees,
       to_char(max_amount_paise / 100, 'FM99,99,99,999') AS max_indian
FROM products
ORDER BY base_rate_bp;
```

```text
 product_code | rate_pct | max_rupees | max_indian
--------------+----------+------------+-------------
 HL01         |     8.50 |   10000000 | 1,00,00,000
 AL01         |     9.25 |    2000000 | 20,00,000
 GL01         |     9.75 |     500000 | 5,00,000
 PL01         |    11.50 |    2500000 | 25,00,000
(4 rows)
```

Two traps hide here. Integer divided by integer is integer division: `7 / 2` is `3`. Write `7 / 2.0` (or `100.0`) to get a `numeric` result, which is exact but can carry many decimal places, hence `round(x, 2)`. The `to_char` pattern puts commas where you place them, so Indian lakh and crore grouping is just a pattern.

Functions you will use constantly:

| Kind | Examples | Result for the example |
|---|---|---|
| Text | `upper('mum01')`, `length(full_name)`, `left(pan, 5)`, `full_name \|\| ' (' \|\| branch_code \|\| ')'` | `MUM01`, `8`, `ABCPR`, `Asha Rao (MUM01)` |
| Numbers | `round(8.456, 2)`, `abs(-5)`, `7 % 2`, `greatest(3, 9)` | `8.46`, `5`, `1`, `9` |
| Dates | `now()`, `current_date`, `date '2026-01-31' + 1`, `age(date '2026-01-01', dob)`, `extract(year FROM dob)` | timestamp, today, `2026-02-01`, an interval, `1988` |
| NULL helpers | `coalesce(paid_at::text, 'not paid')`, `nullif(x, 0)` | first non-NULL value; NULL if `x = 0` |

**DISTINCT** removes duplicate rows from the result:

```sql
SELECT DISTINCT status FROM loan_applications ORDER BY status;
```

```text
  status
-----------
 APPROVED
 DISBURSED
 DRAFT
 REJECTED
 SUBMITTED
(5 rows)
```

**Conditions.** `=`, `<>` (not equal), `<`, `<=`, `>`, `>=`, `AND`, `OR`, `NOT`, plus three shortcuts: `status IN ('APPROVED', 'SUBMITTED')`, `amount_paise BETWEEN 100000000 AND 500000000` (inclusive at both ends), `full_name LIKE 'A%'` (`%` matches any run of characters, `_` exactly one; `ILIKE` ignores case).

`AND` binds tighter than `OR`, exactly like `*` and `+`. This query was meant to find rejected or draft applications at MUM01:

```sql
SELECT application_id, branch_code, status
FROM loan_applications
WHERE status = 'REJECTED' OR status = 'DRAFT' AND branch_code = 'MUM01'
ORDER BY application_id;
```

```text
 application_id | branch_code |  status
----------------+-------------+----------
           5005 | BLR01       | REJECTED
           5007 | MUM01       | DRAFT
           5008 | DEL01       | REJECTED
(3 rows)
```

It returned rejected applications from every branch, because it means `REJECTED OR (DRAFT AND MUM01)`. With brackets, `WHERE (status = 'REJECTED' OR status = 'DRAFT') AND branch_code = 'MUM01'`, the answer is one row, 5007. Always bracket a mix of `AND` and `OR`.

**Testing for NULL.** `paid_at` is NULL for unpaid repayments. Watch what `= NULL` does:

```sql
SELECT count(*) AS eq_null FROM repayments WHERE paid_at = NULL;
SELECT repayment_id, status FROM repayments WHERE paid_at IS NULL ORDER BY repayment_id;
```

```text
 eq_null
---------
       0
(1 row)

 repayment_id | status
--------------+---------
         9003 | OVERDUE
         9005 | DUE
(2 rows)
```

`paid_at = NULL` is never true, so it matches nothing, silently. Use `IS NULL` and `IS NOT NULL`. Layer 2 explains why.

**INSERT, UPDATE, DELETE with RETURNING.** `RETURNING` hands back the rows you just changed, saving a second query (and a second round trip from your app server).

```sql
INSERT INTO loan_applications
       (application_id, branch_code, customer_id, product_code, amount_paise, tenure_months, status, created_by)
VALUES (5009, 'CHN01', 1004, 'GL01', 5000000, 12, 'DRAFT', 'U01')
RETURNING application_id, status, created_at IS NOT NULL AS has_created_at;

UPDATE loan_applications
SET status = 'SUBMITTED'
WHERE application_id = 5009 AND status = 'DRAFT'
RETURNING application_id, status;

DELETE FROM loan_applications
WHERE application_id = 5009
RETURNING application_id, branch_code, amount_paise;
```

```text
 application_id | status | has_created_at
----------------+--------+----------------
           5009 | DRAFT  | t
(1 row)

INSERT 0 1
 application_id |  status
----------------+-----------
           5009 | SUBMITTED
(1 row)

UPDATE 1
 application_id | branch_code | amount_paise
----------------+-------------+--------------
           5009 | CHN01       |      5000000
(1 row)

DELETE 1
```

Notice `AND status = 'DRAFT'` in the UPDATE. Run that UPDATE a second time and it prints `UPDATE 0`: the state check makes it safe to repeat. That pattern (put the expected current state in the WHERE, then check the row count) is how a workflow step avoids double-processing, and you will use it for disbursement in module 6.04. An `UPDATE` or `DELETE` without `WHERE` changes every row in the table; `psql` will not ask "are you sure?".

### Layer 2 (working engineer): joins, groups, subqueries, NULL logic

**Joins with small row tables.** Create a throwaway table of sales targets. `TEMP` tables vanish when you disconnect. HYD01 is deliberately a branch that does not exist.

```sql
CREATE TEMP TABLE targets (branch_code varchar(6), target_paise bigint);
INSERT INTO targets VALUES ('MUM01', 900000000), ('DEL01', 300000000), ('HYD01', 500000000);
```

```text
branches.branch_code      targets.branch_code  target_paise
MUM01  ---------------->  MUM01                 900000000
PUN01                     DEL01                 300000000
DEL01  ---------------->  (DEL01)
BLR01                     HYD01                 500000000   (no matching branch)
CHN01

join type     rows   what it keeps
INNER JOIN       2   only matched pairs: MUM01, DEL01
LEFT JOIN        5   every branch; target columns NULL where no match
RIGHT JOIN       3   every target; branch columns NULL for HYD01
FULL JOIN        6   everything from both sides, NULLs on whichever side is missing
CROSS JOIN      15   every branch paired with every target (5 x 3), no condition
```

The LEFT and FULL versions, as `psql` prints them:

```sql
SELECT b.branch_code, b.city, t.target_paise
FROM branches b
LEFT JOIN targets t ON t.branch_code = b.branch_code
ORDER BY b.branch_code;

SELECT b.branch_code, t.branch_code AS t_code, t.target_paise
FROM branches b
FULL JOIN targets t ON t.branch_code = b.branch_code
ORDER BY coalesce(b.branch_code, t.branch_code);
```

```text
 branch_code |   city    | target_paise
-------------+-----------+--------------
 BLR01       | Bengaluru |
 CHN01       | Chennai   |
 DEL01       | Delhi     |    300000000
 MUM01       | Mumbai    |    900000000
 PUN01       | Pune      |
(5 rows)

 branch_code | t_code | target_paise
-------------+--------+--------------
 BLR01       |        |
 CHN01       |        |
 DEL01       | DEL01  |    300000000
             | HYD01  |    500000000
 MUM01       | MUM01  |    900000000
 PUN01       |        |
(6 rows)
```

`b` and `t` are **table aliases**: short names so you can write `b.city`. `JOIN` alone means `INNER JOIN`; `LEFT JOIN` is short for `LEFT OUTER JOIN`. A RIGHT JOIN is a LEFT JOIN with the tables swapped, and most people write it that way. Run the INNER, RIGHT and CROSS versions yourself and check the row counts against the picture.

**A real three-table join.** Applications at MUM01 with customer and product names:

```sql
SELECT a.application_id, c.full_name, p.name AS product, a.amount_paise / 100 AS rupees, a.status
FROM loan_applications a
JOIN customers c ON c.customer_id  = a.customer_id
JOIN products  p ON p.product_code = a.product_code
WHERE a.branch_code = 'MUM01'
ORDER BY a.application_id;
```

```text
 application_id |  full_name  |    product    | rupees  |  status
----------------+-------------+---------------+---------+-----------
           5001 | Asha Rao    | Home loan     | 4500000 | DISBURSED
           5002 | Vikram Shah | Personal loan |  300000 | DISBURSED
           5007 | Asha Rao    | Auto loan     | 1200000 | DRAFT
(3 rows)
```

This is the query the app server ran for every request before it cached `products` in memory (claim H4): the join to a master table on every call.

**Finding what is missing (anti-join).** Customers with no application at all: LEFT JOIN, then keep rows where the right side is NULL.

```sql
SELECT c.customer_id, c.full_name, c.kyc_status
FROM customers c
LEFT JOIN loan_applications a ON a.customer_id = c.customer_id
WHERE a.application_id IS NULL;
```

```text
 customer_id |  full_name  | kyc_status
-------------+-------------+------------
        1006 | Rohan Mehta | REJECTED
(1 row)
```

**The LEFT JOIN trap.** Count verified customers per branch, including branches with none:

```sql
SELECT b.branch_code, count(c.customer_id) AS verified_customers
FROM branches b
LEFT JOIN customers c ON c.branch_code = b.branch_code
WHERE c.kyc_status = 'VERIFIED'
GROUP BY b.branch_code ORDER BY b.branch_code;
```

```text
 branch_code | verified_customers
-------------+--------------------
 BLR01       |                  1
 MUM01       |                  2
 PUN01       |                  1
(3 rows)
```

CHN01 and DEL01 vanished. For CHN01 the LEFT JOIN produced a row with `c.kyc_status` NULL, and `WHERE NULL = 'VERIFIED'` threw it away: the WHERE turned the LEFT JOIN back into an inner join. Move the condition into the `ON` clause (`LEFT JOIN customers c ON c.branch_code = b.branch_code AND c.kyc_status = 'VERIFIED'`, no WHERE) and you get all five branches, with 0 for CHN01 and DEL01. Rule: conditions on the optional side of a LEFT JOIN go in `ON`.

**GROUP BY and aggregates.** Aggregates collapse many rows into one value: `count(*)`, `count(col)`, `sum`, `avg`, `min`, `max`. With `GROUP BY` you get one result row per group.

```sql
SELECT status, count(*) AS n, sum(amount_paise) AS total_paise
FROM loan_applications
GROUP BY status
ORDER BY n DESC, status;
```

```text
  status   | n | total_paise
-----------+---+-------------
 DISBURSED | 3 |   560000000
 REJECTED  | 2 |    25000000
 APPROVED  | 1 |   600000000
 DRAFT     | 1 |   120000000
 SUBMITTED | 1 |    20000000
(5 rows)
```

`HAVING` filters groups after aggregation; `WHERE` filters rows before it. Branches with at least two applications:

```sql
SELECT branch_code, count(*) AS apps, max(amount_paise) / 100 AS largest_rupees
FROM loan_applications
GROUP BY branch_code
HAVING count(*) >= 2
ORDER BY branch_code;
```

```text
 branch_code | apps | largest_rupees
-------------+------+----------------
 BLR01       |    2 |         800000
 DEL01       |    2 |         200000
 MUM01       |    3 |        4500000
(3 rows)
```

Every column in the `SELECT` list must either be in `GROUP BY` or inside an aggregate. `count(*)` counts rows; `count(col)` counts non-NULL values of `col`:

```sql
SELECT count(*) AS all_rows, count(paid_at) AS paid_rows,
       sum(amount_paise) AS total_paise, round(avg(amount_paise)) AS avg_paise,
       min(due_date), max(due_date)
FROM repayments;
```

```text
 all_rows | paid_rows | total_paise | avg_paise |    min     |    max
----------+-----------+-------------+-----------+------------+------------
        6 |         4 |    16045900 |   2674317 | 2025-04-10 | 2025-06-10
(1 row)
```

`sum` of a `bigint` column returns `numeric`, so it cannot overflow even across a whole bank's book.

**Subqueries.** A query inside a query. Four forms:

```sql
-- Scalar: returns one value. Applications above the average amount.
SELECT application_id, amount_paise
FROM loan_applications
WHERE amount_paise > (SELECT avg(amount_paise) FROM loan_applications)
ORDER BY application_id;

-- IN: returns a list. Customers who hold an ACTIVE loan.
SELECT customer_id, full_name
FROM customers
WHERE customer_id IN (SELECT customer_id FROM loans WHERE status = 'ACTIVE')
ORDER BY customer_id;

-- EXISTS: true if the inner query finds at least one row.
SELECT b.branch_code, b.name
FROM branches b
WHERE EXISTS (SELECT 1 FROM loans l WHERE l.branch_code = b.branch_code AND l.status = 'ACTIVE')
ORDER BY b.branch_code;

-- Correlated: the inner query refers to the outer row (a.customer_id), so it
-- is logically re-run per outer row. Each customer's largest application.
SELECT a.customer_id, a.application_id, a.amount_paise
FROM loan_applications a
WHERE a.amount_paise = (SELECT max(a2.amount_paise)
                        FROM loan_applications a2
                        WHERE a2.customer_id = a.customer_id)
ORDER BY a.customer_id;
```

```text
 application_id | amount_paise
----------------+--------------
           5001 |    450000000
           5006 |    600000000
(2 rows)

 customer_id | full_name
-------------+------------
        1001 | Asha Rao
        1004 | Arjun Nair
(2 rows)

 branch_code |       name
-------------+-------------------
 BLR01       | Bengaluru MG Road
 MUM01       | Mumbai Fort
(2 rows)

 customer_id | application_id | amount_paise
-------------+----------------+--------------
        1001 |           5001 |    450000000
        1002 |           5002 |     30000000
        1003 |           5003 |     20000000
        1004 |           5004 |     80000000
        1005 |           5006 |    600000000
(5 rows)
```

The EXISTS example also shows why EXISTS is fast: the inner query can stop at the first match.

**CTEs (common table expressions).** `WITH name AS (query)` gives a subquery a name, so a long query reads top to bottom. The active loan book per branch, including empty branches:

```sql
WITH branch_book AS (
    SELECT branch_code, sum(outstanding_paise) AS book_paise
    FROM loans
    WHERE status = 'ACTIVE'
    GROUP BY branch_code
)
SELECT b.branch_code, b.city, coalesce(bb.book_paise, 0) AS book_paise
FROM branches b
LEFT JOIN branch_book bb ON bb.branch_code = b.branch_code
ORDER BY book_paise DESC, b.branch_code;
```

```text
 branch_code |   city    | book_paise
-------------+-----------+------------
 MUM01       | Mumbai    |  448559500
 BLR01       | Bengaluru |   78946200
 CHN01       | Chennai   |          0
 DEL01       | Delhi     |          0
 PUN01       | Pune      |          0
(5 rows)
```

**CASE** is SQL's if/else, and works anywhere an expression does. Combined with the `FILTER` clause on an aggregate, it builds report columns:

```sql
SELECT application_id, amount_paise / 100 AS rupees,
       CASE
         WHEN amount_paise >= 100000000 THEN 'LARGE'
         WHEN amount_paise >=  20000000 THEN 'MEDIUM'
         ELSE 'SMALL'
       END AS size_band
FROM loan_applications
WHERE application_id IN (5001, 5004, 5005)
ORDER BY application_id;

SELECT branch_code,
       count(*) FILTER (WHERE status = 'REJECTED') AS rejected,
       count(*) AS total,
       round(100.0 * count(*) FILTER (WHERE status = 'REJECTED') / count(*), 1) AS reject_pct
FROM loan_applications
GROUP BY branch_code
ORDER BY branch_code;
```

```text
 application_id | rupees  | size_band
----------------+---------+-----------
           5001 | 4500000 | LARGE
           5004 |  800000 | MEDIUM
           5005 |  150000 | SMALL
(3 rows)

 branch_code | rejected | total | reject_pct
-------------+----------+-------+------------
 BLR01       |        1 |     2 |       50.0
 DEL01       |        1 |     2 |       50.0
 MUM01       |        0 |     3 |        0.0
 PUN01       |        0 |     1 |        0.0
(4 rows)
```

The first `CASE` branch that matches wins, so order the `WHEN`s from most to least specific.

**UPSERT: insert, or update if it already exists.** `ON CONFLICT` needs a unique constraint or primary key to detect the conflict. `EXCLUDED` is the row you tried to insert.

```sql
INSERT INTO products (product_code, name, min_amount_paise, max_amount_paise, max_tenure_months, base_rate_bp)
VALUES ('PL01', 'Personal loan', 5000000, 250000000, 60, 1099)
ON CONFLICT (product_code) DO UPDATE
   SET base_rate_bp = EXCLUDED.base_rate_bp
RETURNING product_code, base_rate_bp;
```

```text
 product_code | base_rate_bp
--------------+--------------
 PL01         |         1099
(1 row)

INSERT 0 1
```

PL01 existed, so its rate changed from 1150 to 1099. With a new code such as `EL01` the same statement inserts a fresh row. `ON CONFLICT (product_code) DO NOTHING` skips the row instead and prints `INSERT 0 0`. UPSERT is atomic: two sessions running it at once cannot both insert. Put PL01 back with `UPDATE products SET base_rate_bp = 1150 WHERE product_code = 'PL01';`.

**NULL and three-valued logic.** Every comparison in SQL returns true, false or **unknown** (NULL). `WHERE` keeps a row only if the condition is true; unknown is thrown away like false.

| `a` | `b` | `a AND b` | `a OR b` | `NOT a` |
|---|---|---|---|---|
| true | unknown | unknown | true | false |
| false | unknown | false | unknown | true |
| unknown | unknown | unknown | unknown | unknown |

```sql
SELECT NULL = NULL AS eq, NULL <> 1 AS ne, NULL IS NULL AS is_null,
       (NULL = 1) OR true AS or_true, (NULL = 1) AND false AS and_false,
       NULL IS DISTINCT FROM 1 AS distinct_from;
```

```text
 eq | ne | is_null | or_true | and_false | distinct_from
----+----+---------+---------+-----------+---------------
    |    | t       | t       | f         | t
(1 row)
```

The blanks are NULL (unknown). `IS DISTINCT FROM` treats NULL as an ordinary value and always answers true or false; use it when comparing columns that may be NULL.

The most expensive NULL bug is `NOT IN` with a NULL in the list:

```sql
SELECT count(*) AS not_in_with_null
FROM customers
WHERE customer_id NOT IN (SELECT 1004 UNION ALL SELECT NULL);
```

```text
 not_in_with_null
------------------
                0
(1 row)
```

Zero customers, although five of the six are not 1004. `x NOT IN (1004, NULL)` means `x <> 1004 AND x <> NULL`, and `x <> NULL` is unknown, so the whole condition is never true. In real code the list is a subquery over a column that is nullable, and one stray NULL row makes a report return nothing. `NOT EXISTS` does not have this problem; prefer it. Other NULL rules: aggregates skip NULLs (`sum`, `avg`, `count(col)`); `ORDER BY` puts NULLs last in ascending order and first in descending order (change with `NULLS FIRST` / `NULLS LAST`); `coalesce(a, b)` returns the first non-NULL argument.

**Window functions (preview).** An aggregate collapses rows; a **window function** computes across related rows but keeps every row. `OVER (PARTITION BY ... ORDER BY ...)` defines the window.

```sql
SELECT branch_code, application_id, amount_paise,
       rank() OVER (PARTITION BY branch_code ORDER BY amount_paise DESC) AS rank_in_branch
FROM loan_applications
WHERE branch_code IN ('BLR01', 'MUM01')
ORDER BY branch_code, rank_in_branch;

SELECT loan_id, due_date, amount_paise,
       sum(amount_paise) OVER (PARTITION BY loan_id ORDER BY due_date) AS running_paise
FROM repayments
WHERE loan_id = 7001
ORDER BY due_date;
```

```text
 branch_code | application_id | amount_paise | rank_in_branch
-------------+----------------+--------------+----------------
 BLR01       |           5004 |     80000000 |              1
 BLR01       |           5005 |     15000000 |              2
 MUM01       |           5001 |    450000000 |              1
 MUM01       |           5007 |    120000000 |              2
 MUM01       |           5002 |     30000000 |              3
(5 rows)

 loan_id |  due_date  | amount_paise | running_paise
---------+------------+--------------+---------------
    7001 | 2025-04-10 |      3905200 |       3905200
    7001 | 2025-05-10 |      3905200 |       7810400
    7001 | 2025-06-10 |      3905200 |      11715600
(3 rows)
```

Running balances, "top 3 per branch", and "previous installment's date" (`lag(due_date) OVER (...)`) are all window functions. They replace a lot of application-side looping.

### Layer 3 (internals): the order SQL really runs in, and why sets win

**Written order is not evaluation order.** The database evaluates a query logically in this order:

1. `FROM` and `JOIN`: build the combined rows.
2. `WHERE`: drop rows.
3. `GROUP BY`: form groups.
4. `HAVING`: drop groups.
5. `SELECT` list, including window functions: compute output columns and aliases.
6. `DISTINCT`: drop duplicate output rows.
7. `ORDER BY`: sort (may use the aliases from step 5).
8. `LIMIT` / `OFFSET`: cut.

This explains two errors every beginner meets. An alias cannot be used in `WHERE`, because aliases are made in step 5:

```sql
SELECT application_id, amount_paise / 100 AS rupees
FROM loan_applications
WHERE rupees > 1000000;
```

```text
ERROR:  column "rupees" does not exist
LINE 3: WHERE rupees > 1000000;
              ^
```

And `WHERE count(*) > 1` fails with `aggregate functions are not allowed in WHERE`, because groups do not exist until step 3; that is what `HAVING` is for. `ORDER BY rupees` works, because sorting happens after step 5.

**What the server actually builds.** The logical order defines the answer, not the work. The planner turns your query into a **plan**: a tree of operators. `EXPLAIN` shows it (`COSTS OFF` hides the numbers, which module 6.10 explains):

```sql
EXPLAIN (COSTS OFF)
SELECT c.full_name, count(*) AS apps
FROM loan_applications a
JOIN customers c ON c.customer_id = a.customer_id
WHERE a.status <> 'DRAFT'
GROUP BY c.full_name
ORDER BY apps DESC;
```

```text
                        QUERY PLAN
----------------------------------------------------------
 Sort
   Sort Key: (count(*)) DESC
   ->  HashAggregate
         Group Key: c.full_name
         ->  Hash Join
               Hash Cond: (a.customer_id = c.customer_id)
               ->  Seq Scan on loan_applications a
                     Filter: (status <> 'DRAFT'::text)
               ->  Hash
                     ->  Seq Scan on customers c
(10 rows)
```

Read it from the bottom. Scan `customers` and build a hash table on `customer_id` (the same structure as your module 1.15 hash map). Scan `loan_applications`, applying the WHERE as a filter during the scan, and probe the hash table for each row. Group the joined rows in another hash table. Sort the groups. The executor runs this as a pipeline of iterators: each node asks its child "next row, please", processes it and passes results up. Nothing in your SQL said "hash"; the planner chose a **hash join**. With other sizes or indexes it could choose a nested loop or a merge join instead (module 6.10). The correlated subquery earlier is often rewritten by the planner into a join for the same reason: you state the result, the planner picks the algorithm.

**Why one statement beats a loop of statements.** Suppose the app must update 10,000 loans. Done row by row from a client, each row costs:

- a network round trip (psql or the app to the server and back; typically 0.1 to 1 ms, more across machines),
- parsing and planning the statement,
- executor start-up and shut-down,
- and, in autocommit mode, a **commit**, which waits for the write-ahead log to be flushed to disk with `fsync` (module 6.06). On many disks that alone is a millisecond or more.

Done as one `UPDATE ... FROM`, the server pays each of those costs once, then runs a tight C loop over the rows next to the data. The per-row cost drops from milliseconds to microseconds. There are two further wins that matter more in banking than speed:

- **Atomicity.** One statement either changes all 10,000 rows or none. A loop that dies at row 6,000 leaves 6,000 repriced loans and 4,000 old ones, and someone must work out which.
- **Consistency of the read.** One statement reads all its input as of one moment. A loop reads the products table 10,000 times, and a rate change halfway through gives half the loans the old rate.

`UPDATE target SET ... FROM other WHERE join_condition` is PostgreSQL's syntax for "update using a join". One caution from the documentation: if a target row matches more than one row of `other`, only one of them is used and which one is unpredictable. Make sure the join is on a key.

## 5. Architecture diagram

```mermaid
flowchart TB
    subgraph LOGICAL["Logical order: defines the answer"]
        F["1 FROM and JOIN"] --> W["2 WHERE"] --> G["3 GROUP BY"] --> H["4 HAVING"]
        H --> S["5 SELECT list and window functions"] --> D["6 DISTINCT"] --> O["7 ORDER BY"] --> L["8 LIMIT"]
    end
    subgraph PHYSICAL["Physical plan: what the executor runs"]
        SORT["Sort"] --> AGG["HashAggregate"] --> HJ["Hash Join"]
        HJ --> SCAN1["Seq Scan loan_applications, filter status"]
        HJ --> HASH["Hash"] --> SCAN2["Seq Scan customers"]
    end
    SQL["SQL text from client"] --> PARSER["parser and analyser"] --> PLANNER["planner picks cheapest plan"]
    PLANNER --> PHYSICAL
    LOGICAL -. "same result, any algorithm" .-> PLANNER
```

## 6. Code

**The setup script.** Save as `sql02_setup.sql` next to `lending_01.sql`. It drops and recreates six tables in `lending` (the canonical definitions from module 6.03, minus `roles`, `users` and `audit_log`) and loads the small data set used by every example above. Re-run it whenever you want a clean slate.

```sql
-- sql02_setup.sql
-- Module 6.02: a small, fixed data set on six tables of the lending schema.
-- Safe to re-run: it drops and recreates the tables (not the database).
-- Run:  psql -h localhost -U postgres -d lending -f sql02_setup.sql
\set ON_ERROR_STOP on
SET client_min_messages = warning;      -- hide "table does not exist" notices
DROP TABLE IF EXISTS repayments, loans, loan_applications, products, customers, branches CASCADE;

CREATE TABLE branches (
  branch_code  varchar(6) PRIMARY KEY,
  name         text NOT NULL,
  city         text NOT NULL,
  region       text NOT NULL,
  opened_on    date NOT NULL
);
CREATE TABLE customers (
  customer_id  bigint PRIMARY KEY,
  branch_code  varchar(6) NOT NULL REFERENCES branches,
  full_name    text NOT NULL,
  pan          char(10) NOT NULL UNIQUE,
  dob          date NOT NULL,
  kyc_status   text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE products (
  product_code      varchar(8) PRIMARY KEY,
  name              text NOT NULL,
  min_amount_paise  bigint NOT NULL,
  max_amount_paise  bigint NOT NULL,
  max_tenure_months int NOT NULL,
  base_rate_bp      int NOT NULL,
  active            boolean NOT NULL DEFAULT true
);
CREATE TABLE loan_applications (
  application_id  bigint PRIMARY KEY,
  branch_code     varchar(6) NOT NULL REFERENCES branches,
  customer_id     bigint NOT NULL REFERENCES customers,
  product_code    varchar(8) NOT NULL REFERENCES products,
  amount_paise    bigint NOT NULL,
  tenure_months   int NOT NULL,
  status          text NOT NULL,
  created_by      varchar(10) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE loans (
  loan_id           bigint PRIMARY KEY,
  application_id    bigint NOT NULL UNIQUE REFERENCES loan_applications,
  branch_code       varchar(6) NOT NULL REFERENCES branches,
  customer_id       bigint NOT NULL REFERENCES customers,
  product_code      varchar(8) NOT NULL REFERENCES products,
  principal_paise   bigint NOT NULL,
  outstanding_paise bigint NOT NULL,
  rate_bp           int NOT NULL,
  tenure_months     int NOT NULL,
  disbursed_at      timestamptz,
  status            text NOT NULL
);
CREATE TABLE repayments (
  repayment_id  bigint PRIMARY KEY,
  loan_id       bigint NOT NULL REFERENCES loans,
  due_date      date NOT NULL,
  amount_paise  bigint NOT NULL,
  paid_at       timestamptz,
  status        text NOT NULL
);

INSERT INTO branches VALUES
  ('MUM01', 'Mumbai Fort',           'Mumbai',    'WEST',  '2009-04-01'),
  ('PUN01', 'Pune Camp',             'Pune',      'WEST',  '2012-07-16'),
  ('DEL01', 'Delhi Connaught Place', 'Delhi',     'NORTH', '2010-01-11'),
  ('BLR01', 'Bengaluru MG Road',     'Bengaluru', 'SOUTH', '2015-09-01'),
  ('CHN01', 'Chennai Anna Salai',    'Chennai',   'SOUTH', '2018-03-05');

INSERT INTO customers VALUES
  (1001, 'MUM01', 'Asha Rao',    'ABCPR1234K', '1988-02-14', 'VERIFIED', '2025-01-06 10:15+05:30'),
  (1002, 'MUM01', 'Vikram Shah', 'BCDPS2345L', '1979-11-30', 'VERIFIED', '2025-01-20 11:40+05:30'),
  (1003, 'DEL01', 'Neha Gupta',  'CDEPG3456M', '1992-06-05', 'PENDING',  '2025-02-03 09:05+05:30'),
  (1004, 'BLR01', 'Arjun Nair',  'DEFPN4567N', '1985-09-21', 'VERIFIED', '2025-02-11 15:30+05:30'),
  (1005, 'PUN01', 'Meera Joshi', 'EFGPJ5678P', '1990-01-09', 'VERIFIED', '2025-03-02 12:00+05:30'),
  (1006, 'DEL01', 'Rohan Mehta', 'FGHPM6789Q', '1996-12-17', 'REJECTED', '2025-03-18 16:45+05:30');

-- amounts are in paise: 4500000.00 rupees = 450000000 paise
INSERT INTO products VALUES
  ('HL01', 'Home loan',     50000000, 1000000000, 360,  850, true),
  ('PL01', 'Personal loan',  5000000,  250000000,  60, 1150, true),
  ('AL01', 'Auto loan',     10000000,  200000000,  84,  925, true),
  ('GL01', 'Gold loan',      1000000,   50000000,  24,  975, true);

INSERT INTO loan_applications VALUES
  (5001, 'MUM01', 1001, 'HL01', 450000000, 240, 'DISBURSED', 'U01', '2025-03-01 10:00+05:30'),
  (5002, 'MUM01', 1002, 'PL01',  30000000,  36, 'DISBURSED', 'U01', '2025-03-04 11:30+05:30'),
  (5003, 'DEL01', 1003, 'PL01',  20000000,  24, 'SUBMITTED', 'U01', '2025-03-20 14:10+05:30'),
  (5004, 'BLR01', 1004, 'AL01',  80000000,  60, 'DISBURSED', 'U02', '2025-03-25 10:45+05:30'),
  (5005, 'BLR01', 1004, 'PL01',  15000000,  12, 'REJECTED',  'U02', '2025-04-01 09:20+05:30'),
  (5006, 'PUN01', 1005, 'HL01', 600000000, 300, 'APPROVED',  'U01', '2025-04-07 13:00+05:30'),
  (5007, 'MUM01', 1001, 'AL01', 120000000,  60, 'DRAFT',     'U02', '2025-04-15 17:05+05:30'),
  (5008, 'DEL01', 1003, 'PL01',  10000000,  12, 'REJECTED',  'U01', '2025-04-21 10:30+05:30');

INSERT INTO loans VALUES
  (7001, 5001, 'MUM01', 1001, 'HL01', 450000000, 448559500,  850, 240, '2025-03-10 12:00+05:30', 'ACTIVE'),
  (7002, 5002, 'MUM01', 1002, 'PL01',  30000000,         0, 1150,  36, '2025-03-15 12:00+05:30', 'CLOSED'),
  (7003, 5004, 'BLR01', 1004, 'AL01',  80000000,  78946200,  925,  60, '2025-04-02 12:00+05:30', 'ACTIVE');

INSERT INTO repayments VALUES
  (9001, 7001, '2025-04-10', 3905200, '2025-04-09 18:20+05:30', 'PAID'),
  (9002, 7001, '2025-05-10', 3905200, '2025-05-12 10:05+05:30', 'PAID'),
  (9003, 7001, '2025-06-10', 3905200, NULL,                     'OVERDUE'),
  (9004, 7003, '2025-05-02', 1670500, '2025-05-02 09:00+05:30', 'PAID'),
  (9005, 7003, '2025-06-02', 1670500, NULL,                     'DUE'),
  (9006, 7002, '2025-04-15',  989300, '2025-04-15 11:00+05:30', 'PAID');

SELECT 'branches' AS tbl, count(*) FROM branches
UNION ALL SELECT 'customers', count(*) FROM customers
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'loan_applications', count(*) FROM loan_applications
UNION ALL SELECT 'loans', count(*) FROM loans
UNION ALL SELECT 'repayments', count(*) FROM repayments;
```

```bash
psql -h localhost -U postgres -d lending -f sql02_setup.sql
```

Expected:

```text
SET
DROP TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
CREATE TABLE
INSERT 0 5
INSERT 0 6
INSERT 0 4
INSERT 0 8
INSERT 0 3
INSERT 0 6
        tbl        | count
-------------------+-------
 branches          |     5
 customers         |     6
 products          |     4
 loan_applications |     8
 loans             |     3
 repayments        |     6
(6 rows)
```

`UNION ALL` glues the rows of several queries into one result. (If you come back to this module after 6.03, re-run 6.03's `lending_schema.sql` and `lending_seed.sql` when you are done, because this script's `CASCADE` also drops foreign keys that point at these tables from the full schema.)

**Set-based versus row-by-row.** Three small files. The first builds 10,000 practice loans whose `rate_bp` is 0 and must be set from their product's base rate.

```sql
-- rate_demo_setup.sql: 10,000 practice loans with rate 0, to be repriced from products
\set ON_ERROR_STOP on
DROP TABLE IF EXISTS rate_demo;
CREATE TABLE rate_demo (
  loan_id      bigint PRIMARY KEY,
  product_code varchar(8) NOT NULL REFERENCES products,
  rate_bp      int NOT NULL
);
INSERT INTO rate_demo (loan_id, product_code, rate_bp)
SELECT g, (ARRAY['HL01', 'PL01', 'AL01', 'GL01'])[1 + g % 4], 0
FROM generate_series(1, 10000) AS g;
```

The second does what a cursor-walking client does: fetch the work list, then send one UPDATE per row. `\gexec` is a `psql` command that runs each value of the result as a separate statement, each one a separate round trip.

```sql
-- row_by_row.sql: what a cursor-style client does.
-- Step 1 fetches the work list; \gexec then sends ONE UPDATE per row,
-- each its own round trip, its own parse and plan, its own commit.
SELECT format('UPDATE rate_demo SET rate_bp = %s WHERE loan_id = %s',
              p.base_rate_bp, d.loan_id)
FROM rate_demo d
JOIN products p ON p.product_code = d.product_code
\gexec
```

The third does the same change as one statement:

```sql
-- set_based.sql: the same change as one statement.
UPDATE rate_demo AS d
SET    rate_bp = p.base_rate_bp
FROM   products AS p
WHERE  p.product_code = d.product_code;
```

Run and time them (`-q` hides the 10,000 `UPDATE 1` lines; `time` is the shell's stopwatch):

```bash
psql -h localhost -U postgres -d lending -f rate_demo_setup.sql
time psql -h localhost -U postgres -d lending -q -f row_by_row.sql
psql -h localhost -U postgres -d lending -q -f rate_demo_setup.sql
time psql -h localhost -U postgres -d lending -f set_based.sql
psql -h localhost -U postgres -d lending -c "SELECT product_code, rate_bp, count(*) FROM rate_demo GROUP BY 1, 2 ORDER BY 1;"
```

Expected: both methods leave the same final table:

```text
 product_code | rate_bp | count
--------------+---------+-------
 AL01         |     925 |  2500
 GL01         |     975 |  2500
 HL01         |     850 |  2500
 PL01         |    1150 |  2500
(4 rows)
```

The `real` times are machine-dependent. On the laptop used to check this module (PostgreSQL 16 on Linux, local TCP), the row-by-row run took between 20 and 80 seconds across repeats, and the set-based `UPDATE 10000` about 0.3 seconds including `psql` start-up. The row-by-row time swings so much because it is dominated by 10,000 disk flushes, one per autocommitted statement; Part D of the lab separates that cost from the round trips. Your numbers will differ, especially through Docker's port forwarding. The ratio, typically one hundred times or more, is the lesson.

## 7. Use case: core-banking loan-origination platform

Floating-rate home loans are linked to an external benchmark. When the benchmark moves, every active floating-rate loan must be repriced: new `rate_bp` from the product's new base rate plus the loan's spread, then a new EMI. On the pre-migration platform this was a nightly C job over Berkeley DB: open a cursor on the loan database, for each record decode it, look up the product record, compute, write the record back. It touched each loan with several library calls, and after the move to a client-server database a straight port of that loop would have meant several network round trips per loan.

A port of the loop to SQL, one `UPDATE` per loan, was tried first and measured, exactly as in section 6. For a book of a few hundred thousand loans, the per-row cost multiplied by the row count did not fit the overnight window, and when the job failed partway it left the book half repriced with no record of where it stopped.

**The decision it drove:** bulk changes are written as set-based statements (`UPDATE loans l SET rate_bp = p.base_rate_bp + spread FROM products p WHERE ...`), each running in one transaction, so a repricing either happens to the whole book or not at all. Where the work was too large for one transaction, it was split into key ranges (`WHERE loan_id BETWEEN x AND y`), each range a set-based statement, with the last finished range recorded so the job could restart. That is the same "restartable batch" idea as claim H1, applied to SQL. Per-row loops in application code were allowed only for work that needed a per-row call to another system.

## 8. Lab

Run `sql02_setup.sql` first. Write each query yourself before opening the answer. Parts A and B only read data; Part C changes it, so re-run the setup script afterwards.

### Part A: warm-up (30 minutes)

Type every example from Layer 1 and Layer 2 and compare your output with the text. Then run the INNER, RIGHT and CROSS joins against `targets` and confirm 2, 3 and 15 rows. Then run the LEFT JOIN trap query and fix it by moving the condition into `ON`; confirm five rows with CHN01 and DEL01 at 0.

### Part B: practice queries, reading (75 minutes)

1. Every product with its rate as a percentage with two decimals, cheapest first.
2. Customers born before 1 January 1990, oldest first.
3. The number of customers per KYC status.
4. Every application at DEL01 with the customer's name and the product's name.
5. Branches that have no customers (use `NOT EXISTS`).
6. Total principal disbursed per product, from `loans`, showing 0 for products with no loans.
7. Customers with more than one application.
8. The single largest application in each branch (hint: PostgreSQL's `DISTINCT ON (col)` keeps the first row per value of `col` in `ORDER BY` order).
9. Unpaid repayments (`DUE` or `OVERDUE`) with the customer's name and the amount in rupees with two decimals, earliest due date first.
10. For each loan: the number of paid installments and the paise paid so far (use a LEFT JOIN and `FILTER`).
11. Customers who hold no loan at all. Use `NOT EXISTS`, then explain why `NOT IN` would be risky.
12. The number of customers in each age band (`under 30`, `30-44`, `45+`) as of 1 January 2026, using `CASE`.

<details>
<summary>Answers 1 to 6</summary>

```sql
SELECT product_code, name, round(base_rate_bp / 100.0, 2) AS rate_pct
FROM products ORDER BY base_rate_bp;

SELECT full_name, dob FROM customers WHERE dob < date '1990-01-01' ORDER BY dob;

SELECT kyc_status, count(*) AS customers FROM customers GROUP BY kyc_status ORDER BY kyc_status;

SELECT a.application_id, c.full_name, p.name AS product, a.status
FROM loan_applications a
JOIN customers c ON c.customer_id = a.customer_id
JOIN products p  ON p.product_code = a.product_code
WHERE a.branch_code = 'DEL01'
ORDER BY a.application_id;

SELECT b.branch_code, b.name FROM branches b
WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.branch_code = b.branch_code);

SELECT p.product_code, coalesce(sum(l.principal_paise), 0) AS disbursed_paise
FROM products p
LEFT JOIN loans l ON l.product_code = p.product_code
GROUP BY p.product_code
ORDER BY disbursed_paise DESC, p.product_code;
```

```text
 product_code |     name      | rate_pct
--------------+---------------+----------
 HL01         | Home loan     |     8.50
 AL01         | Auto loan     |     9.25
 GL01         | Gold loan     |     9.75
 PL01         | Personal loan |    11.50
(4 rows)

  full_name  |    dob
-------------+------------
 Vikram Shah | 1979-11-30
 Arjun Nair  | 1985-09-21
 Asha Rao    | 1988-02-14
(3 rows)

 kyc_status | customers
------------+-----------
 PENDING    |         1
 REJECTED   |         1
 VERIFIED   |         4
(3 rows)

 application_id | full_name  |    product    |  status
----------------+------------+---------------+-----------
           5003 | Neha Gupta | Personal loan | SUBMITTED
           5008 | Neha Gupta | Personal loan | REJECTED
(2 rows)

 branch_code |        name
-------------+--------------------
 CHN01       | Chennai Anna Salai
(1 row)

 product_code | disbursed_paise
--------------+-----------------
 HL01         |       450000000
 AL01         |        80000000
 PL01         |        30000000
 GL01         |               0
(4 rows)
```

</details>

<details>
<summary>Answers 7 to 12</summary>

```sql
SELECT customer_id, count(*) AS applications
FROM loan_applications GROUP BY customer_id HAVING count(*) > 1 ORDER BY customer_id;

SELECT DISTINCT ON (branch_code) branch_code, application_id, amount_paise
FROM loan_applications
ORDER BY branch_code, amount_paise DESC;

SELECT r.repayment_id, c.full_name, r.due_date, round(r.amount_paise / 100.0, 2) AS rupees, r.status
FROM repayments r
JOIN loans l     ON l.loan_id = r.loan_id
JOIN customers c ON c.customer_id = l.customer_id
WHERE r.status IN ('DUE', 'OVERDUE')
ORDER BY r.due_date;

SELECT l.loan_id,
       count(r.repayment_id) FILTER (WHERE r.status = 'PAID') AS paid_installments,
       coalesce(sum(r.amount_paise) FILTER (WHERE r.status = 'PAID'), 0) AS paid_paise
FROM loans l
LEFT JOIN repayments r ON r.loan_id = l.loan_id
GROUP BY l.loan_id ORDER BY l.loan_id;

SELECT c.customer_id, c.full_name FROM customers c
WHERE NOT EXISTS (SELECT 1 FROM loans l WHERE l.customer_id = c.customer_id)
ORDER BY c.customer_id;

SELECT CASE
         WHEN age(date '2026-01-01', dob) < interval '30 years' THEN 'under 30'
         WHEN age(date '2026-01-01', dob) < interval '45 years' THEN '30-44'
         ELSE '45+'
       END AS age_band,
       count(*) AS customers
FROM customers GROUP BY age_band ORDER BY age_band;
```

```text
 customer_id | applications
-------------+--------------
        1001 |            2
        1003 |            2
        1004 |            2
(3 rows)

 branch_code | application_id | amount_paise
-------------+----------------+--------------
 BLR01       |           5004 |     80000000
 DEL01       |           5003 |     20000000
 MUM01       |           5001 |    450000000
 PUN01       |           5006 |    600000000
(4 rows)

 repayment_id | full_name  |  due_date  |  rupees  | status
--------------+------------+------------+----------+---------
         9005 | Arjun Nair | 2025-06-02 | 16705.00 | DUE
         9003 | Asha Rao   | 2025-06-10 | 39052.00 | OVERDUE
(2 rows)

 loan_id | paid_installments | paid_paise
---------+-------------------+------------
    7001 |                 2 |    7810400
    7002 |                 1 |     989300
    7003 |                 1 |    1670500
(3 rows)

 customer_id |  full_name
-------------+-------------
        1003 | Neha Gupta
        1005 | Meera Joshi
        1006 | Rohan Mehta
(3 rows)

 age_band | customers
----------+-----------
 30-44    |         4
 45+      |         1
 under 30 |         1
(3 rows)
```

On question 11: if `loans.customer_id` could ever be NULL, `customer_id NOT IN (SELECT customer_id FROM loans)` would return no rows at all, as the Layer 2 demonstration showed. Here the column is `NOT NULL`, so it would happen to work, but `NOT EXISTS` is correct regardless of the schema.

</details>

### Part C: practice queries, changing data (30 minutes)

13. Open a new branch HYD01 ("Hyderabad Banjara Hills", Hyderabad, SOUTH, opening 2026-11-01) with an UPSERT that updates `name` and `opened_on` if the code exists. Run it again with the name "Hyderabad Hitec City" and date 2026-12-01. Show the row each time with `RETURNING`.
14. In one statement, mark repayment 9005 as PAID at `2025-06-02 10:00+05:30` and reduce loan 7003's outstanding by that installment's amount. (Hint: a `WITH` clause can contain an `UPDATE ... RETURNING`, and the outer `UPDATE ... FROM` can use its output.)
15. In one set-based statement, set every ACTIVE AL01 loan's `rate_bp` to the product's base rate plus 50 bp, returning the loan ids and new rates.

<details>
<summary>Answers 13 to 15</summary>

```sql
INSERT INTO branches (branch_code, name, city, region, opened_on)
VALUES ('HYD01', 'Hyderabad Banjara Hills', 'Hyderabad', 'SOUTH', '2026-11-01')
ON CONFLICT (branch_code) DO UPDATE
  SET name = EXCLUDED.name, opened_on = EXCLUDED.opened_on
RETURNING branch_code, name, opened_on;
-- run again with 'Hyderabad Hitec City' and '2026-12-01'

WITH paid AS (
  UPDATE repayments
  SET status = 'PAID', paid_at = '2025-06-02 10:00+05:30'
  WHERE repayment_id = 9005 AND status <> 'PAID'
  RETURNING loan_id, amount_paise
)
UPDATE loans l
SET outstanding_paise = l.outstanding_paise - paid.amount_paise
FROM paid
WHERE l.loan_id = paid.loan_id
RETURNING l.loan_id, l.outstanding_paise;

UPDATE loans l
SET rate_bp = p.base_rate_bp + 50
FROM products p
WHERE p.product_code = l.product_code
  AND l.product_code = 'AL01'
  AND l.status = 'ACTIVE'
RETURNING l.loan_id, l.rate_bp;
```

```text
 branch_code |          name           | opened_on
-------------+-------------------------+------------
 HYD01       | Hyderabad Banjara Hills | 2026-11-01
(1 row)

INSERT 0 1
 branch_code |         name         | opened_on
-------------+----------------------+------------
 HYD01       | Hyderabad Hitec City | 2026-12-01
(1 row)

INSERT 0 1
 loan_id | outstanding_paise
---------+-------------------
    7003 |          77275700
(1 row)

UPDATE 1
 loan_id | rate_bp
---------+---------
    7003 |     975
(1 row)

UPDATE 1
```

Question 14 is a preview of module 6.04: both changes happen in one statement, so they succeed or fail together. The `status <> 'PAID'` guard means running it twice does not reduce the balance twice (the second run prints `UPDATE 0`). Re-run `sql02_setup.sql` now.

</details>

### Part D: measure set-based against row-by-row (30 minutes)

1. Run the three scripts from section 6 and record both `real` times.
2. Separate the two costs inside the row-by-row number. `psql -1` wraps a whole file in one transaction, so the 10,000 UPDATEs still make 10,000 round trips but only one commit:

```bash
psql -h localhost -U postgres -d lending -q -f rate_demo_setup.sql
time psql -h localhost -U postgres -d lending -1 -q -f row_by_row.sql
```

On the checking laptop this took about 5.5 seconds: far faster than autocommit (the 10,000 disk flushes are gone), still about 18 times slower than set-based (the round trips, parses and plans remain). Record your three numbers in a table: autocommit loop, single-transaction loop, set-based.
3. Divide each time by 10,000 to get a per-row cost in microseconds. Compare the single-transaction loop's per-row cost with the round-trip latencies you measured in module 5.11.
4. Drop the practice table: `DROP TABLE rate_demo;`.

### Journal

Copy [journal/TEMPLATE.md](../journal/TEMPLATE.md) to `journal/YYYY-MM-DD-sql-from-scratch.md`. Record: which practice queries you got wrong first and why (the LEFT JOIN trap and `NOT IN` are the usual ones); your three timings from Part D with per-row costs; and one sentence explaining to an interviewer where the time goes in a row-by-row loop.

## 9. Common mistakes and misconceptions

| Mistake | Why it is wrong | Bug it causes later |
|---|---|---|
| `WHERE col = NULL` | Comparisons with NULL are unknown, never true | Filters that silently match nothing |
| `NOT IN (subquery)` on a nullable column | One NULL in the list makes every row unknown | Reports that suddenly return zero rows |
| Filtering the optional table of a LEFT JOIN in `WHERE` | NULL-extended rows fail the condition and disappear | "Branches with no customers" vanish from the report |
| Mixing `AND` and `OR` without brackets | `AND` binds tighter | Rejected applications from every branch in a branch report |
| `LIMIT` without `ORDER BY` | There is no "first" in an unordered set | Pagination that repeats or skips rows |
| Integer division `amount / 12` for EMIs | `bigint / int` truncates | Paise lost on every installment |
| `UPDATE` or `DELETE` without `WHERE` | Applies to every row; no confirmation | A whole table repriced or wiped; restore from backup |
| Looping over rows in the app for a bulk change | N round trips, N plans, N commits, not atomic | Jobs that take hours and fail half-done |
| `UPDATE ... FROM` with a join that matches several rows | Only one match is used, unpredictably | Loans repriced from the wrong product version |

## 10. Resume link

- **Claim A, "SQL".** You can now write joins of all kinds, aggregates with `HAVING`, correlated subqueries, CTEs, UPSERT and window functions, and explain NULL's three-valued logic. Interviewers test exactly these with a whiteboard schema; practise by explaining your Part B answers aloud.
- **Claim H2, "moving from cursor access to set-based SQL".** Say it with numbers: "Updating 10,000 rows one statement at a time took tens of seconds; one `UPDATE ... FROM` took about 0.3 seconds. Wrapping the loop in one transaction cut it to about 5 seconds, which showed that most of the loop's cost was per-statement commits and the rest was round trips and planning." Use your own Part D numbers.
- **Claim H4, "master-table cache that removes joins from the hot path".** The three-table join in Layer 2 is the hot-path query the cache removed: the application already holds `products` and `branches` in memory, so it queries only `loan_applications`.

Likely follow-up: "When would you still process rows one at a time?" Answer: when each row needs a call to another system (an external credit bureau, a notification service), or when the per-row logic cannot be expressed in SQL; and then you batch (for example 500 rows per round trip) and make each batch restartable.

## 11. Interview questions

**Q1 (easy). What is the difference between `WHERE` and `HAVING`?**

<details>
<summary>Model answer</summary>

`WHERE` filters individual rows before grouping; it cannot use aggregates. `HAVING` filters groups after `GROUP BY` and aggregation, so it can say `HAVING count(*) > 1`. A condition that does not involve an aggregate belongs in `WHERE`, because removing rows early means less work for the grouping step.

</details>

**Q2 (easy). Explain INNER, LEFT and FULL OUTER JOIN using two small tables.**

<details>
<summary>Model answer</summary>

With branches {MUM01, DEL01, CHN01} and targets {MUM01, HYD01}: an INNER JOIN on branch code returns only matched pairs, so just MUM01. A LEFT JOIN returns every branch, with target columns NULL where there is no match: MUM01 with its target, DEL01 and CHN01 with NULLs. A FULL OUTER JOIN returns matched pairs plus unmatched rows from both sides: MUM01, DEL01 and CHN01 with NULL targets, and HYD01 with NULL branch columns. A RIGHT JOIN is a LEFT JOIN with the sides swapped, and a CROSS JOIN pairs every row with every row (3 x 2 = 6).

</details>

**Q3 (medium). Why can `NOT IN` return no rows when you expect many, and what do you use instead?**

<details>
<summary>Model answer</summary>

`x NOT IN (a, b, NULL)` expands to `x <> a AND x <> b AND x <> NULL`. The last comparison is unknown, so the conjunction is never true, and `WHERE` keeps only rows whose condition is true. If the subquery behind `NOT IN` can produce even one NULL, the result is empty. `NOT EXISTS (SELECT 1 FROM t WHERE t.col = outer.col)` does not have this problem because it only asks whether a matching row exists, and the planner turns it into an efficient anti-join. Alternatively filter the NULLs out in the subquery, but `NOT EXISTS` is the robust habit.

</details>

**Q4 (medium). A colleague's report counts verified customers per branch with a LEFT JOIN, but branches with no verified customers are missing. What is wrong?**

<details>
<summary>Model answer</summary>

The condition on the right-hand table, `c.kyc_status = 'VERIFIED'`, is in the `WHERE` clause. For a branch with no matching customers the LEFT JOIN produces one row with all customer columns NULL; the `WHERE` then evaluates `NULL = 'VERIFIED'`, which is unknown, and drops the row. The outer join has effectively become an inner join. Moving the condition into the `ON` clause restricts which customers are joined without discarding the branch, and `count(c.customer_id)` then returns 0 for those branches because `count(col)` ignores NULLs.

</details>

**Q5 (hard). You must reprice 2 million loans. A developer proposes a loop in the application that reads each loan and sends an UPDATE. Argue for a set-based approach, and say what you would do if the whole update is too big for one transaction.**

<details>
<summary>Model answer</summary>

Per row, the loop pays a network round trip, statement parsing and planning, executor start-up, and in autocommit a commit that waits for a WAL flush; that is typically milliseconds per row, so hours for 2 million rows. A single `UPDATE loans l SET rate_bp = ... FROM products p WHERE p.product_code = l.product_code AND ...` pays those fixed costs once and processes rows in a tight loop inside the server, so it is typically one to three orders of magnitude faster; in my lab 10,000 rows went from tens of seconds to about 0.3 seconds. It is also atomic and reads the products table once, so no loan sees a half-applied rate change. If one transaction is too big (long lock holding, a huge burst of WAL, a long rollback if it fails, replication lag), split it into key ranges, each a set-based UPDATE in its own transaction, record the last completed range in a control table in the same transaction, and make each range idempotent with a guard such as `AND rate_bp <> new_rate`, so the job can restart after a failure without double-applying.

</details>

## 12. Revision

- `SELECT ... FROM ... WHERE ... GROUP BY ... HAVING ... ORDER BY ... LIMIT` is written in that order but evaluated FROM, WHERE, GROUP BY, HAVING, SELECT, DISTINCT, ORDER BY, LIMIT; joins combine tables by matching values (inner, left, right, full, cross); subqueries, CTEs, CASE and window functions build reports without application loops.
- NULL is unknown: use `IS NULL`, prefer `NOT EXISTS` to `NOT IN`, put conditions on a LEFT JOIN's optional side in `ON`, and remember aggregates skip NULLs.
- Change data with `INSERT`/`UPDATE`/`DELETE ... RETURNING` and UPSERT; do bulk changes as one set-based statement (`UPDATE ... FROM`), which avoids per-row round trips, plans and commits and is atomic.

---

Previous: [Module 6.01: What a database is](module-01-what-a-database-is.md) | Next: [Module 6.03: Data modelling and normalisation](module-03-data-modelling-and-normalisation.md)
