/* main.c: greatest common divisor, recursively. */
#include <stdio.h>

/* TODO: Euclid's algorithm, recursively:
 *   gcd(a, 0) = a
 *   gcd(a, b) = gcd(b, a % b)              */
static long long gcd(long long a, long long b) {
    (void)a;
    (void)b;
    return 1;
}

int main(void) {
    long long a, b;
    while (scanf("%lld %lld", &a, &b) == 2) {
        long long g = gcd(a, b);
        printf("gcd(%lld, %lld) = %lld, ratio %lld:%lld\n", a, b, g, a / g, b / g);
    }
    return 0;
}
