/* main.c: classify loan amounts into bands. */
#include <stdio.h>
#include <string.h>

static const char *classify(long long amount) {
    if (amount <= 0) return "invalid";
    if (amount < 50000) return "micro";
    if (amount < 500000) return "small";
    if (amount < 5000000) return "medium";
    return "large";
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
        if (strcmp(cls, "micro") == 0) micro++;
        else if (strcmp(cls, "small") == 0) small++;
        else if (strcmp(cls, "medium") == 0) medium++;
        else if (strcmp(cls, "large") == 0) large++;
        else invalid++;
    }
    printf("micro=%d small=%d medium=%d large=%d invalid=%d\n", micro, small, medium, large, invalid);
    return 0;
}
