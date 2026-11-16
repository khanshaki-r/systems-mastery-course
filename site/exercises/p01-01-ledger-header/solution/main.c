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
    printf("Account: %s\n", account);
    /* 250075 / 100 = 2500 rupees, 250075 % 100 = 75 paise; %02lld keeps "05" as two digits */
    printf("Balance: %lld.%02lld\n", balance_paise / 100, balance_paise % 100);
    return 0;
}
