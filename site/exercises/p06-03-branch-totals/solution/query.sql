SELECT branch_code, count(*) AS live_loans, sum(amount) AS total_amount
FROM loans
WHERE status IN ('APPROVED', 'DISBURSED')     -- filter rows first
GROUP BY branch_code
HAVING count(*) >= 3                          -- then filter groups
ORDER BY total_amount DESC, branch_code;
