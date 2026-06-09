#!/usr/bin/env python3
"""
Daily updater for the VM 2026 tracker. Run by GitHub Actions.

Writes:
  data/results.json  — scores/status keyed by our internal match ids (m1..m104)
  data/omx.json      — OMXS30 daily closes (normalised to 200 in the browser)
  data/sp500.json    — S&P 500 daily closes (normalised to 200 in the browser)

Result sources (in priority order, both optional / degrade gracefully):
  1. football-data.org  — set repo secret FOOTBALL_DATA_TOKEN (free tier covers the World Cup)
  2. TheSportsDB        — free key '3' by default; set THESPORTSDB_KEY to use your own

OMXS30 source: Stooq CSV (symbol ^OMX), no key needed.

Nothing here ever deletes existing scores: a failed fetch leaves the file as-is,
so the website never breaks. You can also edit data/results.json by hand.
"""
import json, os, re, sys, unicodedata, urllib.request, urllib.error
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "data", "fixtures.json")
RESULTS = os.path.join(ROOT, "data", "results.json")
OMX = os.path.join(ROOT, "data", "omx.json")
SP500 = os.path.join(ROOT, "data", "sp500.json")
START_DATE = "2026-06-10"  # day before kickoff, baseline for the index

ALIASES = {
    "korearepublic": "southkorea", "republicofkorea": "southkorea", "korea": "southkorea",
    "turkiye": "turkey",
    "unitedstates": "usa", "unitedstatesofamerica": "usa",
    "ivorycoast": "cotedivoire",
    "drcongo": "congodr", "democraticrepublicofthecongo": "congodr", "dccongo": "congodr",
    "capeverde": "caboverde",
    "bosniaandherzegovina": "bosnia", "bosniaherzegovina": "bosnia", "bosniahercegovina": "bosnia",
    "czechrepublic": "czechia",
}


def norm(name):
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z]", "", s.lower())
    return ALIASES.get(s, s)


def http_get(url, headers=None, timeout=30):
    req = urllib.request.Request(url, headers=headers or {"User-Agent": "wc2026-tracker"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def load(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def build_match_index(fixtures):
    """norm(home)|norm(away)|YYYY-MM-DD(UTC) -> match id, plus a date-loose fallback."""
    teams = fixtures["teams"]
    exact, loose = {}, {}
    for m in fixtures["matches"]:
        if m["stage"] != "GROUP":
            continue  # only group matches keyed by fixed teams; KO resolves client-side
        h = norm(teams[m["home"]]["en"])
        a = norm(teams[m["away"]]["en"])
        d = m["kickoff"][:10]
        exact[f"{h}|{a}|{d}"] = m["id"]
        loose.setdefault(f"{h}|{a}", []).append((d, m["id"]))
    return exact, loose


def match_id(exact, loose, home, away, date):
    h, a = norm(home), norm(away)
    key = f"{h}|{a}|{date}"
    if key in exact:
        return exact[key]
    # date-loose: nearest within +/- 1 day
    for k in (f"{h}|{a}", f"{a}|{h}"):
        if k in loose:
            cand = sorted(loose[k], key=lambda x: abs(
                (datetime.fromisoformat(x[0]) - datetime.fromisoformat(date)).days))
            if cand and abs((datetime.fromisoformat(cand[0][0]) - datetime.fromisoformat(date)).days) <= 1:
                return cand[0][1]
    return None


def status_norm(s):
    s = (s or "").upper()
    if s in ("FINISHED", "FT", "MATCH FINISHED", "AET", "PEN"):
        return "FINISHED"
    if s in ("IN_PLAY", "PAUSED", "1H", "2H", "HT", "LIVE", "ET"):
        return "IN_PLAY"
    return "SCHEDULED"


def fetch_football_data(token):
    """Return raw games: {home, away (names), hs, as, status, date, hpen?, apen?}."""
    url = "https://api.football-data.org/v4/competitions/WC/matches"
    data = json.loads(http_get(url, headers={"X-Auth-Token": token}))
    games = []
    for m in data.get("matches", []):
        score = m.get("score", {}).get("fullTime", {})
        if score.get("home") is None or score.get("away") is None:
            continue
        g = {"home": m["homeTeam"]["name"], "away": m["awayTeam"]["name"],
             "hs": score["home"], "as": score["away"],
             "status": status_norm(m.get("status")), "date": m.get("utcDate", "")[:10]}
        pens = m.get("score", {}).get("penalties", {})
        if pens.get("home") is not None:
            g["hpen"] = pens["home"]; g["apen"] = pens["away"]
        games.append(g)
    return games


def fetch_thesportsdb(key, fixtures):
    games = []
    dates = sorted({m["kickoff"][:10] for m in fixtures["matches"]})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for d in dates:
        if d > today:
            continue
        try:
            url = f"https://www.thesportsdb.com/api/v1/json/{key}/eventsday.php?d={d}&s=Soccer"
            data = json.loads(http_get(url))
        except Exception as e:
            print(f"  TheSportsDB {d}: {e}", file=sys.stderr)
            continue
        for ev in (data.get("events") or []):
            if "world cup" not in (ev.get("strLeague") or "").lower():
                continue
            hs, as_ = ev.get("intHomeScore"), ev.get("intAwayScore")
            if hs in (None, "") or as_ in (None, ""):
                continue
            games.append({"home": ev.get("strHomeTeam", ""), "away": ev.get("strAwayTeam", ""),
                          "hs": int(hs), "as": int(as_),
                          "status": status_norm(ev.get("strStatus") or ev.get("strProgress")),
                          "date": d})
    return games


# ---- knockout resolution -------------------------------------------------
# KO matchups aren't known in advance, so we resolve the bracket from results
# round by round and store the actual teams alongside the score. The website
# reads those stored teams, so it advances the bracket without needing FIFA's
# best-third lookup table (the real third team simply arrives with the result).

def group_standings(fixtures, results):
    teams = fixtures["teams"]
    out = {}
    for g, codes in fixtures["groups"].items():
        row = {c: {"c": c, "pts": 0, "gd": 0, "gf": 0} for c in codes}
        played = total = 0
        for m in fixtures["matches"]:
            if m["stage"] != "GROUP" or m["group"] != g:
                continue
            total += 1
            r = results["matches"].get(m["id"])
            if not r or r.get("homeScore") is None:
                continue
            played += 1
            h, a = row[m["home"]], row[m["away"]]
            hs, as_ = r["homeScore"], r["awayScore"]
            h["gf"] += hs; a["gf"] += as_; h["gd"] += hs - as_; a["gd"] += as_ - hs
            if hs > as_: h["pts"] += 3
            elif as_ > hs: a["pts"] += 3
            else: h["pts"] += 1; a["pts"] += 1
        table = sorted(row.values(), key=lambda t: (-t["pts"], -t["gd"], -t["gf"], teams[t["c"]]["sv"]))
        out[g] = {"order": [t["c"] for t in table], "complete": played == total and total > 0}
    return out


def ko_winner_loser(entry, home, away):
    if not entry or entry.get("status") != "FINISHED":
        return (None, None)
    hs, as_ = entry["homeScore"], entry["awayScore"]
    if hs > as_: return (home, away)
    if as_ > hs: return (away, home)
    hp, ap = entry.get("homePens"), entry.get("awayPens")
    if hp is not None and ap is not None:
        return (home, away) if hp > ap else (away, home)
    return (None, None)


def match_knockouts(fixtures, results, games, to_code):
    standings = group_standings(fixtures, results)
    resolved = {}  # mid -> (home_code, away_code)
    for mid, e in results["matches"].items():
        if e.get("home") and e.get("away"):
            resolved[mid] = (e["home"], e["away"])

    def concrete(ref):
        if re.match(r"^[12][A-L]$", ref):
            g = standings.get(ref[1])
            if g and g["complete"]:
                return g["order"][0] if ref[0] == "1" else g["order"][1]
        return None

    def outcome(mid):
        if mid not in resolved:
            return (None, None)
        return ko_winner_loser(results["matches"].get(mid), *resolved[mid])

    def ref_code(ref):
        if re.match(r"^[12][A-L]$", ref):
            return concrete(ref)
        if ref.startswith("3:"):
            return None
        if ref[0] in ("W", "L"):
            w, l = outcome("m" + ref[1:])
            return w if ref[0] == "W" else l
        return None

    ko = sorted([m for m in fixtures["matches"] if m["stage"] == "KO"], key=lambda x: x["no"])
    used = set()
    count = 0
    for m in ko:
        hc, ac = ref_code(m["homeRef"]), ref_code(m["awayRef"])
        if not hc:
            continue
        chosen = None
        for i, g in enumerate(games):
            if i in used:
                continue
            gh, ga = to_code(g["home"]), to_code(g["away"])
            if not gh or not ga:
                continue
            cs = {gh, ga}
            if ac and cs == {hc, ac}:
                chosen = (i, g); break
            if m["roundKey"] == "R32" and not ac and hc in cs:
                chosen = (i, g); break
        if not chosen:
            continue
        i, g = chosen
        gh = to_code(g["home"])
        if gh == hc:
            H, A, hs, as_, hp, ap = hc, to_code(g["away"]), g["hs"], g["as"], g.get("hpen"), g.get("apen")
        else:
            H, A, hs, as_, hp, ap = hc, gh, g["as"], g["hs"], g.get("apen"), g.get("hpen")
        entry = {"homeScore": hs, "awayScore": as_, "status": g["status"], "home": H, "away": A}
        if hp is not None and ap is not None:
            entry["homePens"] = hp; entry["awayPens"] = ap
        results["matches"][m["id"]] = entry
        resolved[m["id"]] = (H, A)
        used.add(i)
        count += 1
    return count


def update_results(fixtures):
    exact, loose = build_match_index(fixtures)
    results = load(RESULTS, {"matches": {}})
    results.setdefault("matches", {})

    token = os.environ.get("FOOTBALL_DATA_TOKEN", "").strip()
    games = []
    if token:
        try:
            games = fetch_football_data(token)
            print(f"football-data.org: {len(games)} games with scores")
        except Exception as e:
            print(f"football-data.org failed: {e}", file=sys.stderr)
    if not games:
        key = os.environ.get("THESPORTSDB_KEY", "3").strip() or "3"
        try:
            games = fetch_thesportsdb(key, fixtures)
            print(f"TheSportsDB: {len(games)} games with scores")
        except Exception as e:
            print(f"TheSportsDB failed: {e}", file=sys.stderr)

    code_by_norm = {norm(t["en"]): code for code, t in fixtures["teams"].items()}
    def to_code(name):
        return code_by_norm.get(norm(name))

    # group stage: matched by fixed teams + date
    gcount = 0
    for g in games:
        mid = match_id(exact, loose, g["home"], g["away"], g["date"])
        if not mid:
            continue
        entry = {"homeScore": g["hs"], "awayScore": g["as"], "status": g["status"]}
        if "hpen" in g:
            entry["homePens"] = g["hpen"]; entry["awayPens"] = g["apen"]
        results["matches"][mid] = entry
        gcount += 1

    # knockout stage: resolve bracket from results, store score + actual teams
    kcount = match_knockouts(fixtures, results, games, to_code)

    results["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(RESULTS, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"results.json: {gcount} group + {kcount} knockout matched, {len(results['matches'])} total")


def update_index(path, stooq_symbol, default_symbol):
    idx = load(path, {"symbol": default_symbol, "history": []})
    url = "https://stooq.com/q/d/l/?s=%s&i=d" % stooq_symbol
    try:
        csv = http_get(url)
    except Exception as e:
        print(f"Stooq {default_symbol} failed: {e}", file=sys.stderr)
        return
    rows = [r for r in csv.strip().splitlines() if r and r[0].isdigit()]
    hist = {x["date"]: x for x in idx.get("history", [])}
    added = 0
    for r in rows:
        parts = r.split(",")
        if len(parts) < 5:
            continue
        date, close = parts[0], parts[4]
        if date < START_DATE or close in ("", "N/D"):
            continue
        try:
            c = float(close)
        except ValueError:
            continue
        if date not in hist:
            added += 1
        hist[date] = {"date": date, "close": c}
    idx["history"] = [hist[k] for k in sorted(hist)]
    idx["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=2)
    fname = os.path.basename(path)
    print(f"{fname}: {len(idx['history'])} closes ({added} new)")


def main():
    fixtures = load(FIXTURES, None)
    if not fixtures:
        print("fixtures.json missing", file=sys.stderr)
        sys.exit(1)
    update_results(fixtures)
    update_index(OMX, "%5Eomx", "^OMX")
    update_index(SP500, "%5Espx", "^SPX")


if __name__ == "__main__":
    main()
