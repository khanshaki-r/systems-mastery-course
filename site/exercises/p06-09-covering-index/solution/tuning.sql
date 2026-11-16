EXPLAIN ANALYZE
SELECT user_id, status FROM app_users
WHERE branch_code = 'BR007' AND user_code = 'U00042';

-- Equality on both key columns; branch_code first so branch-only lookups can use it too.
-- INCLUDE stores the returned columns in the leaf pages, so the heap is never visited.
CREATE INDEX app_users_login_idx
    ON app_users (branch_code, user_code)
    INCLUDE (user_id, status);

EXPLAIN ANALYZE
SELECT user_id, status FROM app_users
WHERE branch_code = 'BR007' AND user_code = 'U00042';
