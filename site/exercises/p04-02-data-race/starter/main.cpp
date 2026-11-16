// main.cpp: four threads update shared counters.
#include <iostream>
#include <thread>
#include <vector>

// TODO: four threads update these at the same time. Make them race-free.
long long approved = 0;
long long total_paise = 0;

static void worker(int id) {
    for (int i = 0; i < 20000; ++i) {
        ++approved;
        total_paise += id + 1;
    }
}

int main() {
    std::vector<std::thread> threads;
    for (int id = 0; id < 4; ++id) threads.emplace_back(worker, id);
    for (auto& t : threads) t.join();
    std::cout << "approved = " << approved << "\n";
    std::cout << "total_paise = " << total_paise << "\n";
    return 0;
}
