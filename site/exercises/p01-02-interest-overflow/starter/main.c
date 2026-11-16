/* main.c: simple interest on a loan, computed exactly in paise. */
#include <stdio.h>

int main(void) {
    int principal_rupees, rate_bps, months;          /* TODO: are these types big enough? */
    if (scanf("%d %d %d", &principal_rupees, &rate_bps, &months) != 3) {
        printf("expected: principal_rupees rate_bps months\n");
        return 1;
    }

    /* interest_paise = principal_paise * rate_bps * months / (10000 * 12) */
    int principal_paise = principal_rupees * 100;
    int interest_paise = principal_paise * rate_bps * months / (10000 * 12);

    printf("interest = %d.%02d rupees\n", interest_paise / 100, interest_paise % 100);
    return 0;
}
