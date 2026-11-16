SELECT l.loan_id, c.full_name, l.amount
FROM loans l
JOIN customers c ON c.customer_id = l.customer_id
WHERE l.status = 'APPROVED'
  AND l.amount >= 500000
ORDER BY l.amount DESC, l.loan_id;
