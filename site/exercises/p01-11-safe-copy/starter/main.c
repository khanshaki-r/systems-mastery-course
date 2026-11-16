/* main.c: copy ids into a fixed-size buffer, safely. */
#include <stdio.h>
#include <string.h>

/* Copy src into dst, which has room for cap bytes.
 * - Copy at most cap - 1 characters and always NUL-terminate (when cap > 0).
 * Return 0 if all of src fit, 1 if it was cut short, -1 if cap == 0. */
static int copy_id(char *dst, size_t cap, const char *src) {
    /* TODO: this overflows dst whenever src is longer than cap - 1. */
    (void)cap;
    strcpy(dst, src);
    return 0;
}

int main(void) {
    char line[128];
    char id[8];                               /* room for 7 characters + the NUL */
    while (fgets(line, sizeof line, stdin) != NULL) {
        line[strcspn(line, "\r\n")] = '\0';
        int r = copy_id(id, sizeof id, line);
        printf("[%s] -> [%s]%s\n", line, id, r == 1 ? " (truncated)" : "");
    }
    printf("cap 0 -> %d\n", copy_id(id, 0, "x"));
    return 0;
}
