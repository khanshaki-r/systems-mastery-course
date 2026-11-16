CREATE OR REPLACE FUNCTION validate_loan(p_customer_id bigint, p_amount numeric, p_term int)
RETURNS text
LANGUAGE plpgsql
STABLE                      -- reads tables, changes nothing
AS $$
DECLARE
    v_customer customers%ROWTYPE;
    v_exposure numeric;
BEGIN
    SELECT * INTO v_customer FROM customers WHERE customer_id = p_customer_id;
    IF NOT FOUND THEN
        RETURN 'NO_CUSTOMER';
    END IF;

    IF v_customer.blocked THEN
        RETURN 'BLOCKED';
    END IF;

    IF p_amount < 10000 OR p_amount > 5000000 THEN
        RETURN 'AMOUNT_OUT_OF_RANGE';
    END IF;

    IF p_term < 6 OR p_term > 360 THEN
        RETURN 'TERM_OUT_OF_RANGE';
    END IF;

    SELECT COALESCE(sum(amount), 0) INTO v_exposure      -- no loans: 0, not NULL
      FROM loans
     WHERE customer_id = p_customer_id
       AND status IN ('APPROVED', 'DISBURSED');

    IF v_exposure + p_amount > v_customer.exposure_limit THEN
        RETURN 'EXPOSURE_LIMIT';
    END IF;

    RETURN 'OK';
END;
$$;

SELECT validate_loan(1, 200000, 120) AS ok_case,
       validate_loan(3, 100000, 60)  AS blocked_case;
