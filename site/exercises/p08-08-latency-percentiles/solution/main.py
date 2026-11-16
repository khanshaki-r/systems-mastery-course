# main.py: latency report from raw samples (one number per line, in ms).
import sys


def percentile(sorted_values, p):
    """Nearest-rank percentile: the value at rank ceil(p/100 * n), counting from 1."""
    n = len(sorted_values)
    rank = max(1, -(-p * n // 100))      # ceil(p * n / 100) in integers
    return sorted_values[rank - 1]


def main():
    samples = [float(tok) for tok in sys.stdin.read().split()]
    if not samples:
        print("no samples")
        return
    samples.sort()
    print(f"count = {len(samples)}")
    print(f"min = {samples[0]:.1f} ms")
    for p in (50, 90, 99):
        print(f"p{p} = {percentile(samples, p):.1f} ms")
    print(f"max = {samples[-1]:.1f} ms")
    print(f"mean = {sum(samples) / len(samples):.1f} ms")


main()
