/* main.c: out-parameters and pointer-to-pointer. */
#include <stdio.h>

static int divide_paise(long long amount, long long parts, long long *share, long long *remainder) {
    if (parts <= 0 || amount < 0) return -1;   /* validate before touching the outputs */
    *share = amount / parts;                    /* writes into the caller's variable */
    *remainder = amount % parts;
    return 0;
}

static void point_at_bigger(const long long **biggest, const long long *a, const long long *b) {
    /* *biggest IS the caller's pointer variable: assigning it re-aims the caller's pointer */
    *biggest = (*b > *a) ? b : a;
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
