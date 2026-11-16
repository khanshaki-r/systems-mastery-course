/* main.c: classify loan amounts into bands. */
#include <stdio.h>

/* TODO: return "invalid", "micro", "small", "medium" or "large". */
static const char *classify(long long amount) {
    (void)amount;
    return "?";
}

int main(void) {
    int n;
    if (scanf("%d", &n) != 1 || n < 0) return 1;

    int micro = 0, small = 0, medium = 0, large = 0, invalid = 0;
    for (int i = 0; i < n; i++) {
        long long amount;
        if (scanf("%lld", &amount) != 1) return 1;
        const char *cls = classify(amount);
        printf("%lld: %s\n", amount, cls);
        /* TODO: add one to the right counter */
    }
    printf("micro=%d small=%d medium=%d large=%d invalid=%d\n", micro, small, medium, large, invalid);
    return 0;
}
