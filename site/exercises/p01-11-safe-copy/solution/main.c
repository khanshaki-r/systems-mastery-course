/* main.c: copy ids into a fixed-size buffer, safely. */
#include <stdio.h>
#include <string.h>

static int copy_id(char *dst, size_t cap, const char *src) {
    if (cap == 0) return -1;                  /* not even room for the terminator */
    size_t n = strlen(src);
    int truncated = n > cap - 1;
    if (truncated) n = cap - 1;
    memcpy(dst, src, n);
    dst[n] = '\0';                            /* always terminated */
    return truncated;
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
