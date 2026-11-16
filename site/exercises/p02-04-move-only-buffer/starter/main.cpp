// main.cpp: a move-only owning buffer.
#include <cstddef>
#include <cstring>
#include <iostream>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

// Owns a heap block of size_ chars. Exactly one Buffer owns any block.
class Buffer {
public:
    static inline int live = 0;   // blocks currently owned by some Buffer

    Buffer(std::size_t n, char fill) : data_(new char[n]), size_(n) {
        std::memset(data_, fill, n);
        ++live;
    }
    ~Buffer() {
        if (data_ != nullptr) --live;
        delete[] data_;
    }

    // TODO 1: copying would create two owners of one block. Delete the copy
    //         constructor and the copy assignment operator.
    // TODO 2: move constructor: take other's block, leave other empty
    //         (data_ == nullptr, size_ == 0). Mark it noexcept.
    // TODO 3: move assignment: free your current block (keep `live` right!),
    //         take other's, leave other empty. Mark it noexcept.

    bool empty() const { return data_ == nullptr; }
    std::string str() const { return data_ ? std::string(data_, size_) : std::string("(empty)"); }

private:
    char* data_;
    std::size_t size_;
};

static_assert(!std::is_copy_constructible_v<Buffer>, "Buffer must be move-only");
static_assert(std::is_nothrow_move_constructible_v<Buffer>, "move constructor must be noexcept");
static_assert(std::is_nothrow_move_assignable_v<Buffer>, "move assignment must be noexcept");

int main() {
    std::vector<Buffer> pool;
    for (int i = 0; i < 4; ++i) pool.push_back(Buffer(3, static_cast<char>('a' + i)));
    std::cout << "live after fill: " << Buffer::live << "\n";

    Buffer taken = std::move(pool[1]);
    std::cout << "taken: " << taken.str() << ", pool[1] empty: " << std::boolalpha << pool[1].empty() << "\n";

    pool[0] = std::move(pool[2]);
    std::cout << "pool[0]: " << pool[0].str() << ", pool[2]: " << pool[2].str() << ", live: " << Buffer::live << "\n";

    pool.clear();
    std::cout << "live after clear: " << Buffer::live << "\n";
    return 0;
}
