CREATE TABLE customers (
    customer_id bigint PRIMARY KEY,
    full_name   text NOT NULL,
    city        text NOT NULL,
    kyc_status  text NOT NULL
);
CREATE TABLE loans (
    loan_id     bigint PRIMARY KEY,
    customer_id bigint NOT NULL REFERENCES customers,
    branch_code text NOT NULL,
    product     text NOT NULL,
    amount      numeric(14,2) NOT NULL,
    status      text NOT NULL,
    applied_on  date NOT NULL
);
INSERT INTO customers VALUES
 (1, 'Asha Verma',   'Noida',   'VERIFIED'),
 (2, 'Ravi Kumar',   'Delhi',   'VERIFIED'),
 (3, 'Meera Iyer',   'Pune',    'PENDING'),
 (4, 'Imran Khan',   'Lucknow', 'VERIFIED'),
 (5, 'Sara Thomas',  'Kochi',   'VERIFIED'),
 (6, 'Dev Malhotra', 'Noida',   'REJECTED');
INSERT INTO loans VALUES
 (101, 1, 'BR001', 'HOME',     2500000,   'APPROVED',  '2026-09-02'),
 (102, 1, 'BR001', 'PERSONAL',  300000,   'DISBURSED', '2026-09-10'),
 (103, 2, 'BR002', 'HOME',     1800000,   'APPROVED',  '2026-09-15'),
 (104, 3, 'BR003', 'GOLD',      150000,   'PENDING',   '2026-10-01'),
 (105, 4, 'BR002', 'PERSONAL',  500000,   'APPROVED',  '2026-10-03'),
 (106, 5, 'BR001', 'HOME',      500000,   'APPROVED',  '2026-10-05'),
 (107, 6, 'BR003', 'PERSONAL',  700000,   'REJECTED',  '2026-10-07'),
 (108, 2, 'BR002', 'GOLD',      450000,   'APPROVED',  '2026-10-11'),
 (109, 4, 'BR001', 'HOME',     1800000,   'DISBURSED', '2026-10-20'),
 (110, 5, 'BR003', 'PERSONAL',  999999.50,'APPROVED',  '2026-10-28'),
 (111, 3, 'BR002', 'HOME',     3200000,   'PENDING',   '2026-11-02'),
 (112, 1, 'BR003', 'GOLD',      600000,   'APPROVED',  '2026-11-04');
