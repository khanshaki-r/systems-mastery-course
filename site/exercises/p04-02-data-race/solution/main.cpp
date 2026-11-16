// main.cpp: four threads update shared counters.
#include <atomic>
#include <iostream>
#include <thread>
#include <vector>

// Each increment is now one indivisible read-modify-write.
// (If the two counters had to stay consistent with each other at every instant,
//  one std::mutex around both updates would be the right tool instead.)
std::atomic<long long> approved{0};
std::atomic<long long> total_paise{0};

static void worker(int id) {
    for (int i = 0; i < 20000; ++i) {
        approved.fetch_add(1, std::memory_order_relaxed);        // only the final total matters
        total_paise.fetch_add(id + 1, std::memory_order_relaxed);
    }
}

int main() {
    std::vector<std::thread> threads;
    for (int id = 0; id < 4; ++id) threads.emplace_back(worker, id);
    for (auto& t : threads) t.join();                            // join() synchronises: all adds are visible
    std::cout << "approved = " << approved.load() << "\n";
    std::cout << "total_paise = " << total_paise.load() << "\n";
    return 0;
}
