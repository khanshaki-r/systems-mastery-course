// main.cpp: loan products through a base class pointer.
#include <iostream>
#include <memory>
#include <string>

class Loan {
public:
    explicit Loan(long long amount) : amount_(amount) {}
    // TODO 1: these must be virtual so the derived versions run through a Loan pointer.
    int rate_bps() const { return 1200; }
    std::string kind() const { return "generic"; }
    // TODO 2: an object deleted through a base pointer needs a virtual destructor.
    ~Loan() = default;

    long long amount() const { return amount_; }
    long long yearly_interest() const { return amount_ * rate_bps() / 10000; }

private:
    long long amount_;
};

// TODO 3: once the base functions are virtual, mark these with `override`.
class HomeLoan : public Loan {
public:
    using Loan::Loan;
    int rate_bps() const { return 850; }
    std::string kind() const { return "home"; }
};

class PersonalLoan : public Loan {
public:
    using Loan::Loan;
    int rate_bps() const { return 1399; }
    std::string kind() const { return "personal"; }
};

class GoldLoan : public Loan {
public:
    using Loan::Loan;
    int rate_bps() const { return 920; }
    std::string kind() const { return "gold"; }
};

static std::unique_ptr<Loan> make_loan(const std::string& type, long long amount) {
    if (type == "home") return std::make_unique<HomeLoan>(amount);
    if (type == "personal") return std::make_unique<PersonalLoan>(amount);
    if (type == "gold") return std::make_unique<GoldLoan>(amount);
    return nullptr;
}

int main() {
    std::string type;
    long long amount;
    long long total = 0;
    while (std::cin >> type >> amount) {
        std::unique_ptr<Loan> loan = make_loan(type, amount);
        if (!loan) {
            std::cout << "unknown loan type: " << type << "\n";
            continue;
        }
        std::cout << loan->kind() << " " << loan->amount() << ": " << loan->rate_bps()
                  << " bps, yearly interest " << loan->yearly_interest() << "\n";
        total += loan->yearly_interest();
    }
    std::cout << "total yearly interest: " << total << "\n";
    return 0;
}
