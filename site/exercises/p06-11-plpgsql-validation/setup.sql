CREATE TABLE customers (
    customer_id    bigint PRIMARY KEY,
    full_name      text NOT NULL,
    blocked        boolean NOT NULL DEFAULT false,
    exposure_limit numeric(14,2) NOT NULL
);
CREATE TABLE loans (
    loan_id     bigint PRIMARY KEY,
    customer_id bigint NOT NULL REFERENCES customers,
    amount      numeric(14,2) NOT NULL,
    status      text NOT NULL
);
INSERT INTO customers VALUES
 (1, 'Asha Verma',   false, 1000000),
 (2, 'Ravi Kumar',   false, 1000000),
 (3, 'Dev Malhotra', true,  5000000),
 (4, 'Sara Thomas',  false,  300000);
INSERT INTO loans VALUES
 (1, 1, 300000, 'APPROVED'),
 (2, 1, 200000, 'DISBURSED'),
 (3, 1, 900000, 'REJECTED'),
 (4, 2, 400000, 'APPROVED'),
 (5, 2, 100000, 'CLOSED');
