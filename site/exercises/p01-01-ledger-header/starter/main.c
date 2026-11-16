/* main.c: print the ledger header for one account.
 * The balance arrives in paise (1 rupee = 100 paise) as an integer,
 * because money must never be stored in a floating-point type. */
#include <stdio.h>

int main(void) {
    const char *branch = "BR001";
    const char *account = "SB-1001";
    long long balance_paise = 0;

    if (scanf("%lld", &balance_paise) != 1) {
        printf("could not read the balance\n");
        return 1;
    }

    printf("Branch: %s\n", branch);
    /* TODO 1: print "Account: SB-1001" using the account variable. */
    /* TODO 2: print "Balance: 2500.75" from balance_paise using integer
     *         division (/) and remainder (%), not a double. */
    (void)account;
    return 0;
}
