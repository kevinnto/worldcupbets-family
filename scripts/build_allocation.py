#!/usr/bin/env python3
"""Parse FIFA's 495-row R32 third-place allocation and validate it rigorously.

Output: data/third_allocation.json  ->  { "<8 sorted groups>": "<8 thirds in slot order>" }
Slot order (the group winners that face a third): A B D E G I K L
"""
import json, sys, os, itertools

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "r32_alloc_raw.txt")
OUT = os.path.join(HERE, "..", "data", "third_allocation.json")

ALL_GROUPS = list("ABCDEFGHIJKL")          # 12 groups
SLOTS = list("ABDEGIKL")                    # 8 winner-groups that face a 3rd (table column order)
# Each slot's allowed candidate groups for its 3rd-placed opponent (from the published R32 schedule)
CANDIDATES = {
    "A": set("CEFHI"),   # Match 79: Winner A vs 3rd C/E/F/H/I
    "B": set("EFGIJ"),   # Match 85: Winner B vs 3rd E/F/G/I/J
    "D": set("BEFIJ"),   # Match 81: Winner D vs 3rd B/E/F/I/J
    "E": set("ABCDF"),   # Match 74: Winner E vs 3rd A/B/C/D/F
    "G": set("AEHIJ"),   # Match 82: Winner G vs 3rd A/E/H/I/J
    "I": set("CDFGH"),   # Match 77: Winner I vs 3rd C/D/F/G/H
    "K": set("DEIJL"),   # Match 87: Winner K vs 3rd D/E/I/J/L
    "L": set("EHIJK"),   # Match 80: Winner L vs 3rd E/H/I/J/K
}

def parse():
    rows = []
    with open(RAW, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            idx, rest = line.split(":", 1)
            left, right = rest.split("|")
            key_groups = left.split()
            thirds = [t.replace("3", "") for t in right.split()]
            rows.append((int(idx), key_groups, thirds))
    return rows

def validate(rows):
    errs = []
    # 1) row count
    if len(rows) != 495:
        errs.append(f"expected 495 rows, got {len(rows)}")
    # 2) indices 1..495 in order
    for i, (idx, _, _) in enumerate(rows, start=1):
        if idx != i:
            errs.append(f"row {i}: index field says {idx}")
            break
    keys_seen = {}
    for idx, key_groups, thirds in rows:
        ctx = f"row {idx}"
        # key: 8 distinct groups from A-L
        if len(key_groups) != 8:
            errs.append(f"{ctx}: key has {len(key_groups)} groups, expected 8"); continue
        if len(set(key_groups)) != 8:
            errs.append(f"{ctx}: key has duplicate groups {key_groups}")
        if any(g not in ALL_GROUPS for g in key_groups):
            errs.append(f"{ctx}: key has invalid group {key_groups}")
        # value: 8 thirds
        if len(thirds) != 8:
            errs.append(f"{ctx}: value has {len(thirds)} thirds, expected 8"); continue
        # bijection: the 8 assigned thirds must be exactly the 8 qualifying groups (a permutation)
        if set(thirds) != set(key_groups):
            errs.append(f"{ctx}: assigned thirds {sorted(thirds)} != qualifying groups {sorted(key_groups)}")
        if len(set(thirds)) != 8:
            errs.append(f"{ctx}: a third is assigned to two slots {thirds}")
        # candidate-list compliance: slot order is SLOTS
        for slot, third in zip(SLOTS, thirds):
            if third not in CANDIDATES[slot]:
                errs.append(f"{ctx}: slot 1{slot} got 3{third}, not allowed (allowed: {sorted(CANDIDATES[slot])})")
        # distinct keys & coverage
        ck = "".join(sorted(key_groups))
        if ck in keys_seen:
            errs.append(f"{ctx}: duplicate combination {ck} (also row {keys_seen[ck]})")
        keys_seen[ck] = idx
    # 3) coverage: every C(12,8) combination present exactly once
    expected = {"".join(c) for c in itertools.combinations(ALL_GROUPS, 8)}
    got = set(keys_seen)
    missing = expected - got
    extra = got - expected
    if missing:
        errs.append(f"missing {len(missing)} combinations, e.g. {sorted(missing)[:5]}")
    if extra:
        errs.append(f"unexpected {len(extra)} combinations, e.g. {sorted(extra)[:5]}")
    return errs, keys_seen

def build(rows):
    table = {}
    for idx, key_groups, thirds in rows:
        ck = "".join(sorted(key_groups))
        # store thirds in SLOTS order as a compact string
        table[ck] = "".join(thirds)
    return table

def main():
    rows = parse()
    errs, keys = validate(rows)
    if errs:
        print("VALIDATION FAILED:")
        for e in errs[:40]:
            print("  -", e)
        print(f"... {len(errs)} total errors" if len(errs) > 40 else f"{len(errs)} errors")
        sys.exit(1)
    table = build(rows)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"slotOrder": "".join(SLOTS), "table": table}, f, separators=(",", ":"), sort_keys=True)
    print("VALIDATION PASSED")
    print(f"  495 rows, all bijections valid, all candidate-list constraints satisfied")
    print(f"  coverage: all {len(table)} combinations of 8-from-12 present exactly once")
    print(f"  wrote {OUT} ({os.path.getsize(OUT)} bytes)")

if __name__ == "__main__":
    main()
