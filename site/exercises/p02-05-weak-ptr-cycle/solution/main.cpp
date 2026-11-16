// main.cpp: Customer <-> Loan, without leaking.
#include <iostream>
#include <memory>
#include <string>
#include <vector>

struct Loan;

struct Customer {
    std::string name;
    std::vector<std::shared_ptr<Loan>> loans;      // owning direction: strong
    explicit Customer(std::string n) : name(std::move(n)) {}
    ~Customer() { std::cout << "customer " << name << " destroyed\n"; }
};

struct Loan {
    std::string id;
    std::weak_ptr<Customer> owner;                  // back-pointer: weak, does not keep Customer alive
    explicit Loan(std::string i) : id(std::move(i)) {}
    ~Loan() { std::cout << "loan " << id << " destroyed\n"; }
    std::string owner_name() const {
        if (auto c = owner.lock()) return c->name;  // shared_ptr only while we use it
        return "(gone)";
    }
};

int main() {
    std::shared_ptr<Loan> survivor;
    {
        auto c = std::make_shared<Customer>("Asha");
        auto l1 = std::make_shared<Loan>("LN-1");
        auto l2 = std::make_shared<Loan>("LN-2");
        l1->owner = c;
        l2->owner = c;
        c->loans = {l1, l2};
        std::cout << "LN-1 belongs to " << l1->owner_name() << "\n";
        std::cout << "customer use_count = " << c.use_count() << "\n";   // only c: weak refs do not count
        std::cout << "LN-1 use_count = " << l1.use_count() << "\n";      // l1 and c->loans[0]
        survivor = l1;
    }   // c's count hits 0: Customer destroyed, its vector releases LN-1 (survivor keeps it) and LN-2
    std::cout << "after scope, LN-1 belongs to " << survivor->owner_name() << "\n";
    std::cout << "end of main\n";
    return 0;
}
