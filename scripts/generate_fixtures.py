#!/usr/bin/env python3
"""
Builds data/fixtures.json for the World Cup 2026 tracker.

All kickoff clock times in the source schedule are US Eastern (EDT = UTC-4 in
June/July). We store each kickoff as a UTC ISO timestamp; the website renders it
in Europe/Stockholm time client-side (so DST is always correct).

This is a one-off build script. You normally never need to re-run it.
"""
import json
from datetime import datetime, timedelta, timezone

ET = timezone(timedelta(hours=-4))  # EDT, valid for June/July 2026

# --- Teams: code -> (swedish name, english name, flag emoji) ----------------
TEAMS = {
    "MEX": ("Mexiko", "Mexico", "🇲🇽"),
    "RSA": ("Sydafrika", "South Africa", "🇿🇦"),
    "KOR": ("Sydkorea", "Korea Republic", "🇰🇷"),
    "CZE": ("Tjeckien", "Czechia", "🇨🇿"),
    "CAN": ("Kanada", "Canada", "🇨🇦"),
    "BIH": ("Bosnien", "Bosnia and Herzegovina", "🇧🇦"),
    "QAT": ("Qatar", "Qatar", "🇶🇦"),
    "SUI": ("Schweiz", "Switzerland", "🇨🇭"),
    "BRA": ("Brasilien", "Brazil", "🇧🇷"),
    "MAR": ("Marocko", "Morocco", "🇲🇦"),
    "HAI": ("Haiti", "Haiti", "🇭🇹"),
    "SCO": ("Skottland", "Scotland", "🏴󠁧󠁢󠁳󠁣󠁴󠁿"),
    "USA": ("USA", "United States", "🇺🇸"),
    "PAR": ("Paraguay", "Paraguay", "🇵🇾"),
    "AUS": ("Australien", "Australia", "🇦🇺"),
    "TUR": ("Turkiet", "Türkiye", "🇹🇷"),
    "GER": ("Tyskland", "Germany", "🇩🇪"),
    "CUW": ("Curaçao", "Curaçao", "🇨🇼"),
    "CIV": ("Elfenbenskusten", "Ivory Coast", "🇨🇮"),
    "ECU": ("Ecuador", "Ecuador", "🇪🇨"),
    "NED": ("Nederländerna", "Netherlands", "🇳🇱"),
    "JPN": ("Japan", "Japan", "🇯🇵"),
    "SWE": ("Sverige", "Sweden", "🇸🇪"),
    "TUN": ("Tunisien", "Tunisia", "🇹🇳"),
    "BEL": ("Belgien", "Belgium", "🇧🇪"),
    "EGY": ("Egypten", "Egypt", "🇪🇬"),
    "IRN": ("Iran", "Iran", "🇮🇷"),
    "NZL": ("Nya Zeeland", "New Zealand", "🇳🇿"),
    "ESP": ("Spanien", "Spain", "🇪🇸"),
    "CPV": ("Kap Verde", "Cape Verde", "🇨🇻"),
    "KSA": ("Saudiarabien", "Saudi Arabia", "🇸🇦"),
    "URU": ("Uruguay", "Uruguay", "🇺🇾"),
    "FRA": ("Frankrike", "France", "🇫🇷"),
    "SEN": ("Senegal", "Senegal", "🇸🇳"),
    "IRQ": ("Irak", "Iraq", "🇮🇶"),
    "NOR": ("Norge", "Norway", "🇳🇴"),
    "ARG": ("Argentina", "Argentina", "🇦🇷"),
    "ALG": ("Algeriet", "Algeria", "🇩🇿"),
    "AUT": ("Österrike", "Austria", "🇦🇹"),
    "JOR": ("Jordanien", "Jordan", "🇯🇴"),
    "POR": ("Portugal", "Portugal", "🇵🇹"),
    "COD": ("DR Kongo", "DR Congo", "🇨🇩"),
    "UZB": ("Uzbekistan", "Uzbekistan", "🇺🇿"),
    "COL": ("Colombia", "Colombia", "🇨🇴"),
    "ENG": ("England", "England", "🏴󠁧󠁢󠁥󠁮󠁧󠁿"),
    "CRO": ("Kroatien", "Croatia", "🇭🇷"),
    "GHA": ("Ghana", "Ghana", "🇬🇭"),
    "PAN": ("Panama", "Panama", "🇵🇦"),
}

GROUPS = {
    "A": ["MEX", "RSA", "KOR", "CZE"],
    "B": ["CAN", "BIH", "QAT", "SUI"],
    "C": ["BRA", "MAR", "HAI", "SCO"],
    "D": ["USA", "PAR", "AUS", "TUR"],
    "E": ["GER", "CUW", "CIV", "ECU"],
    "F": ["NED", "JPN", "SWE", "TUN"],
    "G": ["BEL", "EGY", "IRN", "NZL"],
    "H": ["ESP", "CPV", "KSA", "URU"],
    "I": ["FRA", "SEN", "IRQ", "NOR"],
    "J": ["ARG", "ALG", "AUT", "JOR"],
    "K": ["POR", "COD", "UZB", "COL"],
    "L": ["ENG", "CRO", "GHA", "PAN"],
}

# (month, day, ET_hour, ET_min, home, away, group, venue, city)
GROUP_MATCHES = [
    # Group A
    (6, 11, 15, 0, "MEX", "RSA", "A", "Estadio Azteca", "Mexico City"),
    (6, 11, 22, 0, "KOR", "CZE", "A", "Estadio Akron", "Guadalajara"),
    (6, 18, 12, 0, "CZE", "RSA", "A", "Mercedes-Benz Stadium", "Atlanta"),
    (6, 18, 21, 0, "MEX", "KOR", "A", "Estadio Akron", "Guadalajara"),
    (6, 24, 21, 0, "CZE", "MEX", "A", "Estadio Azteca", "Mexico City"),
    (6, 24, 21, 0, "RSA", "KOR", "A", "Estadio BBVA", "Monterrey"),
    # Group B
    (6, 12, 15, 0, "CAN", "BIH", "B", "BMO Field", "Toronto"),
    (6, 13, 15, 0, "QAT", "SUI", "B", "Levi's Stadium", "Santa Clara"),
    (6, 18, 15, 0, "SUI", "BIH", "B", "SoFi Stadium", "Inglewood"),
    (6, 18, 18, 0, "CAN", "QAT", "B", "BC Place", "Vancouver"),
    (6, 24, 15, 0, "SUI", "CAN", "B", "BC Place", "Vancouver"),
    (6, 24, 15, 0, "BIH", "QAT", "B", "Lumen Field", "Seattle"),
    # Group C
    (6, 13, 18, 0, "BRA", "MAR", "C", "MetLife Stadium", "East Rutherford"),
    (6, 13, 21, 0, "HAI", "SCO", "C", "Gillette Stadium", "Foxborough"),
    (6, 19, 18, 0, "SCO", "MAR", "C", "Gillette Stadium", "Foxborough"),
    (6, 19, 20, 30, "BRA", "HAI", "C", "Lincoln Financial Field", "Philadelphia"),
    (6, 24, 18, 0, "SCO", "BRA", "C", "Hard Rock Stadium", "Miami"),
    (6, 24, 18, 0, "MAR", "HAI", "C", "Mercedes-Benz Stadium", "Atlanta"),
    # Group D
    (6, 12, 21, 0, "USA", "PAR", "D", "SoFi Stadium", "Inglewood"),
    (6, 13, 0, 0, "AUS", "TUR", "D", "BC Place", "Vancouver"),
    (6, 19, 15, 0, "USA", "AUS", "D", "Lumen Field", "Seattle"),
    (6, 19, 23, 0, "TUR", "PAR", "D", "Levi's Stadium", "Santa Clara"),
    (6, 25, 22, 0, "TUR", "USA", "D", "SoFi Stadium", "Inglewood"),
    (6, 25, 22, 0, "PAR", "AUS", "D", "Levi's Stadium", "Santa Clara"),
    # Group E
    (6, 14, 13, 0, "GER", "CUW", "E", "NRG Stadium", "Houston"),
    (6, 14, 19, 0, "CIV", "ECU", "E", "Lincoln Financial Field", "Philadelphia"),
    (6, 20, 16, 0, "GER", "CIV", "E", "BMO Field", "Toronto"),
    (6, 20, 20, 0, "ECU", "CUW", "E", "Arrowhead Stadium", "Kansas City"),
    (6, 25, 16, 0, "CUW", "CIV", "E", "Lincoln Financial Field", "Philadelphia"),
    (6, 25, 16, 0, "ECU", "GER", "E", "MetLife Stadium", "East Rutherford"),
    # Group F
    (6, 14, 16, 0, "NED", "JPN", "F", "AT&T Stadium", "Arlington"),
    (6, 14, 22, 0, "SWE", "TUN", "F", "Estadio BBVA", "Monterrey"),
    (6, 20, 13, 0, "NED", "SWE", "F", "NRG Stadium", "Houston"),
    (6, 20, 0, 0, "TUN", "JPN", "F", "Estadio BBVA", "Monterrey"),
    (6, 25, 19, 0, "JPN", "SWE", "F", "AT&T Stadium", "Arlington"),
    (6, 25, 19, 0, "TUN", "NED", "F", "Arrowhead Stadium", "Kansas City"),
    # Group G
    (6, 15, 15, 0, "BEL", "EGY", "G", "Lumen Field", "Seattle"),
    (6, 15, 21, 0, "IRN", "NZL", "G", "SoFi Stadium", "Inglewood"),
    (6, 21, 15, 0, "BEL", "IRN", "G", "SoFi Stadium", "Inglewood"),
    (6, 21, 21, 0, "NZL", "EGY", "G", "BC Place", "Vancouver"),
    (6, 26, 23, 0, "EGY", "IRN", "G", "Lumen Field", "Seattle"),
    (6, 26, 23, 0, "NZL", "BEL", "G", "BC Place", "Vancouver"),
    # Group H
    (6, 15, 12, 0, "ESP", "CPV", "H", "Mercedes-Benz Stadium", "Atlanta"),
    (6, 15, 18, 0, "KSA", "URU", "H", "Hard Rock Stadium", "Miami"),
    (6, 21, 12, 0, "ESP", "KSA", "H", "Mercedes-Benz Stadium", "Atlanta"),
    (6, 21, 18, 0, "URU", "CPV", "H", "Hard Rock Stadium", "Miami"),
    (6, 26, 20, 0, "CPV", "KSA", "H", "NRG Stadium", "Houston"),
    (6, 26, 20, 0, "URU", "ESP", "H", "Estadio Akron", "Guadalajara"),
    # Group I
    (6, 16, 15, 0, "FRA", "SEN", "I", "MetLife Stadium", "East Rutherford"),
    (6, 16, 18, 0, "IRQ", "NOR", "I", "Gillette Stadium", "Foxborough"),
    (6, 22, 17, 0, "FRA", "IRQ", "I", "Lincoln Financial Field", "Philadelphia"),
    (6, 22, 20, 0, "NOR", "SEN", "I", "MetLife Stadium", "East Rutherford"),
    (6, 26, 15, 0, "NOR", "FRA", "I", "Gillette Stadium", "Foxborough"),
    (6, 26, 15, 0, "SEN", "IRQ", "I", "BMO Field", "Toronto"),
    # Group J
    (6, 16, 21, 0, "ARG", "ALG", "J", "Arrowhead Stadium", "Kansas City"),
    (6, 16, 0, 0, "AUT", "JOR", "J", "Levi's Stadium", "Santa Clara"),
    (6, 22, 13, 0, "ARG", "AUT", "J", "AT&T Stadium", "Arlington"),
    (6, 22, 23, 0, "JOR", "ALG", "J", "Levi's Stadium", "Santa Clara"),
    (6, 27, 22, 0, "JOR", "ARG", "J", "AT&T Stadium", "Arlington"),
    (6, 27, 22, 0, "ALG", "AUT", "J", "Arrowhead Stadium", "Kansas City"),
    # Group K
    (6, 17, 13, 0, "POR", "COD", "K", "NRG Stadium", "Houston"),
    (6, 17, 22, 0, "UZB", "COL", "K", "Estadio Azteca", "Mexico City"),
    (6, 23, 13, 0, "POR", "UZB", "K", "NRG Stadium", "Houston"),
    (6, 23, 22, 0, "COL", "COD", "K", "Estadio Akron", "Guadalajara"),
    (6, 27, 19, 30, "COL", "POR", "K", "Hard Rock Stadium", "Miami"),
    (6, 27, 19, 30, "COD", "UZB", "K", "Mercedes-Benz Stadium", "Atlanta"),
    # Group L
    (6, 17, 16, 0, "ENG", "CRO", "L", "AT&T Stadium", "Arlington"),
    (6, 17, 19, 0, "GHA", "PAN", "L", "BMO Field", "Toronto"),
    (6, 23, 16, 0, "ENG", "GHA", "L", "Gillette Stadium", "Foxborough"),
    (6, 23, 19, 0, "PAN", "CRO", "L", "BMO Field", "Toronto"),
    (6, 27, 17, 0, "PAN", "ENG", "L", "MetLife Stadium", "East Rutherford"),
    (6, 27, 17, 0, "CRO", "GHA", "L", "Lincoln Financial Field", "Philadelphia"),
]

# Knockout: (match_no, month, day, ET_h, ET_m, round, homeRef, awayRef, venue, city)
# Refs: "1A"=winner grp A, "2B"=runner-up grp B, "3:CEFHI"=best-3rd from pool,
#       "W73"=winner of match 73, "L101"=loser of match 101.
KO = [
    (73, 6, 28, 15, 0, "R32", "2A", "2B", "SoFi Stadium", "Inglewood"),
    (74, 6, 29, 13, 0, "R32", "1C", "2F", "NRG Stadium", "Houston"),
    (75, 6, 29, 16, 30, "R32", "1E", "3:ABCDF", "Gillette Stadium", "Boston"),
    (76, 6, 29, 21, 0, "R32", "1F", "2C", "Estadio BBVA", "Monterrey"),
    (77, 6, 30, 13, 0, "R32", "2E", "2I", "AT&T Stadium", "Dallas"),
    (78, 6, 30, 17, 0, "R32", "1I", "3:CDFGH", "MetLife Stadium", "East Rutherford"),
    (79, 6, 30, 21, 0, "R32", "1A", "3:CEFHI", "Estadio Azteca", "Mexico City"),
    (80, 7, 1, 12, 0, "R32", "1L", "3:EHIJK", "Mercedes-Benz Stadium", "Atlanta"),
    (81, 7, 1, 16, 0, "R32", "1G", "3:AEHIJ", "Lumen Field", "Seattle"),
    (82, 7, 1, 20, 0, "R32", "1D", "3:BEFIJ", "Levi's Stadium", "Santa Clara"),
    (83, 7, 2, 15, 0, "R32", "1H", "2J", "SoFi Stadium", "Inglewood"),
    (84, 7, 2, 19, 0, "R32", "2K", "2L", "BMO Field", "Toronto"),
    (85, 7, 2, 23, 0, "R32", "1B", "3:EFGIJ", "BC Place", "Vancouver"),
    (86, 7, 3, 14, 0, "R32", "2D", "2G", "AT&T Stadium", "Dallas"),
    (87, 7, 3, 18, 0, "R32", "1J", "2H", "Hard Rock Stadium", "Miami"),
    (88, 7, 3, 21, 30, "R32", "1K", "3:DEIJL", "Arrowhead Stadium", "Kansas City"),
    (89, 7, 4, 13, 0, "R16", "W73", "W74", "NRG Stadium", "Houston"),
    (90, 7, 4, 17, 0, "R16", "W75", "W76", "Lincoln Financial Field", "Philadelphia"),
    (91, 7, 5, 16, 0, "R16", "W77", "W78", "MetLife Stadium", "East Rutherford"),
    (92, 7, 5, 20, 0, "R16", "W79", "W80", "Estadio Azteca", "Mexico City"),
    (93, 7, 6, 15, 0, "R16", "W81", "W82", "AT&T Stadium", "Dallas"),
    (94, 7, 6, 20, 0, "R16", "W83", "W84", "Lumen Field", "Seattle"),
    (95, 7, 7, 12, 0, "R16", "W85", "W86", "Mercedes-Benz Stadium", "Atlanta"),
    (96, 7, 7, 16, 0, "R16", "W87", "W88", "BC Place", "Vancouver"),
    (97, 7, 9, 16, 0, "QF", "W89", "W90", "Gillette Stadium", "Boston"),
    (98, 7, 10, 15, 0, "QF", "W91", "W92", "SoFi Stadium", "Inglewood"),
    (99, 7, 11, 17, 0, "QF", "W93", "W94", "Hard Rock Stadium", "Miami"),
    (100, 7, 11, 21, 0, "QF", "W95", "W96", "Arrowhead Stadium", "Kansas City"),
    (101, 7, 14, 15, 0, "SF", "W97", "W98", "AT&T Stadium", "Dallas"),
    (102, 7, 15, 15, 0, "SF", "W99", "W100", "Mercedes-Benz Stadium", "Atlanta"),
    (103, 7, 18, 17, 0, "3RD", "L101", "L102", "Hard Rock Stadium", "Miami"),
    (104, 7, 19, 15, 0, "FINAL", "W101", "W102", "MetLife Stadium", "East Rutherford"),
]


def to_utc_iso(month, day, h, m):
    dt = datetime(2026, month, day, h, m, tzinfo=ET).astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def build():
    matches = []
    mid = 1
    for (mo, d, h, mi, home, away, grp, venue, city) in GROUP_MATCHES:
        matches.append({
            "id": f"m{mid}",
            "no": mid,
            "stage": "GROUP",
            "round": f"Grupp {grp}",
            "group": grp,
            "kickoff": to_utc_iso(mo, d, h, mi),
            "home": home,
            "away": away,
            "venue": venue,
            "city": city,
        })
        mid += 1
    round_label = {"R32": "Sextondel (R32)", "R16": "Åttondel (R16)",
                   "QF": "Kvartsfinal", "SF": "Semifinal",
                   "3RD": "Bronsmatch", "FINAL": "Final"}
    for (no, mo, d, h, mi, rnd, hr, ar, venue, city) in KO:
        matches.append({
            "id": f"m{no}",
            "no": no,
            "stage": "KO",
            "round": round_label[rnd],
            "roundKey": rnd,
            "group": None,
            "kickoff": to_utc_iso(mo, d, h, mi),
            "homeRef": hr,
            "awayRef": ar,
            "venue": venue,
            "city": city,
        })

    teams = {code: {"sv": sv, "en": en, "flag": flag}
             for code, (sv, en, flag) in TEAMS.items()}

    data = {
        "tournament": "FIFA World Cup 2026",
        "hosts": "USA · Kanada · Mexiko",
        "timezone": "Europe/Stockholm",
        "teams": teams,
        "groups": GROUPS,
        "matches": matches,
    }
    return data


if __name__ == "__main__":
    data = build()
    with open("data/fixtures.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Wrote {len(data['matches'])} matches "
          f"({sum(1 for m in data['matches'] if m['stage']=='GROUP')} group, "
          f"{sum(1 for m in data['matches'] if m['stage']=='KO')} knockout).")
