/* main.c: simple interest on a loan, computed exactly in paise. */
#include <stdio.h>

int main(void) {
    /* long long is at least 64 bits: up to 9.2 * 10^18, plenty for these products */
    long long principal_rupees, rate_bps, months;
    if (scanf("%lld %lld %lld", &principal_rupees, &rate_bps, &months) != 3) {
        printf("expected: principal_rupees rate_bps months\n");
        return 1;
    }

    long long principal_paise = principal_rupees * 100;
    /* multiply first, divide once: only the final fraction of a paisa is lost */
    long long interest_paise = principal_paise * rate_bps * months / (10000 * 12);

    printf("interest = %lld.%02lld rupees\n", interest_paise / 100, interest_paise % 100);
    return 0;
}
