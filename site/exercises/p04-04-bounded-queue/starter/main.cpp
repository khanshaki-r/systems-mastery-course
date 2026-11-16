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

    // Block while full. Return false (and drop v) if the queue is closed.
    bool push(T v) {
        // TODO: lock m_, wait on not_full_ until there is room or closed_,
        //       then add the item and notify a consumer.
        q_.push_back(std::move(v));
        max_seen_ = std::max(max_seen_, q_.size());
        return true;
    }

    // Block while empty. Return std::nullopt only once closed AND empty.
    std::optional<T> pop() {
        // TODO: lock m_, wait on not_empty_ until there is an item or closed_,
        //       then take the item and notify a producer.
        if (q_.empty()) return std::nullopt;
        T v = std::move(q_.front());
        q_.pop_front();
        return v;
    }

    // Wake everybody: producers stop, consumers drain what is left and stop.
    void close() {
        // TODO: lock, set closed_, notify_all on both condition variables.
        closed_ = true;
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
