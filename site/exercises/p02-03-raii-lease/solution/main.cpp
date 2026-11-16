// main.cpp: make Lease an RAII type.
#include <iostream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

class Lease {
public:
    explicit Lease(std::string id) : id_(std::move(id)) {
        std::cout << "acquire " << id_ << "\n";
    }
    ~Lease() {
        std::cout << "release " << id_ << "\n";     // runs on every exit path, including exceptions
    }
    Lease(const Lease&) = delete;                    // one owner only
    Lease& operator=(const Lease&) = delete;

private:
    std::string id_;
};

static_assert(!std::is_copy_constructible_v<Lease>, "Lease must not be copyable");
static_assert(!std::is_copy_assignable_v<Lease>, "Lease must not be copy-assignable");

static void process(const std::string& id, bool fail) {
    Lease lease(id);
    std::cout << "processing " << id << "\n";
    if (fail) throw std::runtime_error("validation failed for " + id);
    std::cout << "done " << id << "\n";
}

int main() {
    const std::vector<std::pair<std::string, bool>> jobs = {{"LN-1", false}, {"LN-2", true}, {"LN-3", false}};
    for (const auto& [id, fail] : jobs) {
        try {
            process(id, fail);
        } catch (const std::exception& e) {
            std::cout << "error: " << e.what() << "\n";
        }
    }
    {
        Lease a("batch-A");
        Lease b("batch-B");
        std::cout << "two leases held\n";
    }   // b is destroyed first, then a
    std::cout << "end\n";
    return 0;
}
