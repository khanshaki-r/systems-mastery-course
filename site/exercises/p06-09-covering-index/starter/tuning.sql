-- The login query. Read the plan: which node, how many rows removed, how long?
EXPLAIN ANALYZE
SELECT user_id, status FROM app_users
WHERE branch_code = 'BR007' AND user_code = 'U00042';

-- TODO: create one index that turns this into an Index Only Scan.
-- CREATE INDEX ...

-- Then compare the plan again:
EXPLAIN ANALYZE
SELECT user_id, status FROM app_users
WHERE branch_code = 'BR007' AND user_code = 'U00042';
