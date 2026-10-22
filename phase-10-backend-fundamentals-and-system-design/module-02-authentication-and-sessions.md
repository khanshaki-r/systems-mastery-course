# Module 10.02: Authentication and sessions

**Estimated hours:** 3

**What you will learn**

1. The difference between authentication and authorisation, and how to store passwords so that a stolen `users` table does not become stolen accounts: salted, slow, memory-hard hashes (bcrypt, scrypt, Argon2id) with libsodium in C++.
2. Server-side sessions versus tokens: cookie attributes, expiry and revocation; JWT structure, HS256 versus RS256, claims, and the revocation problem; API keys, mTLS, one-time passwords; RBAC versus ABAC and least privilege.
3. How to build session-based login on the 10.01 server with lockout, audit events and a role-plus-branch authorisation check, how the same check looks in PL/pgSQL, and how the branch login of claim H7 flowed and where its latency went.

**Prerequisites:** [Module 10.01: HTTP/REST API design](module-01-http-rest-api-design.md). You need `mini_http.hpp` from 10.01, TLS and mTLS from [module 5.09](../phase-05-networking-and-servers/module-09-tls-basics.md), PL/pgSQL from module 6.11 and composite indexes from module 6.09.

---

## 1. One-line intuition

Authentication proves who you are once; a session or token lets you skip proving it on every request; authorisation decides, on every request, what that identity may do.

## 2. Real-life analogy

The staff entrance of a bank's regional office.

- At the **security desk** you show your ID card and type your PIN. That is **authentication**: proving who you are.
- The desk does not keep a copy of your PIN. It keeps a smudge made by a slow, special machine from your PIN plus a random sticker unique to you. To check you, it runs your PIN through the machine again and compares smudges. That is a **salted password hash**.
- The desk gives you a **visitor badge** with a number and an expiry time, and writes the number in its register. That is a **server-side session**. If you lose the badge, the desk strikes the number out and the badge stops working at once: **revocation**.
- Another office uses **laminated passes with a wax seal**. Doors check the seal themselves without phoning the desk. Fast, but if a pass is stolen, cancelling it means telling every door. That is a **self-contained token (JWT)** and its **revocation problem**.
- Each door checks the badge colour (your **role**: clerk, credit officer, manager) and the floor printed on it (your **branch**). That is **authorisation**, checked at every door, every time.

## 3. Why it exists: the problem it solves

HTTP is stateless (10.01): every request must carry some proof of identity. Sending the password with every request multiplies its exposure, and checking a slow hash on every request would be ruinously expensive. So systems authenticate once and then issue something cheaper to check: a session id or a signed token.

Password storage exists because databases leak: backups go missing, SQL injection dumps tables, insiders copy files. If passwords are stored in plain text, a leak is every account. If they are stored with a fast hash such as SHA-256, attackers on ordinary GPUs try billions of guesses per second and recover most real passwords; this has happened in large public breaches of unsalted SHA-1 hashes. Because people reuse passwords, a leak at one site turns into logins at another (**credential stuffing**).

Authorisation exists because "logged in" is not "allowed". Without it, a clerk can approve a loan, an officer at Pune can read Mumbai's customers, and an auditor can change data. In a bank, every one of those is a regulatory finding.

## 4. Three layers of depth

### Layer 1 (beginner): who you are, and what you may do

| Term | Meaning | In the lending platform |
|---|---|---|
| Authentication (authn) | proving identity | branch code + user code + password, perhaps plus an OTP |
| Authorisation (authz) | deciding whether an identity may do an action on a resource | may `MUM001/U001` decide application 1001? |
| Credential | the secret or object used to prove identity | password, private key, client certificate |
| Factor | a kind of credential: something you know, have, or are | password; phone or hardware token; fingerprint |
| Session | server-side record that "this browser is user X until time T" | row keyed by a random session id |
| Token | a signed object the client carries that states identity and claims | a JWT |

**Never store passwords.** Store a **hash**: a one-way function of the password. Three rules make it safe:

1. **Salt.** A random value, different for every user, mixed in before hashing and stored next to the hash. Two users with the password `Branch@2026` get different hashes, and precomputed tables of common passwords (rainbow tables) are useless.
2. **Slow.** Each hash should take tens of milliseconds or more, so an attacker gets thousands of guesses per second instead of billions.
3. **Memory-hard.** Each hash should need many megabytes of RAM, so GPUs and custom chips, which have lots of cores but little memory per core, lose their advantage.

| Algorithm | Slow | Memory-hard | Notes |
|---|---|---|---|
| Argon2id | yes | yes | winner of the 2015 Password Hashing Competition, RFC 9106; the default choice today |
| scrypt | yes | yes | older memory-hard design, widely available |
| bcrypt | yes | a little (4 KB) | battle-tested; only the first 72 bytes of the password count |
| PBKDF2-HMAC-SHA256 | yes, by iteration count | no | use when a FIPS-validated algorithm is mandatory, with a high iteration count |
| SHA-256, MD5 | no | no | never for passwords |

libsodium's `crypto_pwhash_str` produces Argon2id by default and stores everything needed to verify later in one string:

```text
$argon2id$v=19$m=65536,t=2,p=1$EECd31HVFFJpTa/yFQzVAg$y2jKtyRCTU/lvSYH8/1ezBXWpwdhEdyV+uAAfzacQD0
 algorithm  ver  64 MiB, 2 passes,  salt (16 bytes)      hash (32 bytes)
                 1 lane
```

That string goes into `users.password_hash`. Because the parameters live in the string, you can raise them later and rehash each user at their next successful login.

**The login flow, in order.** Look up the user by `(branch_code, user_code)`; if locked, refuse; verify the password against the stored hash; on failure count it; on success reset the count, create a **new** session id, record an audit event and return the session cookie.

### Layer 2 (working engineer): sessions, tokens, keys, and the authorisation model

**Server-side sessions.** After login the server stores `{session id -> user, role, branch, created, last seen}` in memory, Redis or a table, and sends the id in a cookie. Every later request sends the cookie back; the server looks it up. The cookie attributes do the security work:

| Attribute | Effect | Why it matters |
|---|---|---|
| `HttpOnly` | JavaScript cannot read the cookie | an XSS bug cannot steal the session |
| `Secure` | sent only over HTTPS | no session id in clear text on the branch network |
| `SameSite=Strict` (or `Lax`) | not sent on requests started by other sites | blocks most cross-site request forgery (CSRF) |
| `Path=/` | which paths receive it | keep it as narrow as practical |
| `Max-Age` / `Expires` | browser deletes it after this | the browser side of expiry; the server enforces its own |
| `__Host-` name prefix | browser requires `Secure`, `Path=/`, no `Domain` | stops sibling subdomains from overwriting the cookie |

Two expiries: an **idle timeout** (15 minutes without a request) and an **absolute lifetime** (8 hours, a working day). **Revocation** is deleting the row: logout, password change, "log out all devices", or a security team responding to an incident. **Rotation:** issue a new id at login and whenever privilege rises, so an id planted before login (session fixation) is worthless.

**Tokens and JWT.** A JSON Web Token is three base64url parts joined by dots: `header.payload.signature`.

```text
header   {"alg":"HS256","typ":"JWT"}
payload  {"sub":"MUM001/U001","role":"CREDIT_OFFICER","iat":1792396800,"exp":1792397700}
sig      HMAC-SHA256(key, base64url(header) + "." + base64url(payload))
```

Registered claims: `iss` (issuer), `sub` (subject), `aud` (audience: which service must accept it), `exp` (expiry), `nbf` (not before), `iat` (issued at), `jti` (unique id). The payload is **signed, not encrypted**: anyone can base64-decode it, so never put a PAN or an account balance in it.

| | HS256 | RS256 / ES256 |
|---|---|---|
| Key | one shared secret | private key signs, public key verifies |
| Who can verify | anyone with the secret | anyone with the public key (published as a JWKS document) |
| Who can mint | **also** anyone with the secret | only the holder of the private key |
| Fits | one service that issues and checks its own tokens | an identity provider issuing tokens to many services |

Pin the algorithm on the verifier. Libraries that trusted the token's own `alg` header accepted `"alg":"none"` (no signature), or verified an RS256 token as HS256 using the public key as the HMAC secret ("algorithm confusion").

**The revocation problem.** A JWT is valid until `exp`; the verifier asks nobody. A fired employee's token keeps working. The standard answer: **short-lived access tokens** (5 to 15 minutes) plus a **refresh token** that is stored server-side, rotated on every use, and revocable. Revocation then takes effect within one access-token lifetime. For instant revocation you add a server-side check (a denylist of `jti`, or a per-user token version), and at that point you have rebuilt a session lookup.

| | Server-side session | JWT access token |
|---|---|---|
| Check per request | a lookup (memory, Redis, DB) | a signature check, no lookup |
| Revocation | immediate: delete the row | waits for `exp`, or needs a denylist |
| Scales across services | needs a shared store | any service with the key can verify |
| Size on every request | 32 to 64 bytes | hundreds of bytes |
| Fits | one web app or one app server cluster | many services, third-party APIs, mobile apps |

For staff in branches talking to one platform, server-side sessions are the simpler and safer default.

**API keys.** For machine clients (a partner's batch job): long random strings (32 bytes from the CSPRNG), shown once, stored **hashed**. A fast hash such as SHA-256 is fine here, because the key has 256 bits of entropy and cannot be guessed by trying likely values; slow hashes are for low-entropy human passwords. Give each key a visible prefix (`lk_live_3f9a...`) so a leaked key can be identified, a scope (which endpoints), an owner and a rotation date.

**mTLS for services.** Between the app server, the payment switch and the database, the identity is a **client certificate** checked during the TLS handshake (5.09, 11.04). No passwords travel, and a stolen password file is useless against it.

**MFA and OTP.** A second factor stops credential stuffing. **TOTP** (RFC 6238) computes HMAC over the current 30-second time step with a secret shared at enrolment, and shows 6 digits; the server computes the same and compares, allowing one step of clock drift. SMS OTP is weaker (SIM-swap fraud) but common in Indian banking for customers. Use **step-up authentication** for high-risk actions: an officer sanctioning above a threshold re-enters an OTP even mid-session.

**Authorisation models.**

- **RBAC** (role-based): users get roles, roles get permissions. `CLERK`: create and read applications. `CREDIT_OFFICER`: decide. `BRANCH_MANAGER`: decide above the officer's limit. `AUDITOR`: read everything, change nothing. Easy to review: "who can decide?" is one query.
- **ABAC** (attribute-based): rules over attributes of user, resource and context. "Officer's branch equals the application's branch", "amount at most the officer's sanction limit", "only during branch hours". More expressive, harder to audit.

Real systems use RBAC plus a few attribute checks. Enforce in the server **and** in the database layer (claim H6): the PL/pgSQL function in Lab Part D raises an error if the role lacks the permission or the branch does not match, so even a buggy or bypassed application path cannot decide another branch's loan. **Least privilege**: the application's database login may execute the procedures and nothing else; it cannot `SELECT * FROM users`.

**Audit every authentication event.** Login success and failure, lockout, logout, password change, role change, authorisation denial, each with time, branch, user, source address and outcome, into `audit_log` (the canonical table). Never log the password, the session id or the token. Failed logins per account per hour is a fraud signal.

**Attacks and their defences.**

| Attack | What happens | Defence |
|---|---|---|
| Credential stuffing | passwords leaked elsewhere are tried here | MFA; rate limit per IP and per account (10.05); check new passwords against breached lists |
| Brute force | many guesses at one account | lockout after N failures or growing delays; but lockout lets an attacker lock users out, so pair it with alerting and a manager unlock |
| Session fixation | attacker plants a known session id before login | always issue a new id at login |
| CSRF | another site makes the browser send a request with the cookie | `SameSite`; anti-CSRF token for state-changing requests; check `Origin` |
| XSS token theft | injected script reads the token | `HttpOnly` cookies; never keep tokens in `localStorage` |
| User enumeration | different error or timing for unknown users | one generic message; verify against a dummy hash for unknown users |
| Token in URL or logs | ids leak through proxies, history, log files | only in headers or cookies; redact in logs |

### Layer 3 (internals): what the hash, the comparison and the random id really do

**What Argon2id spends.** With `m=65536, t=2, p=1` it allocates 64 MiB, fills it with 1 KiB blocks where each block is computed (with BLAKE2b) from earlier blocks, and makes two passes in which the addresses read depend partly on the data itself. An attacker cannot skip the memory: computing a guess with less memory costs much more time. In this module's run on one busy WSL2 laptop, one interactive-level hash took 343 ms while SHA-256 managed about 1,050,000 hashes per second on one core: a ratio of roughly 360,000 to one in the attacker's guessing speed. Typical desktops hash the interactive parameters faster than that; measure your own in Lab Part A.

**The capacity consequence.** Memory-hard means 64 MiB per hash **in flight**. Fifty simultaneous logins at 9:30 a.m. when branches open is 3.2 GB of RAM for hashing alone, plus the CPU time. A login server therefore bounds hashing concurrency (a semaphore sized to cores and memory), and the parameters are chosen from a measured budget, not copied from a blog.

**Why comparison must be constant-time.** `memcmp` and `std::string ==` stop at the first differing byte. A verifier that compares a secret (an HMAC, a token, an API key hash) that way answers slightly faster when the first byte is wrong than when the first ten bytes are right. Over many requests an attacker can measure that and recover the secret byte by byte. `sodium_memcmp` (or OpenSSL's `CRYPTO_memcmp`) always touches every byte and combines the differences with OR, so time does not depend on where they differ. `crypto_pwhash_str_verify` does this internally.

**Where a session id's strength comes from.** `getrandom(2)` reads the kernel's cryptographically secure random generator, the same source as `/dev/urandom`; after early boot it never blocks. 32 bytes is 256 bits: guessing a live id is hopeless even at millions of tries per second. `rand()`, `std::mt19937` or time-based ids are predictable from a few observed outputs, which is how real session hijacks have worked.

**How a JWT is verified.** Split at the last dot, recompute HMAC-SHA256 over the first two parts with the key, compare in constant time with the third part, and only then parse the payload and check `exp`, `nbf`, `iss` and `aud`. Parsing JSON from an unverified token first is how parsers become attack surface.

## 5. Architecture diagram

```mermaid
sequenceDiagram
    participant B as Branch client
    participant S as App server
    participant M as Session store
    participant D as PostgreSQL
    B->>S: POST /v1/sessions with branch, user, password
    S->>D: SELECT password_hash, role_id, status FROM users by primary key
    S->>S: Argon2id verify, tens of ms, no lock held
    S->>M: store new random session id
    S->>D: INSERT INTO audit_log login_ok
    S->>B: 201 with Set-Cookie sid, HttpOnly, Secure, SameSite
    B->>S: POST /v1/applications/1001/decisions with cookie
    S->>M: look up sid, check idle and absolute expiry
    S->>D: authorise via PL/pgSQL, role and branch
    S->>B: 201, or 401 no session, or 403 not allowed
```

Authentication happens once, in the first exchange. Every later request pays only a session lookup and an authorisation check, which is why those two must be fast and the password hash may be slow.

## 6. Code

Two programs. `auth_basics.cpp` hashes and verifies a password with Argon2id, compares the guessing rate with SHA-256, and builds and verifies an HS256 JWT by hand so you can see every byte. `session_server.cpp` adds login, sessions, lockout, audit lines and authorisation to the 10.01 router.

```bash
mkdir -p ~/course/auth && cd ~/course/auth
cp ~/course/rest/mini_http.hpp .
sudo apt install -y libsodium-dev       # skip if already installed
```

**`auth_basics.cpp`**

```cpp
// auth_basics.cpp -- password hashing with Argon2id and a hand-made HS256 JWT.
// Build: g++ -std=c++17 -O2 -Wall -Wextra -Werror -g -pthread -o auth_basics auth_basics.cpp -lsodium
#include <sodium.h>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <string>

using Clock = std::chrono::steady_clock;
static double ms_since(Clock::time_point t) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t).count();
}

// ---------- base64url without padding, as JWT requires (RFC 7515)
static std::string b64url(const unsigned char* p, size_t n) {
    std::string out(sodium_base64_ENCODED_LEN(n, sodium_base64_VARIANT_URLSAFE_NO_PADDING), '\0');
    sodium_bin2base64(&out[0], out.size(), p, n, sodium_base64_VARIANT_URLSAFE_NO_PADDING);
    out.resize(std::strlen(out.c_str()));                  // drop the trailing NUL
    return out;
}
static std::string b64url(const std::string& s) {
    return b64url(reinterpret_cast<const unsigned char*>(s.data()), s.size());
}

// ---------- HS256: HMAC-SHA256 over "header.payload" with a shared secret
static std::string hs256(const std::string& signing_input, const unsigned char key[32]) {
    unsigned char mac[crypto_auth_hmacsha256_BYTES];
    crypto_auth_hmacsha256_state st;
    crypto_auth_hmacsha256_init(&st, key, 32);
    crypto_auth_hmacsha256_update(&st, reinterpret_cast<const unsigned char*>(signing_input.data()),
                                  signing_input.size());
    crypto_auth_hmacsha256_final(&st, mac);
    return b64url(mac, sizeof mac);
}
static std::string make_jwt(const std::string& payload_json, const unsigned char key[32]) {
    std::string input = b64url(std::string("{\"alg\":\"HS256\",\"typ\":\"JWT\"}")) + "." + b64url(payload_json);
    return input + "." + hs256(input, key);
}
// Returns true only if the signature matches. Compares in constant time.
static bool jwt_signature_ok(const std::string& token, const unsigned char key[32]) {
    size_t dot2 = token.rfind('.');
    if (dot2 == std::string::npos) return false;
    std::string expect = hs256(token.substr(0, dot2), key), got = token.substr(dot2 + 1);
    return expect.size() == got.size() && sodium_memcmp(expect.data(), got.data(), got.size()) == 0;
}

int main() {
    if (sodium_init() < 0) { std::puts("libsodium init failed"); return 1; }

    // 1. Same password, two hashes: different salts, so different strings.
    const char* pw = "Branch@2026";
    char h1[crypto_pwhash_STRBYTES], h2[crypto_pwhash_STRBYTES];
    auto t0 = Clock::now();
    if (crypto_pwhash_str(h1, pw, std::strlen(pw), crypto_pwhash_OPSLIMIT_INTERACTIVE,
                          crypto_pwhash_MEMLIMIT_INTERACTIVE) != 0) { std::puts("out of memory"); return 1; }
    double hash_ms = ms_since(t0);
    if (crypto_pwhash_str(h2, pw, std::strlen(pw), crypto_pwhash_OPSLIMIT_INTERACTIVE,
                          crypto_pwhash_MEMLIMIT_INTERACTIVE) != 0) { std::puts("out of memory"); return 1; }
    std::printf("hash 1: %s\nhash 2: %s\n", h1, h2);
    std::printf("one Argon2id hash took %.0f ms (ops=%llu, mem=%zu MiB)\n", hash_ms,
                static_cast<unsigned long long>(crypto_pwhash_OPSLIMIT_INTERACTIVE),
                static_cast<size_t>(crypto_pwhash_MEMLIMIT_INTERACTIVE) >> 20);

    // 2. Verify: the parameters and salt are read back out of the stored string.
    std::printf("verify correct password: %s\n",
                crypto_pwhash_str_verify(h1, pw, std::strlen(pw)) == 0 ? "OK" : "FAIL");
    std::printf("verify wrong password  : %s\n",
                crypto_pwhash_str_verify(h1, "branch@2026", 11) == 0 ? "OK" : "FAIL");
    std::printf("needs rehash at MODERATE limits: %s\n",
                crypto_pwhash_str_needs_rehash(h1, crypto_pwhash_OPSLIMIT_MODERATE,
                                               crypto_pwhash_MEMLIMIT_MODERATE) == 1 ? "yes" : "no");

    // 3. Why not plain SHA-256? Count how many an attacker can try per second.
    unsigned char out[crypto_hash_sha256_BYTES];
    const int N = 1000000;
    t0 = Clock::now();
    for (int i = 0; i < N; ++i) crypto_hash_sha256(out, reinterpret_cast<const unsigned char*>(&i), sizeof i);
    double sha_ms = ms_since(t0);
    std::printf("SHA-256 guesses per second on one core : %.0f\n", N / (sha_ms / 1000.0));
    std::printf("Argon2id guesses per second on one core: %.1f\n", 1000.0 / hash_ms);

    // 4. A JWT signed with HS256. Fixed key and times so the output is reproducible.
    unsigned char key[32];
    std::memset(key, 'k', sizeof key);                     // demo only: real keys come from a vault
    std::string payload = "{\"sub\":\"MUM001/U001\",\"role\":\"CREDIT_OFFICER\",\"iat\":1792396800,\"exp\":1792397700}";
    std::string jwt = make_jwt(payload, key);
    std::printf("JWT: %s\n", jwt.c_str());
    std::printf("signature valid: %s\n", jwt_signature_ok(jwt, key) ? "yes" : "no");

    // 5. Tamper: change the role in the payload, keep the old signature.
    std::string forged_payload = "{\"sub\":\"MUM001/U001\",\"role\":\"BRANCH_MANAGER\",\"iat\":1792396800,\"exp\":1792397700}";
    std::string forged = jwt.substr(0, jwt.find('.') + 1) + b64url(forged_payload) + jwt.substr(jwt.rfind('.'));
    std::printf("forged token valid: %s\n", jwt_signature_ok(forged, key) ? "yes" : "no");
    return 0;
}
```

```bash
g++ -std=c++17 -O2 -Wall -Wextra -Werror -g -pthread -o auth_basics auth_basics.cpp -lsodium
./auth_basics
```

Expected output. The two hash strings differ on every run (random salts); the timings and rates are from one busy WSL2 laptop and will differ on yours; the JWT line is exact because the key and times are fixed.

```text
hash 1: $argon2id$v=19$m=65536,t=2,p=1$EECd31HVFFJpTa/yFQzVAg$y2jKtyRCTU/lvSYH8/1ezBXWpwdhEdyV+uAAfzacQD0
hash 2: $argon2id$v=19$m=65536,t=2,p=1$feb+t7bx2L7a5VPlQTrMdw$uejWUzYWTmxXofWInQA5zLphIPTcUJsiS1Z0Rj6u0PQ
one Argon2id hash took 343 ms (ops=2, mem=64 MiB)
verify correct password: OK
verify wrong password  : FAIL
needs rehash at MODERATE limits: yes
SHA-256 guesses per second on one core : 1050566
Argon2id guesses per second on one core: 2.9
JWT: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJNVU0wMDEvVTAwMSIsInJvbGUiOiJDUkVESVRfT0ZGSUNFUiIsImlhdCI6MTc5MjM5NjgwMCwiZXhwIjoxNzkyMzk3NzAwfQ.NpIOG2boRsOTlO13NtgAwfAa7xIzdfJF0_n35-PKWgU
signature valid: yes
forged token valid: no
```

Paste the middle part of the JWT into `echo eyJzdWIi...fQ | base64 -d` and you will read the payload in clear text: signed is not secret.

**`session_server.cpp`**

```cpp
// session_server.cpp -- session-based login on top of 10.01's mini_http.hpp.
//   POST   /v1/sessions                       log in; sets an HttpOnly session cookie
//   GET    /v1/me                             who am I (needs a valid session)
//   POST   /v1/applications/{id}/decisions    RBAC + branch check (authorisation)
//   DELETE /v1/sessions/current               log out (server-side revocation)
// Build: g++ -std=c++17 -O2 -Wall -Wextra -Werror -g -pthread -o session_server session_server.cpp -lsodium
#include "mini_http.hpp"

#include <sodium.h>
#include <sys/random.h>

#include <cerrno>
#include <chrono>
#include <cstring>
#include <map>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>

using Clock = std::chrono::steady_clock;

struct User {
    std::string password_hash;    // "$argon2id$v=19$m=65536,t=2,p=1$..."
    std::string role;             // CLERK, CREDIT_OFFICER, BRANCH_MANAGER, AUDITOR
    int failed = 0;               // consecutive failures
    bool locked = false;          // users.status = 'L'
};
struct Session {
    std::string user_key, branch, role;
    Clock::time_point created, last_seen;
};

static std::mutex mu;                                  // guards the three maps below
static std::map<std::string, User> users;              // key "MUM001/U001" = (branch_code, user_code)
static std::map<std::string, Session> sessions;        // session id -> session
static const std::map<long long, std::string> app_branch = {{1001, "MUM001"}, {2001, "PUN002"}};
static std::string dummy_hash;                         // verified against when the user does not exist

constexpr std::chrono::minutes kIdle{15};          // idle timeout
constexpr std::chrono::hours kAbsolute{8};         // absolute lifetime: one working day
constexpr int kMaxFailures = 5;

static void audit(const std::string& event, const std::string& who) {
    std::printf("AUDIT %s %s\n", event.c_str(), who.c_str());   // production: INSERT INTO audit_log
    std::fflush(stdout);
}

static std::string hash_password(const std::string& pw) {
    char out[crypto_pwhash_STRBYTES];
    if (crypto_pwhash_str(out, pw.c_str(), pw.size(), crypto_pwhash_OPSLIMIT_INTERACTIVE,
                          crypto_pwhash_MEMLIMIT_INTERACTIVE) != 0) throw std::runtime_error("pwhash: out of memory");
    return out;
}

// 32 random bytes from the kernel CSPRNG, hex encoded: 256 bits, unguessable.
static std::string new_session_id() {
    unsigned char raw[32];
    size_t got = 0;
    while (got < sizeof raw) {
        ssize_t n = getrandom(raw + got, sizeof raw - got, 0);
        if (n < 0) { if (errno == EINTR) continue; throw std::runtime_error("getrandom failed"); }
        got += static_cast<size_t>(n);
    }
    char hex[sizeof raw * 2 + 1];
    sodium_bin2hex(hex, sizeof hex, raw, sizeof raw);
    return hex;
}

static std::string field(const std::string& b, const std::string& name) {   // toy JSON string reader
    size_t k = b.find("\"" + name + "\"");
    if (k == std::string::npos) return "";
    size_t q1 = b.find('"', b.find(':', k) + 1), q2 = b.find('"', q1 + 1);
    return (q1 == std::string::npos || q2 == std::string::npos) ? "" : b.substr(q1 + 1, q2 - q1 - 1);
}

static std::string cookie(const mini::Request& rq, const std::string& name) {
    std::string c = "; " + rq.header("cookie");
    size_t p = c.find("; " + name + "=");
    if (p == std::string::npos) return "";
    p += name.size() + 3;
    return c.substr(p, c.find(';', p) - p);
}

// Look up the caller's session; enforce idle and absolute expiry. Caller holds mu.
static std::optional<Session> current_session(const mini::Request& rq) {
    auto it = sessions.find(cookie(rq, "sid"));
    if (it == sessions.end()) return std::nullopt;
    auto now = Clock::now();
    if (now - it->second.last_seen > kIdle || now - it->second.created > kAbsolute) {
        sessions.erase(it);
        return std::nullopt;
    }
    it->second.last_seen = now;
    return it->second;
}

int main(int argc, char** argv) {
    if (sodium_init() < 0) return 1;
    uint16_t port = argc > 1 ? static_cast<uint16_t>(std::atoi(argv[1])) : 8081;
    users["MUM001/U001"] = {hash_password("Branch@2026"), "CREDIT_OFFICER"};
    users["MUM001/U002"] = {hash_password("Clerk#2026"), "CLERK"};
    users["PUN002/U001"] = {hash_password("Pune$2026"), "CREDIT_OFFICER"};
    dummy_hash = hash_password("not-a-real-password");
    mini::Router router;

    router.add("POST", "/v1/sessions", [](const mini::Request& rq) {
        std::string key = field(rq.body, "branch_code") + "/" + field(rq.body, "user_code");
        std::string pw = field(rq.body, "password");
        std::string stored;
        {
            std::lock_guard<std::mutex> lk(mu);
            auto it = users.find(key);
            if (it != users.end() && it->second.locked) {
                audit("login_rejected_locked", key);
                return mini::problem(403, "account-locked", "Forbidden", "account locked; contact the branch manager");
            }
            stored = it == users.end() ? dummy_hash : it->second.password_hash;
        }
        // The slow part (tens of ms) runs WITHOUT the lock. Unknown users still pay
        // for a verify, so response time does not reveal which user codes exist.
        bool ok = crypto_pwhash_str_verify(stored.c_str(), pw.c_str(), pw.size()) == 0;

        std::lock_guard<std::mutex> lk(mu);
        auto it = users.find(key);
        if (!ok || it == users.end()) {
            if (it != users.end() && ++it->second.failed >= kMaxFailures) {
                it->second.locked = true;
                audit("account_locked", key);
            }
            audit("login_failed", key);
            return mini::problem(401, "invalid-credentials", "Unauthorized", "invalid user or password");
        }
        it->second.failed = 0;
        std::string sid = new_session_id();                 // always a NEW id: defeats session fixation
        auto now = Clock::now();
        sessions[sid] = Session{key, key.substr(0, key.find('/')), it->second.role, now, now};
        audit("login_ok", key);
        return mini::json(201, "{\"user\":\"" + key + "\",\"role\":\"" + it->second.role + "\"}")
            .set("Set-Cookie", "sid=" + sid + "; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900");
    });

    router.add("GET", "/v1/me", [](const mini::Request& rq) {
        std::lock_guard<std::mutex> lk(mu);
        auto s = current_session(rq);
        if (!s) return mini::problem(401, "no-session", "Unauthorized", "log in first");
        return mini::json(200, "{\"user\":\"" + s->user_key + "\",\"role\":\"" + s->role + "\"}");
    });

    router.add("POST", "/v1/applications/{id}/decisions", [](const mini::Request& rq) {
        std::lock_guard<std::mutex> lk(mu);
        auto s = current_session(rq);
        if (!s) return mini::problem(401, "no-session", "Unauthorized", "log in first");
        // RBAC: only these roles may decide.
        if (s->role != "CREDIT_OFFICER" && s->role != "BRANCH_MANAGER") {
            audit("authz_denied_role", s->user_key);
            return mini::problem(403, "forbidden", "Forbidden", "role " + s->role + " cannot decide");
        }
        // Attribute check: only applications of the officer's own branch.
        auto app = app_branch.find(std::atoll(rq.params.at("id").c_str()));
        if (app == app_branch.end()) return mini::problem(404, "not-found", "Not Found", "no such application");
        if (app->second != s->branch) {
            audit("authz_denied_branch", s->user_key);
            return mini::problem(403, "forbidden", "Forbidden", "application belongs to another branch");
        }
        audit("decision_recorded", s->user_key);
        return mini::json(201, "{\"application_id\":" + rq.params.at("id") + ",\"decision\":\"recorded\"}");
    });

    router.add("DELETE", "/v1/sessions/current", [](const mini::Request& rq) {
        std::lock_guard<std::mutex> lk(mu);
        auto it = sessions.find(cookie(rq, "sid"));
        if (it != sessions.end()) { audit("logout", it->second.user_key); sessions.erase(it); }
        mini::Response r; r.status = 204;
        return r.set("Set-Cookie", "sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0");
    });

    return mini::run(port, router);
}
```

**Build and run** (terminal 1). Start-up takes about a second because it hashes four passwords:

```bash
g++ -std=c++17 -O2 -Wall -Wextra -Werror -g -pthread -o session_server session_server.cpp -lsodium
./session_server 8081
```

**Log in, use the session, get refused, log out** (terminal 2). `curl -c jar` saves cookies and `-b jar` sends them, like a browser:

```bash
B=http://127.0.0.1:8081; J='Content-Type: application/json'
curl -s -i -c jar -X POST $B/v1/sessions -H "$J" -d '{"branch_code":"MUM001","user_code":"U001","password":"Branch@2026"}'; echo
curl -s -b jar $B/v1/me; echo
curl -s -b jar -X POST $B/v1/applications/1001/decisions; echo
curl -s -b jar -X POST $B/v1/applications/2001/decisions; echo
curl -s -b jar -o /dev/null -w 'logout: %{http_code}\n' -X DELETE $B/v1/sessions/current
curl -s -b jar -o /dev/null -w 'me after logout: %{http_code}\n' $B/v1/me
```

Expected (the session id is random on every login):

```text
HTTP/1.1 201 Created
Content-Type: application/json
Set-Cookie: sid=5dddf2999b16284f40b9e8ec436a881c03f4c928459250121cc189aa2c3253f6; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=900
Content-Length: 46
Connection: keep-alive

{"user":"MUM001/U001","role":"CREDIT_OFFICER"}
{"user":"MUM001/U001","role":"CREDIT_OFFICER"}
{"application_id":1001,"decision":"recorded"}
{"type":"/problems/forbidden","title":"Forbidden","status":403,"detail":"application belongs to another branch"}
logout: 204
me after logout: 401
```

The logout returned `204` and told the browser to delete the cookie, but the decisive step happened on the server: the session row is gone, so even a copy of the old id is now useless. Terminal 1 shows the audit trail:

```text
listening on http://127.0.0.1:8081
AUDIT login_ok MUM001/U001
POST /v1/sessions -> 201
GET /v1/me -> 200
AUDIT decision_recorded MUM001/U001
POST /v1/applications/1001/decisions -> 201
AUDIT authz_denied_branch MUM001/U001
POST /v1/applications/2001/decisions -> 403
AUDIT logout MUM001/U001
DELETE /v1/sessions/current -> 204
GET /v1/me -> 401
```

## 7. Use case: core-banking loan-origination platform

**How the branch login worked.** A branch user typed branch code, user code and password into the thick client, which sent a `LOGIN` call over the TLS-protected RPC channel (H4). The app server then did, in order:

1. `SELECT password_hash, role_id, status FROM users WHERE branch_code = $1 AND user_code = $2`: a primary-key lookup on the composite key `(branch_code, user_code)`, one index probe.
2. Verify the password hash. Deliberately slow: tens of milliseconds of CPU and tens of MiB of memory.
3. Build the user's working context from **master tables keyed by business codes**: the branch row, the role's permissions, the products the branch may sell, the user's sanction limit, the branch holiday calendar.
4. `INSERT INTO audit_log` for the login and `UPDATE users SET last_login_at = now()`.
5. Create the session and return it with the context.

**Where the latency was (claim H7).** Login was slow and got slower as branches and users were added, worst at branch opening time when everyone logs in at once. The tempting wrong fix is to make step 2 cheaper by lowering the hash cost. The execution plans (module 6.10) showed the time was elsewhere: several step-3 lookups did **sequential scans** of master tables because their predicates did not match the leading column of any index (for example a filter on the second column of a composite key, or a function wrapped around the code column such as `upper(user_code)`). On a multi-node distributed cluster (Phase 7) a full scan touches every tablet on every node, so each login paid for several whole-table reads. Capstone C5 recreates this and fixes it with composite indexes whose leading columns match the predicates and covering indexes (`INCLUDE`) so the hot lookups become index-only scans.

**The decision it drove:** **keep Argon2id at a measured, fixed cost per login and treat it as a security budget, not a bottleneck; take the latency out of the database part of login with composite and covering indexes on the business-code lookups (H7), serve the static master rows from the in-memory cache (H4, module 4.13), and cap concurrent hash verifications at the core count so a 9:30 a.m. login storm queues for milliseconds instead of exhausting memory.** Sessions stayed server-side, because every caller was the bank's own client talking to one platform and immediate revocation (a teller leaving, a stolen laptop) mattered more than avoiding one lookup per request. Authorisation was enforced twice: in the server for fast `403`s, and in the PL/pgSQL layer (H6) as the last line of defence.

## 8. Lab

### Part A: hashing cost and memory (25 minutes)

1. Run `./auth_basics` three times. Expected: different salts and hashes every run; `verify correct password: OK`, `verify wrong password: FAIL`; a JWT line identical to section 6.
2. Measure memory: `/usr/bin/time -v ./auth_basics 2>&1 | grep -E "took|Maximum resident"`. Expected: maximum resident set size close to 69,000 KB, the 64 MiB the hash allocates plus the program.
3. Copy the file to `auth_mod.cpp`, replace `INTERACTIVE` with `MODERATE` everywhere (`sed 's/INTERACTIVE/MODERATE/g'`), build and measure again. Expected: about 266,000 KB and `needs rehash at MODERATE limits: no`. The work is about six times larger (four times the memory, one more pass), so expect several times the duration. On the busy 4-core machine used to check this module, interactive hashes took between 231 ms and 1,964 ms across runs and moderate ones about ten times longer, because other jobs competed for CPU and RAM. Run each three times and record the median and the load (`uptime`).
4. Decode the JWT payload: `echo 'eyJzdWIiOiJNVU0wMDEvVTAwMSIsInJvbGUiOiJDUkVESVRfT0ZGSUNFUiIsImlhdCI6MTc5MjM5NjgwMCwiZXhwIjoxNzkyMzk3NzAwfQ' | base64 -d 2>/dev/null; echo`. Expected: the JSON payload, readable by anyone. (base64url omits padding, so `base64 -d` may complain at the end; the text is still printed.)

### Part B: sessions, lockout and authorisation (25 minutes)

1. Run the session in section 6 and compare.
2. Log in as the clerk (`MUM001`, `U002`, `Clerk#2026`) with `-c jar2` and try a decision with `-b jar2`. Expected: `403` with `"role CLERK cannot decide"`.
3. Send five wrong passwords for `PUN002/U001`, then the right one (`Pune$2026`, in single quotes so the shell leaves `$` alone). Expected: `401 401 401 401 401`, then `403` `account-locked`; the server log shows `AUDIT account_locked PUN002/U001`.
4. `cat jar`. Expected: a line beginning `#HttpOnly_127.0.0.1` with `TRUE` in the secure column. curl marks HttpOnly cookies that way; a browser would hide this cookie from JavaScript.
5. Write in your journal why the lockout returns `403` with a specific message while a wrong password returns a generic `401`, and what that reveals to an attacker. (The bank chose to tell a locked user to call the branch manager; that leaks "this account exists and is locked", an accepted trade-off for staff accounts.)

### Part C: break it on purpose (30 minutes)

1. **User enumeration.** In the login handler, replace `stored = it == users.end() ? dummy_hash : ...` so that an unknown user returns `401` immediately without verifying anything. Rebuild. Time five logins for a known user with a wrong password and five for `U999`: `curl -s -o /dev/null -w '%{time_total}\n' ...`. Expected: the unknown user answers in about a millisecond, the known user takes about one hash time. An attacker can now list valid user codes. Restore the dummy hash and repeat: the two groups overlap. (Individual timings are noisy on a busy machine; compare medians of five.)
2. **Session fixation.** Change login to reuse the `sid` cookie the client sent, if any, instead of calling `new_session_id()`. Explain in three sentences how an attacker who can set a cookie in a victim's browser before login would then ride the victim's session. Restore.
3. **Fast hash.** Replace `crypto_pwhash_str_verify` with a comparison of `crypto_hash_sha256` digests (do not commit this). Using your Part A numbers, compute how long an attacker needs to try 10 million common passwords against one stolen hash with each scheme. Expected order of magnitude: seconds versus weeks on one core.

### Part D: authorisation in PL/pgSQL with least privilege (30 minutes)

In the `lab10` database from 10.01 (or a fresh one with the canonical schema), save this as `authz.sql` and run `psql -d lab10 -f authz.sql`:

```sql
-- authz.sql -- role permissions and one authorisation check in PL/pgSQL.
INSERT INTO branches VALUES ('MUM001','Mumbai Fort','Mumbai','WEST','2001-04-01'),
                            ('PUN002','Pune Camp','Pune','WEST','2005-06-15') ON CONFLICT DO NOTHING;
INSERT INTO roles VALUES (1,'CLERK'),(2,'CREDIT_OFFICER'),(3,'BRANCH_MANAGER'),(4,'AUDITOR') ON CONFLICT DO NOTHING;
INSERT INTO products VALUES ('HL01','Home loan',50000000,1000000000,360,850,true) ON CONFLICT DO NOTHING;
INSERT INTO users (branch_code, user_code, full_name, password_hash, role_id) VALUES
  ('MUM001','U001','Ravi Iyer',  '$argon2id$v=19$m=65536,t=2,p=1$...', 2),
  ('MUM001','U002','Neha Shah',  '$argon2id$v=19$m=65536,t=2,p=1$...', 1),
  ('PUN002','U001','Amit Kulkarni','$argon2id$v=19$m=65536,t=2,p=1$...', 2) ON CONFLICT DO NOTHING;
INSERT INTO customers (customer_id, branch_code, full_name, pan, dob, kyc_status)
VALUES (501,'MUM001','Asha Rao','ABCPR1234K','1988-03-14','VERIFIED') ON CONFLICT DO NOTHING;
INSERT INTO loan_applications (application_id, branch_code, customer_id, product_code, amount_paise, tenure_months, status, created_by)
VALUES (1001,'MUM001',501,'HL01',250000000,240,'SUBMITTED','U002') ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id     smallint NOT NULL REFERENCES roles,
  permission  text     NOT NULL,                 -- CREATE_APPLICATION, DECIDE, READ
  PRIMARY KEY (role_id, permission)
);
INSERT INTO role_permissions VALUES
  (1,'CREATE_APPLICATION'), (1,'READ'),
  (2,'DECIDE'), (2,'READ'),
  (3,'DECIDE'), (3,'READ'),
  (4,'READ') ON CONFLICT DO NOTHING;

-- RBAC (role has the permission) + ABAC (same branch, unless auditor). Raises on denial.
CREATE OR REPLACE FUNCTION authorise(p_branch varchar, p_user varchar,
                                     p_permission text, p_application_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER                       -- runs with the owner's rights: callers need no table grants
SET search_path = public, pg_temp      -- never trust the caller's search_path in a definer function
AS $$
DECLARE
  v_role       smallint;
  v_status     char(1);
  v_app_branch varchar(6);
BEGIN
  SELECT role_id, status INTO v_role, v_status
    FROM users WHERE branch_code = p_branch AND user_code = p_user;     -- primary-key lookup
  IF NOT FOUND OR v_status <> 'A' THEN
    RAISE EXCEPTION 'user %/% is unknown or locked', p_branch, p_user
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM role_permissions
                  WHERE role_id = v_role AND permission = p_permission) THEN
    RAISE EXCEPTION 'user %/% lacks %', p_branch, p_user, p_permission
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT branch_code INTO v_app_branch FROM loan_applications WHERE application_id = p_application_id;
  IF v_app_branch IS DISTINCT FROM p_branch AND v_role <> 4 THEN      -- 4 = AUDITOR reads everywhere
    RAISE EXCEPTION 'application % belongs to another branch', p_application_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END $$;

-- Least privilege: the app's login role may call the function and nothing else.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_login') THEN
    CREATE ROLE app_login LOGIN PASSWORD 'change-me';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO app_login;                  -- may look up objects in the schema
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM app_login;   -- but read no table directly
REVOKE EXECUTE ON FUNCTION authorise(varchar, varchar, text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authorise(varchar, varchar, text, bigint) TO app_login;
```

Then act as the application's login role:

```sql
SET ROLE app_login;
SELECT authorise('MUM001', 'U001', 'DECIDE', 1001);
SELECT authorise('MUM001', 'U002', 'DECIDE', 1001);
SELECT authorise('PUN002', 'U001', 'DECIDE', 1001);
SELECT count(*) FROM users;
RESET ROLE;
```

Expected:

```text
 authorise
-----------

(1 row)

ERROR:  user MUM001/U002 lacks DECIDE
CONTEXT:  PL/pgSQL function authorise(character varying,character varying,text,bigint) line 15 at RAISE
ERROR:  application 1001 belongs to another branch
CONTEXT:  PL/pgSQL function authorise(character varying,character varying,text,bigint) line 20 at RAISE
ERROR:  permission denied for table users
```

The officer passes; the clerk fails on the role; the Pune officer fails on the branch; and the application role itself cannot read `users`, yet the function can, because it runs as its owner. Finally run `EXPLAIN (COSTS OFF) SELECT role_id, status FROM users WHERE branch_code = 'MUM001' AND user_code = 'U001';` as `postgres`. Expected: `Index Scan using users_pkey` with both columns in `Index Cond`. Now try `... WHERE user_code = 'U001'` on a table with thousands of users (capstone C5 generates them) and note the plan: that is the shape of the H7 problem.

### Journal

Copy [journal/TEMPLATE.md](../journal/TEMPLATE.md) to `journal/YYYY-MM-DD-authentication-and-sessions.md`. Record: the hash time and maximum resident size at interactive and moderate limits; the SHA-256 and Argon2id guesses per second and your 10-million-guess estimate; the known versus unknown user timings with and without the dummy hash; the three `authorise` results; and one paragraph telling the H7 login story in your own words: the five login steps, where the time went, and why you did not lower the hash cost.

## 9. Common mistakes and misconceptions

| Mistake | Why it is wrong | Bug it causes |
|---|---|---|
| Storing passwords with SHA-256 or MD5, even salted | fast hashes allow billions of guesses per second | a database leak becomes mass account takeover |
| Encrypting passwords "so we can recover them" | whoever has the key has every password | one key leak exposes all users; resets should be the only recovery |
| Comparing secrets with `==` or `memcmp` | early exit leaks how many bytes matched | MAC or token recovered byte by byte through timing |
| Keeping the session id after login | an id planted before login stays valid | session fixation |
| Session ids from `rand()` or time | predictable from a few samples | session hijacking |
| JWT in `localStorage` | any XSS can read it | token theft; prefer `HttpOnly` cookies |
| Trusting the token's `alg` header | `none` or RS256-as-HS256 tricks | forged tokens accepted |
| Long-lived JWTs with no revocation plan | they stay valid after logout or dismissal | ex-employee keeps access until `exp` |
| "Logged in" treated as "allowed" | authentication says who, not what | clerk approves loans; officer reads another branch |
| Lowering hash cost to fix slow login | the hash is a fixed, deliberate cost | weaker passwords on disk while the real bottleneck (scans) remains |
| Logging the password field or the session cookie | logs are read by many people and kept for years | credentials leaked through the log pipeline |

## 10. Resume link

- **Claim H7, "fixing a login-latency bottleneck ... full-table scans on master tables keyed by business codes ... composite and covering indexes".** Tell the five-step login flow, then: "The plans showed sequential scans in the context-loading step, not in password verification. The password hash is a deliberate fixed cost; I would never trade it for latency. We fixed the scans with composite indexes matching the predicate order and covering indexes for the hot lookups." Back it with your capstone C5 numbers.
- **Claim H6, "PL/pgSQL stored-procedure layer centralising validation, authorisation".** Show `authorise()`: RBAC by role permission plus an attribute check on branch, `SECURITY DEFINER` with a pinned `search_path`, and an application role with execute rights only.
- **Claim H4.** The session check is on every request's hot path, so it is a memory lookup, not a database query.
- **Claim E and 5.09.** mTLS for service identity; TLS on the branch channel.

Likely follow-ups: "Why sessions and not JWT?" (one platform, our own clients, instant revocation). "How do you stop someone guessing passwords?" (slow hash, lockout with manager unlock, per-IP and per-account rate limits, MFA for high-risk roles, audit and alerting on failure rates).

## 11. Interview questions

**Q1 (easy). What is the difference between authentication and authorisation, and which HTTP status goes with each failure?**

<details>
<summary>Model answer</summary>

Authentication establishes who the caller is: a password, an OTP, a client certificate, or a session or token issued after one of those. Authorisation decides whether that identity may perform this action on this resource. A missing or invalid identity is `401 Unauthorized` (despite the name, it means unauthenticated); a known identity without permission is `403 Forbidden`. In our platform a teller with a valid session trying to approve a loan gets `403`, and a request with an expired session gets `401`.

</details>

**Q2 (easy). How should passwords be stored, and why are salt and slowness both needed?**

<details>
<summary>Model answer</summary>

Store only the output of a password-hashing function designed to be slow and memory-hard, today Argon2id (or scrypt or bcrypt), with a random per-user salt, and keep the algorithm parameters with the hash so they can be raised later. The salt makes identical passwords hash differently and defeats precomputed tables, but it does not slow a targeted attack on one hash. Slowness and memory cost do that: in my measurement SHA-256 allowed about a million guesses per second per core while Argon2id at interactive settings allowed a few, and the 64 MiB per guess blunts GPUs. Verification uses a constant-time comparison, and I rehash on login when parameters change.

</details>

**Q3 (medium). Compare server-side sessions with JWTs. When would you choose each?**

<details>
<summary>Model answer</summary>

A session is a random id in an `HttpOnly`, `Secure`, `SameSite` cookie that points to server-side state; each request costs a lookup, and revocation is immediate by deleting the row. A JWT is a signed, self-contained set of claims; any service with the key verifies it without a lookup, which suits many services and third-party APIs, but it stays valid until `exp`, so revocation needs short lifetimes plus revocable refresh tokens, or a denylist that reintroduces a lookup. JWT payloads are readable, so they must not carry sensitive data, and verifiers must pin the algorithm. For staff of one platform, I choose sessions; for an identity provider serving many services and partners, short-lived RS256 access tokens with rotating refresh tokens.

</details>

**Q4 (medium). HS256 or RS256 for tokens consumed by ten microservices? What can go wrong?**

<details>
<summary>Model answer</summary>

RS256 (or ES256). With HS256 the verification key is the signing key, so every one of the ten services could mint tokens, and a leak from the weakest service compromises all of them. With RS256 only the identity service holds the private key; the others fetch the public key from a JWKS endpoint, which also supports key rotation by key id (`kid`). Failure modes: accepting `alg: none`; algorithm confusion, where a verifier that trusts the header checks an HS256 token using the RSA public key as the HMAC secret; not checking `aud`, so a token for one service works at another; not checking `exp` or allowing large clock skew; and putting personal data in the readable payload. The fix is a verifier configured with the expected algorithm, issuer and audience.

</details>

**Q5 (hard). Design staff login for 5,000 branches that all open at 9:30 a.m. Cover password storage, capacity, abuse, sessions, authorisation and the latency budget.**

<details>
<summary>Model answer</summary>

Storage: Argon2id with parameters chosen by measuring the production CPU, targeting tens of milliseconds and a memory size the login hosts can afford; rehash on login when parameters change. Capacity: assume a peak of a few thousand logins per minute; each verification needs its memory while running, so I bound concurrent verifications per host with a semaphore sized to cores and RAM and size the host count from measured hashes per second per core, with headroom. Abuse: generic error messages and a dummy-hash verify for unknown users; lockout after five failures with a manager unlock and alerting, plus per-IP and per-account rate limits at the gateway; OTP step-up for officers sanctioning above a threshold. Sessions: 256-bit random ids from the kernel CSPRNG in `HttpOnly`, `Secure`, `SameSite=Strict` cookies, new id at login, 15-minute idle and 8-hour absolute expiry, stored in a shared store so any app instance can validate, and revocable on logout or dismissal. Authorisation: RBAC plus branch and sanction-limit attributes, enforced in the service and again in the PL/pgSQL procedures, with the app's database role limited to executing procedures. Audit: every auth event to `audit_log` without secrets. Latency budget: primary-key user lookup, the fixed hash cost, then context loading; context loading must be index lookups or cache hits, never scans. That last point is exactly the H7 incident: the plans showed sequential scans on business-code lookups, and composite and covering indexes plus the master cache fixed it without touching the hash cost.

</details>

## 12. Revision

- Authentication proves identity once (salted Argon2id hash, constant-time verify, lockout, MFA); a session or token carries it afterwards; authorisation (RBAC plus attribute checks, in the server and in PL/pgSQL) runs on every request.
- Sessions: random 256-bit id in an `HttpOnly`, `Secure`, `SameSite` cookie, new id at login, idle and absolute expiry, instant revocation. JWT: signed not encrypted, pin the algorithm, short access plus revocable refresh tokens; HS256 shares one key, RS256 separates minting from verifying.
- Branch login (H7): primary-key user lookup, deliberate hash cost, context from master tables; the latency was full scans on business-code lookups, fixed with composite and covering indexes, never by weakening the hash.

---

Previous: [Module 10.01: HTTP/REST API design](module-01-http-rest-api-design.md) | Next: [Module 10.03: Caching strategies](module-03-caching-strategies.md)
