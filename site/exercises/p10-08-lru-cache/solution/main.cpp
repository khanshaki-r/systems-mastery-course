// main.cpp: least-recently-used cache with O(1) get and put.
#include <iostream>
#include <list>
#include <optional>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

class LRUCache {
public:
    explicit LRUCache(std::size_t capacity) : cap_(capacity) {}

    std::optional<int> get(const std::string& key) {
        auto it = index_.find(key);
        if (it == index_.end()) return std::nullopt;
        list_.splice(list_.begin(), list_, it->second);   // move node to front; iterators stay valid
        return it->second->second;
    }

    std::optional<std::string> put(const std::string& key, int value) {
        auto it = index_.find(key);
        if (it != index_.end()) {                          // update: never evicts
            it->second->second = value;
            list_.splice(list_.begin(), list_, it->second);
            return std::nullopt;
        }
        std::optional<std::string> evicted;
        if (list_.size() == cap_) {                        // new key into a full cache
            evicted = list_.back().first;
            index_.erase(list_.back().first);              // erase from the map BEFORE the node goes away
            list_.pop_back();
        }
        list_.emplace_front(key, value);
        index_[key] = list_.begin();
        return evicted;
    }

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
