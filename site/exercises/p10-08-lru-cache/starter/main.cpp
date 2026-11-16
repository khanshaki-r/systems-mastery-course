// main.cpp: least-recently-used cache with O(1) get and put.
#include <iostream>
#include <list>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

// list_ keeps (key, value) from most recent (front) to least recent (back).
// index_ maps a key to its node in list_, so it can be moved to the front in O(1).
class LRUCache {
public:
    explicit LRUCache(std::size_t capacity) : cap_(capacity) {}

    // Value for key (and make key the most recent), or nullopt.
    std::optional<int> get(const std::string& key) {
        (void)key;   // TODO
        return std::nullopt;
    }

    // Insert or update key (making it the most recent). If a NEW key does not
    // fit, first evict the least recently used key and return its name.
    std::optional<std::string> put(const std::string& key, int value) {
        (void)key;   // TODO
        (void)value;
        return std::nullopt;
    }

    // Keys from most to least recently used.
    std::vector<std::string> keys() const {
        std::vector<std::string> out;
        for (const auto& kv : list_) out.push_back(kv.first);
        return out;
    }

private:
    std::size_t cap_;
    std::list<std::pair<std::string, int>> list_;
    std::unordered_map<std::string, std::list<std::pair<std::string, int>>::iterator> index_;
};

int main() {
    std::size_t cap;
    if (!(std::cin >> cap) || cap == 0) return 1;
    LRUCache cache(cap);
    std::string cmd, key;
    while (std::cin >> cmd >> key) {
        if (cmd == "GET") {
            auto v = cache.get(key);
            std::cout << (v ? std::to_string(*v) : "-1") << "\n";
        } else if (cmd == "PUT") {
            int value = 0;
            std::cin >> value;
            auto evicted = cache.put(key, value);
            std::cout << "OK" << (evicted ? " (evicted " + *evicted + ")" : "") << "\n";
        }
    }
    std::cout << "keys (most recent first):";
    for (const auto& k : cache.keys()) std::cout << " " << k;
    std::cout << "\n";
    return 0;
}
