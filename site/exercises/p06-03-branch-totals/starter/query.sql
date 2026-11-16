-- TODO: per branch, the number and total amount of APPROVED or DISBURSED loans,
-- only for branches with at least 3 such loans. Biggest total first, then branch_code.
SELECT branch_code, count(*)
FROM loans
GROUP BY branch_code;
