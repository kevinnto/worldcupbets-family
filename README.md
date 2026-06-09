# VM 2026 Betting Tracker

A static website for tracking betting money during the 2026 FIFA World Cup (11 June to 19 July 2026) for a group of friends. Hosted on GitHub Pages. Match results, the OMXS30 index, and the S&P 500 are refreshed automatically by a GitHub Action every 10 minutes. Betting is shared live via Firebase, so anyone can submit their balance and everyone's site updates instantly.

## Views

- **Spelschema** full schedule of all 104 matches by day, with Swedish kick-off times and auto-fetched results
- **Grupper** the 12 group tables, recomputed in the browser from results (points, goal difference, goals for)
- **Slutspel** the knockout bracket from Round of 32 to the Final, auto-advancing winners as results come in
- **Stålarna** the betting side: pick your player, pick the day, enter your current balance, hit save. Shows the live leader with percentage change, plus a daily line chart of every player against the OMXS30 and S&P 500 indices (all normalised to 200)

## Repository layout

```
.
├── index.html                  Entry point
├── css/styles.css              Styling
├── js/
│   ├── config.js               Firebase config (paste yours here for live mode)
│   └── app.js                  All client logic (standings, bracket, betting, chart)
├── data/
│   ├── fixtures.json           104 matches, 48 teams, 12 groups (static)
│   ├── results.json            Scores, refreshed by the Action
│   ├── omx.json                OMXS30 daily closes, refreshed by the Action
│   ├── sp500.json              S&P 500 daily closes, refreshed by the Action
│   └── betting.json            Fallback betting balances (local mode only)
├── scripts/
│   ├── generate_fixtures.py    One-off builder for fixtures.json
│   ├── update_data.py          Daily fetcher (results + both indices), stdlib only
│   └── requirements.txt        Empty, no dependencies
├── .github/workflows/update.yml  Scheduled data refresh
└── .nojekyll                   Tells GitHub Pages to serve files as-is
```

## Deploy on GitHub Pages

1. Create a new repository and upload the entire folder (keep the structure intact, including the dotfiles `.nojekyll` and `.github/`)
2. Go to **Settings → Pages**, set **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`, and save
3. Wait for the build, then open the published URL

## Enable live betting (Firebase)

This makes the site shared and real-time: anyone submits a balance and every open browser updates within a second. Without it the site still works, but balances are browser-local. The **Stålarna** tab shows step-by-step instructions when you are not connected.

Estimated time: ~10 minutes. Firebase free tier (Spark) is more than enough for 7 friends.

### Step 1 — Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project**
3. Enter any project name (e.g. `vm2026-gänget`) and click through the setup screens
4. Click **Create project** and wait for it to finish

### Step 2 — Enable Realtime Database

1. In the left-hand menu click **Build → Realtime Database**
2. Click **Create database**
3. Choose a location — **europe-west1 (Belgium)** is closest for Sweden
4. When asked about security rules, choose **Start in locked mode**
5. Click **Enable**

### Step 3 — Set the security rules

These rules let your group of friends read and write, and sanity-check the values on writes. Read and write are granted at the root because the app reads the whole database in one call, and Realtime Database does not inherit read permission upward from child nodes.

1. In the Realtime Database page, click the **Rules** tab
2. Delete everything in the editor and paste the following:

```json
{
  "rules": {
    ".read": true,
    ".write": true,
    "balances": {
      "$date": {
        "$player": {
          ".validate": "newData.isNumber() && newData.val() >= 0"
        }
      }
    },
    "bets": {
      "$date": {
        "$player": {
          ".validate": "newData.isString() && newData.val().length <= 200"
        }
      }
    },
    "predictions": {
      "$player": {
        ".validate": "newData.hasChildren(['submitted'])"
      }
    }
  }
}
```

3. Click **Publish**

The rules are public-read-write, which is fine for a small friend group (the worst case is that someone edits a number). If you want to lock it down, enable **Anonymous Authentication** and add `"auth != null"` as the read/write condition.

### Step 4 — Copy your configuration

1. Click the gear icon (⚙) next to "Project Overview" in the top-left
2. Choose **Project settings**
3. Scroll down to **Your apps**
4. Click the web icon **`</>`** to add a web app
5. Enter any nickname (e.g. `vm2026`) and click **Register app**
6. You will see a code block containing a `firebaseConfig` object — copy the whole object (from `{` to `}`)

It looks like this:

```js
{
  apiKey: "AIza...",
  authDomain: "vm2026-gänget.firebaseapp.com",
  databaseURL: "https://vm2026-gänget-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "vm2026-gänget",
  appId: "1:123456789:web:abc123"
}
```

### Step 5 — Paste and deploy

1. Open `js/config.js` in your repository
2. Replace the entire `window.FIREBASE_CONFIG = { … }` placeholder with your copied object
3. Commit and push to the `main` branch
4. Wait for GitHub Pages to redeploy (usually under a minute)
5. Reload the site — the **Stålarna** tab should now show **🟢 Live** instead of **💾 Lokalt läge**

### Common issues

| Problem | Fix |
|---|---|
| Status still shows Lokalt läge after deploy | Check that `databaseURL` in config.js matches exactly what Firebase shows (including the region suffix) |
| Data updates on one device but not another | Make sure you committed the updated `config.js` and GitHub Pages has redeployed |
| GitHub Action fails with a permissions error | Go to **Settings → Actions → General → Workflow permissions** and select **Read and write permissions** |
| Want to see what is stored | In the Firebase console, open **Realtime Database → Data** — you will see the `balances` tree update in real time |

## Enable the daily auto-refresh

1. Go to **Settings → Actions → General → Workflow permissions**, select **Read and write permissions**, and save (this lets the Action commit refreshed data)
2. Optional but recommended: register a free token at football-data.org, then add it under **Settings → Secrets and variables → Actions** as a secret named `FOOTBALL_DATA_TOKEN` for the most reliable scores. Without it, the script falls back to the free TheSportsDB source
3. The workflow runs every 10 minutes (it only commits when a score or index value actually changes, so quiet hours create no commits). To run it immediately, open the **Actions** tab, select "Update WC2026 data", and click **Run workflow**

Open pages also poll the data every minute and re-render themselves, so during a match you see new scores roughly within 10 to 15 minutes without touching anything. Knockout results update automatically too: the updater resolves the bracket from results and stores the actual teams with each score, so third-place-decided matchups and every later round fill in on their own. You can still hand-edit `data/results.json` if a source is ever slow.

## How betting works

Everyone starts at 200 SEK. The amount you enter is always your balance **at the end of that day** — not the change, the running total. Days with no entry inherit the previous day's value.

**Live mode (Firebase configured):** go to **Stålarna**, choose your player and the day, type your end-of-day balance, optionally write what you bet on, and click **Spara**. It writes to the shared database and every open site updates within a second.

**Local mode (no Firebase):** the same form saves to your browser only. Click **Ladda ner betting.json** to download the file and commit it to `data/betting.json` so the group sees the numbers. Nominate one scorekeeper to avoid conflicting commits.

**Bet notes (optional):** the "Vad satsade du på?" field lets each person record what they bet on that day. It is optional and shows up in the player detail view.

**Player detail:** click any player (in the leaderboard or the leader card) to open a panel with their balance curve, a day-by-day table of end-of-day balances and daily change, and what they bet on each day.

**The chart:** hover (or touch) any line to highlight it, dim the others, and show a label with that player's name, balance, and percentage — so you can follow a single line through the tangle.

## The prediction game (Tips tab)

A skill layer alongside the money pool. Before the first kick-off, each player predicts the exact score of all 72 group-stage matches plus a set of bonus picks, then earns points as results come in.

- **Deadline:** the tab locks automatically at the first match kick-off (derived from `fixtures.json`). Before the deadline only your own entry is editable and others' picks stay hidden; after it, everything is read-only and the league + audit open up
- **Point system:** exact score 5 p · right result + goal difference 3 p · right result (1/X/2) 2 p · wrong 0 p. Bonus: correct group winner 3 p (×12), correct finalist 5 p (×2), correct champion 10 p
- **Tipsligan (league):** ranks everyone who submitted in time; points are computed live from results, group standings and the resolved bracket
- **Audit:** click any player in the league to see their full sheet — every group match with their pick, the actual score, and points earned, plus the bonus picks. Nothing is hidden after the deadline

Predictions live in Firebase under `predictions/<player>`, using the same live-sync and local-fallback behaviour as the betting pool.

## Editing results by hand

If a score is missing or wrong, edit `data/results.json`. Each entry is keyed by internal match id (`m1` to `m104`, see `fixtures.json`):

```json
{
  "matches": {
    "m1": { "status": "FINISHED", "homeScore": 3, "awayScore": 0 }
  }
}
```

For knockout matches decided on penalties, add `"homePens"` and `"awayPens"` so the bracket advances the correct team.

## Notes

- Group tables and the knockout bracket are computed in the browser, so the site never breaks if the Action fails or data is empty
- Round of 32 best-third-place slots show as labels until FIFA confirms the allocation after the group stage. Round of 16 onward use match-number linkage and auto-advance winners. Exact cross-pairings are confirmed by FIFA
- All kick-off times are stored in UTC and rendered in Stockholm time, so they stay correct across daylight saving
- Both indices are anchored to the day before kick-off and normalised to 200, so they sit on the same scale as the players

## Regenerating fixtures

Only needed if the schedule changes. Run `python scripts/generate_fixtures.py` to rewrite `data/fixtures.json`.
