-- The tables customers and loans already exist. Look around first:
SELECT * FROM loans ORDER BY loan_id;

-- TODO: approved loans of at least 500000, with the customer's name.
-- Columns: loan_id, full_name, amount. Largest amount first, then loan_id.
SELECT loan_id, amount
FROM loans;
