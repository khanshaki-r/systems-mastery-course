/* main.c: validate numbers with the Luhn check digit. */
#include <stdio.h>
#include <string.h>

/* Return 1 if s is a valid number under the Luhn check, else 0.
 * Spaces are ignored. Any other non-digit makes it invalid.
 * Fewer than 2 digits is invalid. */
static int luhn_valid(const char *s) {
    /* TODO:
     * 1. Collect the digits (skip spaces, reject anything else).
     * 2. Walk them from the RIGHT. Double every second digit
     *    (2nd, 4th, ... from the right); if that gives > 9, subtract 9.
     * 3. Valid when the total is a multiple of 10. */
    (void)s;
    return 0;
}

int main(void) {
    char line[256];
    while (fgets(line, sizeof line, stdin) != NULL) {
        line[strcspn(line, "\r\n")] = '\0';     /* drop the newline */
        printf("%s: %s\n", line, luhn_valid(line) ? "VALID" : "INVALID");
    }
    return 0;
}
