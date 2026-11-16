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

static unsigned long hash(const char *s) {
    unsigned long h = 2166136261u;
    for (; *s; s++) {
        h ^= (unsigned char)*s;
        h *= 16777619u;
    }
    return h;
}

/* Address of the link that points at key's entry, or at the NULL ending the chain.
 * Writing through it inserts or unlinks without special cases for the first node. */
static Entry **find_link(Map *m, const char *key) {
    Entry **link = &m->buckets[hash(key) % NBUCKETS];
    while (*link != NULL && strcmp((*link)->key, key) != 0) link = &(*link)->next;
    return link;
}

static int map_put(Map *m, const char *key, long long value) {
    Entry **link = find_link(m, key);
    if (*link != NULL) {                      /* existing key: update in place */
        (*link)->value = value;
        return 0;
    }
    Entry *e = malloc(sizeof *e);
    if (e == NULL) return -1;
    size_t len = strlen(key) + 1;
    e->key = malloc(len);
    if (e->key == NULL) { free(e); return -1; }
    memcpy(e->key, key, len);
    e->value = value;
    e->next = NULL;
    *link = e;                                /* append at the end of the chain */
    m->count++;
    return 0;
}

static const long long *map_get(const Map *m, const char *key) {
    for (const Entry *e = m->buckets[hash(key) % NBUCKETS]; e != NULL; e = e->next) {
        if (strcmp(e->key, key) == 0) return &e->value;
    }
    return NULL;
}

static int map_del(Map *m, const char *key) {
    Entry **link = find_link(m, key);
    Entry *e = *link;
    if (e == NULL) return 0;
    *link = e->next;                          /* unlink */
    free(e->key);
    free(e);
    m->count--;
    return 1;
}

static void map_free(Map *m) {
    for (size_t i = 0; i < NBUCKETS; i++) {
        Entry *e = m->buckets[i];
        while (e != NULL) {
            Entry *next = e->next;            /* read next BEFORE freeing e */
            free(e->key);
            free(e);
            e = next;
        }
        m->buckets[i] = NULL;
    }
    m->count = 0;
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
