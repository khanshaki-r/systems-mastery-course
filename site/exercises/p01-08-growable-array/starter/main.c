/* main.c: a growable array of amounts. */
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    long long *data;   /* heap block holding cap items, or NULL */
    size_t     len;    /* items in use */
    size_t     cap;    /* items the block can hold */
} Vec;

/* Append x. When the block is full, grow it with realloc:
 * capacity 0 -> 4 -> 8 -> 16 -> ... (double each time).
 * Return 0 on success, -1 if memory runs out (v must stay valid). */
static int vec_push(Vec *v, long long x) {
    /* TODO: grow the block when v->len == v->cap */
    v->data[v->len++] = x;
    return 0;
}

/* Release the block and reset v to empty. */
static void vec_free(Vec *v) {
    /* TODO */
    (void)v;
}

int main(void) {
    Vec v = { NULL, 0, 0 };
    long long x;
    while (scanf("%lld", &x) == 1) {
        if (vec_push(&v, x) != 0) {
            fprintf(stderr, "out of memory\n");
            vec_free(&v);
            return 1;
        }
    }

    long long sum = 0, max = 0;
    for (size_t i = 0; i < v.len; i++) {
        sum += v.data[i];
        if (i == 0 || v.data[i] > max) max = v.data[i];
    }
    if (v.len == 0) printf("count=0 capacity=%zu sum=0 max=none\n", v.cap);
    else printf("count=%zu capacity=%zu sum=%lld max=%lld\n", v.len, v.cap, sum, max);

    vec_free(&v);
    return 0;
}
