# main.py: latency report from raw samples (one number per line, in ms).
import sys


def percentile(sorted_values, p):
    """Nearest-rank percentile: the value at rank ceil(p/100 * n), counting from 1."""
    # TODO: compute the rank with integer maths and return sorted_values[rank - 1]
    return sorted_values[0]


def main():
    samples = [float(tok) for tok in sys.stdin.read().split()]
    if not samples:
        print("no samples")
        return
    samples.sort()
    print(f"count = {len(samples)}")
    # TODO: print min, p50, p90, p99, max and mean, each with one decimal and " ms"


main()
