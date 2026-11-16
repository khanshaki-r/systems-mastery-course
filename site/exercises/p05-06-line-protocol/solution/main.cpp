// main.cpp: the tcpkv request handler, independent of any socket.
#include <algorithm>
#include <cctype>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

using Store = std::map<std::string, std::string>;

static std::string upper(std::string s) {
    for (char& c : s) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
    return s;
}

std::string handle(Store& store, std::string line) {
    if (!line.empty() && line.back() == '\r') line.pop_back();   // tolerate CRLF
    std::istringstream in(line);
    std::string cmd;
    if (!(in >> cmd)) return "";                                  // blank line: no reply
    const std::string name = upper(cmd);
    std::vector<std::string> args;
    for (std::string a; in >> a;) args.push_back(a);
    auto wrong = [&] { return "ERR wrong number of arguments for '" + name + "'"; };

    if (name == "PING") return args.empty() ? std::string("PONG") : wrong();
    if (name == "GET") {
        if (args.size() != 1) return wrong();
        auto it = store.find(args[0]);
        return it == store.end() ? "NOT_FOUND" : it->second;
    }
    if (name == "DEL") {
        if (args.size() != 1) return wrong();
        return store.erase(args[0]) ? "DELETED" : "NOT_FOUND";
    }
    if (name == "SET") {
        if (args.size() < 2) return wrong();
        // The value is the rest of the line after the key, spaces included.
        std::size_t key_pos = line.find(args[0], line.find(cmd) + cmd.size());
        std::size_t val_pos = line.find_first_not_of(' ', key_pos + args[0].size());
        store[args[0]] = line.substr(val_pos);
        return "OK";
    }
    if (name == "KEYS") {
        if (!args.empty()) return wrong();
        std::string out = std::to_string(store.size());
        for (const auto& kv : store) out += " " + kv.first;
        return out;
    }
    return "ERR unknown command '" + cmd + "'";
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
