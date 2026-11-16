// main.cpp: loan products through a base class pointer.
#include <iostream>
#include <memory>
#include <string>

class Loan {
public:
    explicit Loan(long long amount) : amount_(amount) {}
    virtual int rate_bps() const { return 1200; }
    virtual std::string kind() const { return "generic"; }
    virtual ~Loan() = default;              // delete through Loan* now runs the derived destructor

    long long amount() const { return amount_; }
    long long yearly_interest() const { return amount_ * rate_bps() / 10000; }   // virtual call inside

private:
    long long amount_;
};

class HomeLoan : public Loan {
public:
    using Loan::Loan;
    int rate_bps() const override { return 850; }
    std::string kind() const override { return "home"; }
};

class PersonalLoan : public Loan {
public:
    using Loan::Loan;
    int rate_bps() const override { return 1399; }
    std::string kind() const override { return "personal"; }
};

class GoldLoan : public Loan {
public:
    using Loan::Loan;
    int rate_bps() const override { return 920; }
    std::string kind() const override { return "gold"; }
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
