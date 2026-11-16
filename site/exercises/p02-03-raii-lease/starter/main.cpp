// main.cpp: make Lease an RAII type.
#include <iostream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

// A Lease stands for something that must be given back: a lock on a loan
// record, a DB connection, a file. Whoever holds the Lease owns it.
class Lease {
public:
    explicit Lease(std::string id) : id_(std::move(id)) {
        // TODO 1: print "acquire <id>"
    }
    // TODO 2: add a destructor that prints "release <id>"
    // TODO 3: forbid copying (two copies would release the same thing twice)

private:
    std::string id_;
};

// These fail to compile until TODO 3 is done. That is the first error you will see.
static_assert(!std::is_copy_constructible_v<Lease>, "Lease must not be copyable");
static_assert(!std::is_copy_assignable_v<Lease>, "Lease must not be copy-assignable");

static void process(const std::string& id, bool fail) {
    Lease lease(id);
    std::cout << "processing " << id << "\n";
    if (fail) throw std::runtime_error("validation failed for " + id);
    std::cout << "done " << id << "\n";
}   // no release call anywhere: the destructor must do it, even when we throw

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
    }
    std::cout << "end\n";
    return 0;
}
