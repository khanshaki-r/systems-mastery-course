# main.py: summarise a log file read from stdin.
import sys
from collections import Counter

LEVELS = ("ERROR", "WARN", "INFO")


def main():
    counts = Counter()
    errors_by_service = Counter()
    skipped = 0
    first_error = None
    for raw in sys.stdin.read().splitlines():
        line = raw.strip()
        if not line:
            continue
        parts = line.split(maxsplit=3)
        if len(parts) < 3 or parts[1] not in LEVELS:
            skipped += 1
            continue
        ts, level, service = parts[0], parts[1], parts[2]
        message = parts[3] if len(parts) > 3 else ""
        counts[level] += 1
        if level == "ERROR":
            errors_by_service[service] += 1
            if first_error is None:
                first_error = f"{ts} {service} {message}".rstrip()
    for level in LEVELS:
        print(f"{level} {counts[level]}")
    print(f"skipped {skipped}")
    if errors_by_service:
        service, n = min(errors_by_service.items(), key=lambda kv: (-kv[1], kv[0]))
        print(f"top error service: {service} ({n})")
    else:
        print("top error service: none")
    print(f"first error: {first_error or 'none'}")


main()
