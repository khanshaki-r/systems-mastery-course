// main.cpp: top-k most frequent words.
#include <algorithm>
#include <cctype>
#include <iostream>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

int main() {
    std::size_t k = 0;
    if (!(std::cin >> k)) return 1;
    std::unordered_map<std::string, int> counts;
    std::string line;
    std::getline(std::cin, line);
    while (std::getline(std::cin, line)) {
        std::string word;
        line += ' ';                                  // a separator at the end flushes the last word
        for (char ch : line) {
            unsigned char u = static_cast<unsigned char>(ch);   // isalpha on a negative char is UB
            if (std::isalpha(u)) {
                word += static_cast<char>(std::tolower(u));
            } else if (!word.empty()) {
                ++counts[word];
                word.clear();
            }
        }
    }
    std::vector<std::pair<std::string, int>> ranked(counts.begin(), counts.end());
    std::sort(ranked.begin(), ranked.end(), [](const auto& a, const auto& b) {
        return a.second != b.second ? a.second > b.second : a.first < b.first;
    });
    for (std::size_t i = 0; i < ranked.size() && i < k; ++i) {
        std::cout << ranked[i].first << " " << ranked[i].second << "\n";
    }
    return 0;
}
