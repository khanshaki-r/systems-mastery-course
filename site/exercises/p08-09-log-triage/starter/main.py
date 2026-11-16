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
        # TODO: split into timestamp, level, service, message; count it or skip it
    for level in LEVELS:
        print(f"{level} {counts[level]}")
    print(f"skipped {skipped}")
    # TODO: print the top error service and the first error


main()
