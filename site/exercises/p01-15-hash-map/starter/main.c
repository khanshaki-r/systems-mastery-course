/* main.c: a string -> long long hash map with separate chaining. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NBUCKETS 16   /* small on purpose, so keys collide and chains form */

typedef struct Entry {
    char         *key;     /* owned: allocated by map_put, freed by map_del / map_free */
    long long     value;
    struct Entry *next;    /* next entry in the same bucket */
} Entry;

typedef struct {
    Entry  *buckets[NBUCKETS];
    size_t  count;
} Map;

/* FNV-1a: a simple, decent string hash. */
static unsigned long hash(const char *s) {
    unsigned long h = 2166136261u;
    for (; *s; s++) {
        h ^= (unsigned char)*s;
        h *= 16777619u;
    }
    return h;
}

/* Insert key -> value, or update the value if key exists. 0 on success, -1 if out of memory. */
static int map_put(Map *m, const char *key, long long value) {
    /* TODO */
    (void)m; (void)value; (void)hash(key);
    return 0;
}

/* Address of the value stored for key, or NULL if key is absent. */
static const long long *map_get(const Map *m, const char *key) {
    /* TODO */
    (void)m; (void)key;
    return NULL;
}

/* Remove key. Return 1 if it was there, 0 if not. */
static int map_del(Map *m, const char *key) {
    /* TODO */
    (void)m; (void)key;
    return 0;
}

/* Free every entry and every key. */
static void map_free(Map *m) {
    /* TODO */
    (void)m;
}

int main(void) {
    Map m;
    memset(&m, 0, sizeof m);
    char line[256], cmd[16], key[128];
    long long value;
    while (fgets(line, sizeof line, stdin) != NULL) {
        int n = sscanf(line, "%15s %127s %lld", cmd, key, &value);
        if (n == 3 && strcmp(cmd, "PUT") == 0) {
            puts(map_put(&m, key, value) == 0 ? "OK" : "ERR out of memory");
        } else if (n == 2 && strcmp(cmd, "GET") == 0) {
            const long long *v = map_get(&m, key);
            if (v != NULL) printf("%lld\n", *v);
            else puts("(nil)");
        } else if (n == 2 && strcmp(cmd, "DEL") == 0) {
            printf("%d\n", map_del(&m, key));
        } else if (n >= 1 && strcmp(cmd, "COUNT") == 0) {
            printf("%zu\n", m.count);
        } else if (n >= 1) {
            puts("ERR");
        }
    }
    map_free(&m);
    return 0;
}
