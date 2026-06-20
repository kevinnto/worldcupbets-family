#!/usr/bin/env python3
"""
Daily updater for the VM 2026 tracker. Run by GitHub Actions.

Writes:
  data/results.json  — scores/status keyed by our internal match ids (m1..m104)
  data/standings.json— official group tables (football-data.org); used for the authoritative
                       within-group order so the third-placed teams are exactly FIFA's
  data/omx.json      — OMXS30 daily closes (normalised to 200 in the browser)
  data/sp500.json    — S&P 500 daily closes (normalised to 200 in the browser)

Result sources (in priority order, both optional / degrade gracefully):
  1. football-data.org  — set repo secret FOOTBALL_DATA_TOKEN (free tier covers the World Cup)
  2. TheSportsDB        — free key '3' by default; set THESPORTSDB_KEY to use your own

OMXS30 source: Stooq CSV (symbol ^OMX), no key needed.

Nothing here ever deletes existing scores: a failed fetch leaves the file as-is,
so the website never breaks. You can also edit data/results.json by hand.
"""
import json, os, re, sys, time, unicodedata, urllib.request, urllib.error, urllib.parse
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FIXTURES = os.path.join(ROOT, "data", "fixtures.json")
RESULTS = os.path.join(ROOT, "data", "results.json")
OMX = os.path.join(ROOT, "data", "omx.json")
SP500 = os.path.join(ROOT, "data", "sp500.json")
STANDINGS = os.path.join(ROOT, "data", "standings.json")
DISCIPLINE = os.path.join(ROOT, "data", "discipline.json")  # optional manual/feed input (fair-play + override)
START_DATE = "2026-06-10"  # anchor day for index normalisation (= betting baseline)

ALIASES = {
    "korearepublic": "southkorea", "republicofkorea": "southkorea", "korea": "southkorea",
    "turkiye": "turkey",
    "unitedstates": "usa", "unitedstatesofamerica": "usa",
    "ivorycoast": "cotedivoire",
    "drcongo": "congodr", "democraticrepublicofthecongo": "congodr", "dccongo": "congodr",
    "capeverde": "caboverde", "caboverde": "caboverde",
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


def fetch_standings(token, fixtures):
    """Official group tables from football-data.org -> {grp: {order:[codes], rows:{...}, complete}}.

    Using the provider's order means FIFA's full within-group tiebreakers (head-to-head,
    fair play) are already applied, so the third-placed team of each group is authoritative.
    """
    url = "https://api.football-data.org/v4/competitions/WC/standings"
    data = json.loads(http_get(url, headers={"X-Auth-Token": token}))
    code_by_norm = {norm(t["en"]): code for code, t in fixtures["teams"].items()}
    groups = {}
    for s in data.get("standings", []):
        if s.get("type") != "TOTAL":      # skip HOME/AWAY split tables
            continue
        grp = (s.get("group") or "").replace("GROUP_", "").replace("Group ", "").strip().upper()
        if grp not in fixtures["groups"]:
            continue
        order, rows, complete = [], {}, True
        for r in s.get("table", []):
            code = code_by_norm.get(norm(r.get("team", {}).get("name", "")))
            if not code:
                continue
            order.append(code)
            rows[code] = {"pts": r.get("points", 0), "gd": r.get("goalDifference", 0),
                          "gf": r.get("goalsFor", 0), "ga": r.get("goalsAgainst", 0),
                          "pld": r.get("playedGames", 0), "w": r.get("won", 0),
                          "d": r.get("draw", 0), "l": r.get("lost", 0)}
            if r.get("playedGames", 0) < 3:
                complete = False
        # only accept a group whose four teams all mapped cleanly
        if len(order) == len(fixtures["groups"][grp]):
            groups[grp] = {"order": order, "rows": rows, "complete": complete}
    return groups


# FIFA team-conduct ("fair play") points: only the single worst sanction per player per match counts.
# Values per FIFA's 2026 regulations: single yellow -1, indirect red (2nd yellow) -3, direct red -4,
# yellow + direct red (same player, same match) -5. Higher (less negative) total ranks higher.
FP_VALUES = {"yellow": -1, "yellow_red": -3, "red": -4, "yellow_and_red": -5}
def fair_play_points(counts):
    """counts = worst-per-player sanction tallies, e.g. {'yellow':5,'yellow_red':1,'red':0,'yellow_and_red':0}."""
    return sum(FP_VALUES[k] * int(counts.get(k, 0)) for k in FP_VALUES)


def update_standings(fixtures):
    """Write official group tables, then fold in optional fair-play points and an official thirds
    override from data/discipline.json (hand-entered, or produced by a paid card-data feed).

    Note: card/booking data is NOT on football-data.org's free tier (deep-data add-on only), so the
    automatic fair-play tiebreaker only activates if discipline.json supplies it. Everything else
    (points, goal difference, goals scored, official within-group order) is covered for free.
    """
    out = load(STANDINGS, {"groups": {}})
    token = os.environ.get("FOOTBALL_DATA_TOKEN", "").strip()
    if token:
        try:
            g = fetch_standings(token, fixtures)
            if g:
                out["groups"] = g
            else:
                print("standings: nothing parsed (kept existing)", file=sys.stderr)
        except Exception as e:
            print(f"standings fetch failed: {e}", file=sys.stderr)

    # optional manual/feed inputs
    disc = load(DISCIPLINE, {})
    fp = disc.get("fp", {})  # {teamCode: number} or {teamCode: {yellow:..,yellow_red:..,red:..,yellow_and_red:..}}
    for grp in out.get("groups", {}).values():
        for code, row in grp.get("rows", {}).items():
            if code in fp:
                v = fp[code]
                row["fp"] = v if isinstance(v, (int, float)) else fair_play_points(v)
    out.pop("thirdsOverride", None)
    ov = disc.get("thirdsOverride")
    if isinstance(ov, list) and len(ov) == 8:
        out["thirdsOverride"] = ov

    if not out.get("groups") and "thirdsOverride" not in out:
        return  # nothing to write (no token, no manual data)
    out["updated"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(STANDINGS, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    done = sum(1 for g in out.get("groups", {}).values() if g.get("complete"))
    extra = []
    if any("fp" in r for g in out.get("groups", {}).values() for r in g.get("rows", {}).values()):
        extra.append("fair-play")
    if "thirdsOverride" in out:
        extra.append("thirds-override")
    print(f"standings.json: {len(out.get('groups', {}))} groups ({done} complete)"
          + (f" + {', '.join(extra)}" if extra else ""))


BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")


def _age_hours(ts, now):
    if not ts:
        return 1e9
    try:
        t = datetime.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    except Exception:
        return 1e9
    return (now - t).total_seconds() / 3600.0


def http_get_retry(url, tries=3, headers=None, timeout=30):
    last = None
    for i in range(tries):
        try:
            return http_get(url, headers=headers, timeout=timeout)
        except Exception as e:
            last = e
            if i < tries - 1:
                time.sleep(2 * (i + 1))
    raise last


def _closes_from_stooq(symbol):
    csv = http_get_retry("https://stooq.com/q/d/l/?s=%s&i=d" % symbol, headers={"User-Agent": BROWSER_UA})
    # stooq returns a short text page (e.g. "Exceeded the daily hits limit") instead of CSV when throttled
    if len(csv) < 200 and "limit" in csv.lower():
        raise RuntimeError("stooq throttled: " + csv.strip()[:80])
    out = []
    for r in csv.strip().splitlines():
        if not r or not r[0].isdigit():
            continue
        p = r.split(",")
        if len(p) < 5:
            continue
        date, close = p[0], p[4]
        if close in ("", "N/D"):
            continue
        try:
            out.append((date, float(close)))
        except ValueError:
            pass
    return out


def _closes_from_yahoo(symbol):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s?range=3mo&interval=1d"
           % urllib.parse.quote(symbol))
    data = json.loads(http_get_retry(url, headers={"User-Agent": BROWSER_UA}))
    res = (data.get("chart", {}).get("result") or [None])[0]
    if not res:
        return []
    ts = res.get("timestamp") or []
    closes = (((res.get("indicators") or {}).get("quote") or [{}])[0]).get("close") or []
    out = []
    for t, c in zip(ts, closes):
        if c is None:
            continue
        date = datetime.fromtimestamp(t, timezone.utc).strftime("%Y-%m-%d")
        out.append((date, float(c)))
    return out


def update_index(path, stooq_symbol, yahoo_symbol, default_symbol, force=False):
    """Index closes change once per trading day, so this self-throttles to ~1 fetch/day
    (independent of the 15-min results cron). Tries Stooq first, then Yahoo Finance, with retries.
    On total failure it keeps the last good data. Forced (or first-ever) runs always fetch."""
    idx = load(path, {"symbol": default_symbol, "history": []})
    now = datetime.now(timezone.utc)
    fname = os.path.basename(path)
    if not force and idx.get("history"):
        if _age_hours(idx.get("updated"), now) < 20:      # already have today's data
            return
        if _age_hours(idx.get("checked"), now) < 1.5:     # back off after a recent attempt
            return
    idx["checked"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")

    rows, src = [], None
    for name, fn, sym in (("Stooq", _closes_from_stooq, stooq_symbol),
                          ("Yahoo", _closes_from_yahoo, yahoo_symbol)):
        try:
            rows = fn(sym)
            if rows:
                src = name
                break
        except Exception as e:
            print(f"{name} {default_symbol} failed: {e}", file=sys.stderr)

    if not rows:  # both sources failed; persist the attempt time (back-off) and keep existing data
        with open(path, "w", encoding="utf-8") as f:
            json.dump(idx, f, ensure_ascii=False, indent=2)
        print(f"{fname}: no data this run, kept {len(idx.get('history', []))} closes", file=sys.stderr)
        return

    hist = {x["date"]: x for x in idx.get("history", [])}
    added = 0
    for date, c in rows:
        if date < START_DATE:
            continue
        if date not in hist:
            added += 1
        hist[date] = {"date": date, "close": c}
    idx["history"] = [hist[k] for k in sorted(hist)]
    idx["updated"] = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(idx, f, ensure_ascii=False, indent=2)
    print(f"{fname}: {len(idx['history'])} closes ({added} new, via {src})")


def main():
    fixtures = load(FIXTURES, None)
    if not fixtures:
        print("fixtures.json missing", file=sys.stderr)
        sys.exit(1)
    update_results(fixtures)
    update_standings(fixtures)
    force_index = os.environ.get("INDEX_FORCE", "").strip() == "1"
    # OMXS30: Yahoo serves the historical time series under ^OMXS30 (legacy ^OMX has no chart data)
    update_index(OMX, "%5Eomx", "^OMXS30", "^OMX", force=force_index)
    update_index(SP500, "%5Espx", "^GSPC", "^SPX", force=force_index)


if __name__ == "__main__":
    main()
