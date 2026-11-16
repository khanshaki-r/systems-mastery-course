// main.cpp: the tcpkv request handler, independent of any socket.
#include <algorithm>
#include <cctype>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using Store = std::map<std::string, std::string>;   // std::map keeps keys sorted for KEYS

// Handle one request line and return the reply line.
// Return an empty string for blank lines (no reply is sent).
std::string handle(Store& store, std::string line) {
    // TODO: implement the protocol described in the task.
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line == "PING") return "PONG";
    (void)store;
    return line.empty() ? "" : "ERR not implemented";
}

int main() {
    Store store;
    std::string line;
    while (std::getline(std::cin, line)) {
        std::string reply = handle(store, line);
        if (!reply.empty()) std::cout << reply << "\n";
    }
    return 0;
}
