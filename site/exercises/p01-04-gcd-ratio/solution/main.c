/* main.c: greatest common divisor, recursively. */
#include <stdio.h>

/* Each call gets a new stack frame with its own a and b.
 * gcd(1071, 462) -> gcd(462, 147) -> gcd(147, 21) -> gcd(21, 0) = 21 */
static long long gcd(long long a, long long b) {
    if (b == 0) return a;
    return gcd(b, a % b);
}

int main(void) {
    long long a, b;
    while (scanf("%lld %lld", &a, &b) == 2) {
        long long g = gcd(a, b);
        printf("gcd(%lld, %lld) = %lld, ratio %lld:%lld\n", a, b, g, a / g, b / g);
    }
    return 0;
}
