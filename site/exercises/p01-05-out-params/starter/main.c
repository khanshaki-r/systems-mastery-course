/* main.c: out-parameters and pointer-to-pointer. */
#include <stdio.h>

/* Split `amount` paise into `parts` equal shares.
 * On success: store the share in *share and what is left over in *remainder,
 * and return 0. If parts <= 0 or amount < 0, change nothing and return -1. */
static int divide_paise(long long amount, long long parts, long long *share, long long *remainder) {
    /* TODO */
    (void)amount; (void)parts; (void)share; (void)remainder;
    return -1;
}

/* Make *biggest point at whichever of *a and *b holds the larger value (a on a tie). */
static void point_at_bigger(const long long **biggest, const long long *a, const long long *b) {
    /* TODO */
    (void)biggest; (void)a; (void)b;
}

int main(void) {
    long long amount, parts;
    while (scanf("%lld %lld", &amount, &parts) == 2) {
        long long share = 0, rest = 0;
        if (divide_paise(amount, parts, &share, &rest) != 0) {
            printf("invalid: %lld / %lld\n", amount, parts);
            continue;
        }
        printf("%lld / %lld = %lld each, remainder %lld\n", amount, parts, share, rest);

        const long long *bigger = NULL;
        point_at_bigger(&bigger, &share, &rest);
        if (bigger != NULL) printf("larger of share and remainder: %lld\n", *bigger);
        else printf("larger of share and remainder: (not set)\n");
    }
    return 0;
}
