"""
A ramp, not a hammer.

The question is not "can it be knocked over" — anything can. It is "at what
concurrency does a page stop arriving in a time an exhibitor would tolerate",
and the only way to answer that is to climb until it does. Read-only GETs:
nothing here books, pays or writes.
"""
import statistics, sys, time
from concurrent.futures import ThreadPoolExecutor
import urllib.request, ssl

URL = sys.argv[1]
CTX = ssl.create_default_context()

def one(_):
    t = time.perf_counter()
    try:
        req = urllib.request.Request(URL, headers={"User-Agent": "ne26-loadtest"})
        with urllib.request.urlopen(req, timeout=30, context=CTX) as r:
            r.read()
            return time.perf_counter() - t, r.status
    except Exception as e:  # noqa: BLE001
        return time.perf_counter() - t, type(e).__name__

print(f"{'conc':>5} {'reqs':>5} {'ok':>4} {'p50':>7} {'p95':>7} {'max':>7} {'req/s':>7}  errors")
for conc in (5, 10, 25, 50, 100, 200):
    n = conc * 3
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=conc) as ex:
        out = list(ex.map(one, range(n)))
    wall = time.perf_counter() - t0
    times = [d for d, _ in out]
    ok = sum(1 for _, s in out if s == 200)
    bad = {}
    for _, s in out:
        if s != 200:
            bad[s] = bad.get(s, 0) + 1
    times.sort()
    p50 = statistics.median(times)
    p95 = times[int(len(times) * 0.95) - 1]
    print(f"{conc:>5} {n:>5} {ok:>4} {p50:>6.2f}s {p95:>6.2f}s {max(times):>6.2f}s {n/wall:>7.1f}  {bad or '-'}")
    time.sleep(3)
