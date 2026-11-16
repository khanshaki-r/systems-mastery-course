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
    std::getline(std::cin, line);   // finish the first line
    while (std::getline(std::cin, line)) {
        // TODO 1: split line into words (runs of letters), lower-case them,
        //         and count each one in `counts`.
        (void)line;
    }
    // TODO 2: copy the map into a vector, sort by count (high to low) and then
    //         by word (A to Z), and print the first k as "word count".
    (void)counts;
    return 0;
}
