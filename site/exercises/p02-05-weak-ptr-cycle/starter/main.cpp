// main.cpp: Customer <-> Loan, without leaking.
#include <iostream>
#include <memory>
#include <string>
#include <vector>

struct Loan;

struct Customer {
    std::string name;
    std::vector<std::shared_ptr<Loan>> loans;     // a customer owns their loans
    explicit Customer(std::string n) : name(std::move(n)) {}
    ~Customer() { std::cout << "customer " << name << " destroyed\n"; }
};

struct Loan {
    std::string id;
    std::shared_ptr<Customer> owner;               // TODO: this back-pointer creates a cycle
    explicit Loan(std::string i) : id(std::move(i)) {}
    ~Loan() { std::cout << "loan " << id << " destroyed\n"; }
    std::string owner_name() const {
        return owner ? owner->name : std::string("(gone)");   // TODO: adapt when owner changes type
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
        std::cout << "customer use_count = " << c.use_count() << "\n";
        std::cout << "LN-1 use_count = " << l1.use_count() << "\n";
        survivor = l1;
    }
    std::cout << "after scope, LN-1 belongs to " << survivor->owner_name() << "\n";
    std::cout << "end of main\n";
    return 0;
}
