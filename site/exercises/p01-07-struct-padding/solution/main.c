/* main.c: make struct LoanRecord as small as possible. */
#include <stdint.h>
#include <stdio.h>

/* Largest alignment first: 8, 8, 4, 2, 1, 1 = 24 bytes, and 24 is already a
 * multiple of the struct's alignment (8), so there is no tail padding either. */
struct LoanRecord {
    int64_t loan_id;       /* offset 0  */
    double  amount;        /* offset 8  */
    int32_t term_months;   /* offset 16 */
    int16_t branch_no;     /* offset 20 */
    char    status;        /* offset 22 */
    char    type;          /* offset 23 */
};

int main(void) {
    size_t data = sizeof(char) + sizeof(double) + sizeof(char) + sizeof(int32_t) + sizeof(int16_t) + sizeof(int64_t);
    struct LoanRecord r = { .status = 'A', .amount = 250000.0, .type = 'H',
                            .term_months = 240, .branch_no = 7, .loan_id = 900001 };

    printf("sizeof(struct LoanRecord) = %zu\n", sizeof r);
    printf("bytes of real data        = %zu\n", data);
    printf("bytes of padding          = %zu\n", sizeof r - data);
    printf("loan %lld: %c %c %.2f for %d months at branch %d\n",
           (long long)r.loan_id, r.status, r.type, r.amount, r.term_months, r.branch_no);
    return 0;
}
