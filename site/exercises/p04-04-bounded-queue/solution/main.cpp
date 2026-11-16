// main.cpp: a blocking bounded queue for producer/consumer hand-off.
#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <iostream>
#include <mutex>
#include <optional>
#include <thread>
#include <vector>

template <typename T>
class BoundedQueue {
public:
    explicit BoundedQueue(std::size_t capacity) : cap_(capacity) {}

    bool push(T v) {
        std::unique_lock<std::mutex> lk(m_);
        not_full_.wait(lk, [&] { return closed_ || q_.size() < cap_; });   // re-checks after every wake-up
        if (closed_) return false;
        q_.push_back(std::move(v));
        max_seen_ = std::max(max_seen_, q_.size());
        lk.unlock();                    // notify after unlocking so the woken thread can take the lock at once
        not_empty_.notify_one();
        return true;
    }

    std::optional<T> pop() {
        std::unique_lock<std::mutex> lk(m_);
        not_empty_.wait(lk, [&] { return closed_ || !q_.empty(); });
        if (q_.empty()) return std::nullopt;     // closed and fully drained
        T v = std::move(q_.front());
        q_.pop_front();
        lk.unlock();
        not_full_.notify_one();
        return v;
    }

    void close() {
        {
            std::lock_guard<std::mutex> lk(m_);
            closed_ = true;
        }
        not_full_.notify_all();
        not_empty_.notify_all();
    }

    std::size_t max_seen() const {
        std::lock_guard<std::mutex> lk(m_);
        return max_seen_;
    }

private:
    mutable std::mutex m_;
    std::condition_variable not_full_;
    std::condition_variable not_empty_;
    std::deque<T> q_;
    const std::size_t cap_;
    std::size_t max_seen_ = 0;
    bool closed_ = false;
};

int main() {
    BoundedQueue<long long> q(8);
    std::atomic<long long> sum{0};
    std::atomic<int> items{0};

    std::vector<std::thread> consumers;
    for (int c = 0; c < 3; ++c) {
        consumers.emplace_back([&] {
            while (auto v = q.pop()) {
                sum += *v;
                ++items;
            }
        });
    }
    std::vector<std::thread> producers;
    for (int p = 0; p < 2; ++p) {
        producers.emplace_back([&] {
            for (long long i = 1; i <= 1000; ++i) q.push(i);
        });
    }
    for (auto& t : producers) t.join();
    q.close();
    for (auto& t : consumers) t.join();

    std::cout << "consumed " << items.load() << " items, sum = " << sum.load() << "\n";
    std::cout << "queue never exceeded capacity: " << (q.max_seen() <= 8 ? "yes" : "no") << "\n";
    return 0;
}
