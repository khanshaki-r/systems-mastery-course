## Task

Card numbers and many account numbers end in a **check digit** computed with the Luhn algorithm, so a typo is caught before any database lookup. For each input line print `<line>: VALID` or `<line>: INVALID`.

The Luhn check:

1. Ignore spaces. Any other character that is not `0`-`9` makes the number invalid. Fewer than 2 digits is invalid.
2. Starting from the **rightmost** digit, double every second digit (the 2nd, 4th, 6th ... from the right). If doubling gives more than 9, subtract 9.
3. Add up all the digits. The number is valid when the total is a multiple of 10.

Example: `79927398713` is valid; change the last digit to 0 and it is not.

The input-reading loop in `main` is done for you; write `luhn_valid`.
