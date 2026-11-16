// main.cpp: the tcpkv store, shared by reader and writer threads.
#include <atomic>
#include <iostream>
#include <mutex>
#include <optional>
#include <shared_mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

class Store {
public:
    std::optional<std::string> get(const std::string& key) const {
        std::shared_lock<std::shared_mutex> lk(m_);     // many readers together
        auto it = map_.find(key);
        if (it == map_.end()) return std::nullopt;
        return it->second;                              // copy out while still locked
    }

    void set(const std::string& key, std::string value) {
        std::unique_lock<std::shared_mutex> lk(m_);     // writers are alone
        map_[key] = std::move(value);
    }

    std::size_t size() const {
        std::shared_lock<std::shared_mutex> lk(m_);
        return map_.size();
    }

private:
    mutable std::shared_mutex m_;
    std::unordered_map<std::string, std::string> map_;
};

int main() {
    Store s;
    std::atomic<int> reads{0};
    std::vector<std::thread> threads;
    for (int w = 0; w < 2; ++w) {
        threads.emplace_back([&s, w] {
            for (int i = 0; i < 500; ++i) s.set("acct:" + std::to_string(w) + ":" + std::to_string(i), std::to_string(i));
        });
    }
    for (int r = 0; r < 4; ++r) {
        threads.emplace_back([&s, &reads] {
            int hits = 0;
            for (int i = 0; i < 2000; ++i) {
                if (s.get("acct:0:" + std::to_string(i % 500))) ++hits;
            }
            (void)hits;
            reads += 2000;
        });
    }
    for (auto& t : threads) t.join();
    std::cout << "size = " << s.size() << "\n";
    std::cout << "acct:1:499 = " << s.get("acct:1:499").value_or("(nil)") << "\n";
    std::cout << "missing = " << s.get("missing").value_or("(nil)") << "\n";
    std::cout << "reads done = " << reads.load() << "\n";
    return 0;
}
