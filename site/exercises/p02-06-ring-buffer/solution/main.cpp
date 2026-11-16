// main.cpp: RingBuffer<T, N> keeps the newest N items.
#include <array>
#include <cstddef>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>

template <typename T, std::size_t N>
class RingBuffer {
    static_assert(N > 0, "capacity must be at least 1");

public:
    void push(T value) {
        if (count_ < N) {
            items_[(head_ + count_) % N] = std::move(value);   // next free slot
            ++count_;
        } else {
            items_[head_] = std::move(value);                  // overwrite the oldest
            head_ = (head_ + 1) % N;                           // the next one is now the oldest
        }
    }

    std::size_t size() const { return count_; }

    bool full() const { return size() == N; }

    const T& operator[](std::size_t i) const { return items_[(head_ + i) % N]; }

private:
    std::array<T, N> items_{};
    std::size_t head_ = 0;
    std::size_t count_ = 0;
};

template <typename T, std::size_t N>
std::string dump(const RingBuffer<T, N>& rb) {
    std::ostringstream os;
    os << "[";
    for (std::size_t i = 0; i < rb.size(); ++i) os << (i ? ", " : "") << rb[i];
    os << "]";
    return os.str();
}

int main() {
    RingBuffer<int, 3> latencies;
    for (int ms : {10, 20, 30, 40, 50}) {
        latencies.push(ms);
        std::cout << "after " << ms << ": " << dump(latencies) << " size=" << latencies.size()
                  << " full=" << (latencies.full() ? "yes" : "no") << "\n";
    }
    RingBuffer<std::string, 2> last_errors;
    for (const char* e : {"timeout", "refused", "reset"}) last_errors.push(e);
    std::cout << "errors: " << dump(last_errors) << "\n";
    return 0;
}
