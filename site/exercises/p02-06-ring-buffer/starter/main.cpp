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
    // TODO: store value. If already full, overwrite the oldest item.
    void push(T value) { (void)value; }

    // TODO: number of items stored (0..N).
    std::size_t size() const { return 0; }

    bool full() const { return size() == N; }

    // TODO: i = 0 is the oldest item, i = size() - 1 the newest.
    const T& operator[](std::size_t i) const { return items_[i]; }

private:
    std::array<T, N> items_{};
    std::size_t head_ = 0;    // index in items_ of the oldest item
    std::size_t count_ = 0;   // how many items are stored
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
