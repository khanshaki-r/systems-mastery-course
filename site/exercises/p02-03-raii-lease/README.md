## Task

A `Lease` stands for something that must be given back: a row lock on a loan record, a pooled database connection, a file descriptor. Make it an **RAII** type (module 2.03):

1. The constructor prints `acquire <id>`.
2. The destructor prints `release <id>`.
3. Copying is forbidden. Two copies would release the same resource twice.

`process()` never calls anything like `release()`. Your destructor must do it on the normal path **and** when `process()` throws. Read the expected output in the Tests tab carefully; the order of the lines is the lesson.

The starter does not compile yet. The `static_assert`s at the bottom of the class enforce rule 3. Reading the compiler's error and fixing it is step one.
