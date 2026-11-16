/* main.c: validate numbers with the Luhn check digit. */
#include <stdio.h>
#include <string.h>

static int luhn_valid(const char *s) {
    int digits[128];
    int n = 0;
    for (const char *p = s; *p != '\0'; p++) {
        if (*p == ' ') continue;
        if (*p < '0' || *p > '9') return 0;
        if (n == (int)(sizeof digits / sizeof digits[0])) return 0;   /* too long: refuse, never overflow */
        digits[n++] = *p - '0';                                        /* '7' - '0' == 7 */
    }
    if (n < 2) return 0;

    int sum = 0;
    for (int i = n - 1, pos = 0; i >= 0; i--, pos++) {
        int d = digits[i];
        if (pos % 2 == 1) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
    }
    return sum % 10 == 0;
}

int main(void) {
    char line[256];
    while (fgets(line, sizeof line, stdin) != NULL) {
        line[strcspn(line, "\r\n")] = '\0';
        printf("%s: %s\n", line, luhn_valid(line) ? "VALID" : "INVALID");
    }
    return 0;
}
