/* main.c: make struct LoanRecord as small as possible. */
#include <stdint.h>
#include <stdio.h>

/* TODO: reorder these fields to remove the padding.
 * Keep every field, its name and its type. Press "Layout" to see the bytes. */
struct LoanRecord {
    char    status;        /* 'N' new, 'A' approved, 'R' rejected */
    double  amount;        /* rupees */
    char    type;          /* 'H' home, 'P' personal, 'G' gold */
    int32_t term_months;
    int16_t branch_no;
    int64_t loan_id;
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
