/* main.c: a growable array of amounts. */
#include <stdio.h>
#include <stdlib.h>

typedef struct {
    long long *data;   /* heap block holding cap items, or NULL */
    size_t     len;    /* items in use */
    size_t     cap;    /* items the block can hold */
} Vec;

static int vec_push(Vec *v, long long x) {
    if (v->len == v->cap) {
        size_t new_cap = v->cap == 0 ? 4 : v->cap * 2;
        long long *p = realloc(v->data, new_cap * sizeof *p);   /* realloc(NULL, n) acts like malloc */
        if (p == NULL) return -1;     /* the old block is still valid and still owned by v */
        v->data = p;
        v->cap = new_cap;
    }
    v->data[v->len++] = x;
    return 0;
}

static void vec_free(Vec *v) {
    free(v->data);                    /* free(NULL) is allowed and does nothing */
    v->data = NULL;
    v->len = 0;
    v->cap = 0;
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
