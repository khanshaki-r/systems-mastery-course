CREATE OR REPLACE FUNCTION validate_loan(p_customer_id bigint, p_amount numeric, p_term int)
RETURNS text
LANGUAGE plpgsql
AS $$
BEGIN
    -- TODO: check the rules from the task, in order, and RETURN the first failure.
    RETURN 'OK';
END;
$$;

-- Try it:
SELECT validate_loan(1, 200000, 120) AS ok_case,
       validate_loan(3, 100000, 60)  AS blocked_case;
