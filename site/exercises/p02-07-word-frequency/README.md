## Task

The first line is `k`. The rest is free text. Print the `k` most frequent words as `word count`, most frequent first. When counts tie, order the words alphabetically.

- A word is a run of letters `A`-`Z` / `a`-`z`. Everything else separates words, including digits and punctuation.
- Words are case-insensitive: count them in lower case.
- If there are fewer than `k` distinct words, print them all.

```text
3
The loan was approved. The LOAN amount: 500000.
Approved loans: the best loans!
```

gives

```text
the 3
approved 2
loan 2
```

This is how you would find the commonest error messages in a day of logs during incident triage. The two-key sort is the part people get wrong.
