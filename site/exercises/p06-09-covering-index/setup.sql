CREATE TABLE app_users (
    user_id       bigint PRIMARY KEY,
    branch_code   text NOT NULL,
    user_code     text NOT NULL,
    full_name     text NOT NULL,
    status        text NOT NULL,
    password_hash text NOT NULL,
    last_login    timestamptz
);
INSERT INTO app_users
SELECT g,
       'BR' || lpad((g % 200)::text, 3, '0'),
       'U'  || lpad((g / 200)::text, 5, '0'),
       'User ' || g,
       CASE WHEN g % 17 = 0 THEN 'LOCKED' ELSE 'ACTIVE' END,
       md5(g::text),
       NULL
FROM generate_series(1, 40000) AS g;
VACUUM ANALYZE app_users;
