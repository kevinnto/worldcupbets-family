/* ============================================================
   VM 2026 Tracker — app logic
   Fixtures are static. Results + indices (OMXS30, S&P 500) are
   refreshed daily by GitHub Actions. Betting is shared live via
   Firebase Realtime Database when configured (js/config.js),
   otherwise it falls back to local browser + betting.json.
   ============================================================ */
'use strict';

const TZ = 'Europe/Stockholm';
const DATA = { fixtures: null, results: null, omx: null, sp500: null, betting: null };
const DRAFT_KEY = 'wc2026_betting_draft_v2';
const BETTING = { mode: 'local', ref: null };

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

async function getJSON(path) {
  const r = await fetch(path, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function team(code) {
  const t = DATA.fixtures.teams[code];
  return t || { sv: code, en: code, flag: '🏳️' };
}

const swDate = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, day: '2-digit', month: 'short' });
const swTime = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const swDow = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, weekday: 'long' });
const swKey = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

function kickoff(m) {
  const d = new Date(m.kickoff);
  return { date: swDate.format(d), time: swTime.format(d), dow: swDow.format(d), key: swKey.format(d), obj: d };
}
function todayKey() { return swKey.format(new Date()); }

function res(id) {
  const r = DATA.results.matches[id];
  if (!r || r.homeScore == null || r.awayScore == null) return null;
  return r;
}

/* ============================================================
   STANDINGS
   ============================================================ */
function computeGroup(letter) {
  const codes = DATA.fixtures.groups[letter];
  const row = {};
  codes.forEach(c => row[c] = { c, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0 });
  let played = 0, total = 0;
  DATA.fixtures.matches.forEach(m => {
    if (m.stage !== 'GROUP' || m.group !== letter) return;
    total++;
    const r = res(m.id);
    if (!r) return;
    played++;
    const h = row[m.home], a = row[m.away];
    h.p++; a.p++; h.gf += r.homeScore; h.ga += r.awayScore; a.gf += r.awayScore; a.ga += r.homeScore;
    if (r.homeScore > r.awayScore) { h.w++; a.l++; h.pts += 3; }
    else if (r.homeScore < r.awayScore) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  });
  const table = Object.values(row);
  table.forEach(t => t.gd = t.gf - t.ga);
  table.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || team(x.c).sv.localeCompare(team(y.c).sv));
  // when the official standings have been fetched, trust their order (applies FIFA's full
  // tiebreakers incl. head-to-head); our locally-computed stats match, only the order can differ
  const off = DATA.standings && DATA.standings.groups && DATA.standings.groups[letter];
  let official = false;
  if (off && Array.isArray(off.order) && off.order.length === codes.length && off.order.every(c => row[c])) {
    const rank = {}; off.order.forEach((c, i) => rank[c] = i);
    table.sort((x, y) => rank[x.c] - rank[y.c]);
    official = true;
  }
  return { table, complete: played === total && total > 0, played, total, official };
}

function allStandings() {
  const out = {};
  Object.keys(DATA.fixtures.groups).forEach(g => out[g] = computeGroup(g));
  return out;
}

/* ============================================================
   KNOCKOUT RESOLUTION
   ============================================================ */
function refLabel(ref) {
  if (/^[12][A-L]$/.test(ref)) return (ref[0] === '1' ? 'Vinnare grupp ' : '2:a grupp ') + ref[1];
  if (ref.startsWith('3:')) return '3:a (' + ref.slice(2).split('').join('/') + ')';
  if (ref.startsWith('W')) return 'Vinnare match ' + ref.slice(1);
  if (ref.startsWith('L')) return 'Förlorare match ' + ref.slice(1);
  return ref;
}

// returns team code or null
function resolveRef(ref, standings) {
  if (/^[12][A-L]$/.test(ref)) {
    const g = standings[ref[1]];
    if (g && g.complete) return ref[0] === '1' ? g.table[0].c : g.table[1].c;
    return null;
  }
  if (ref.startsWith('3:')) return null; // best-third allocation confirmed by FIFA post-group stage
  if (ref.startsWith('W') || ref.startsWith('L')) {
    const id = 'm' + ref.slice(1);
    const m = DATA.fixtures.matches.find(x => x.id === id);
    if (!m) return null;
    const w = matchWinner(m, standings);
    if (!w) return null;
    return ref[0] === 'W' ? w.winner : w.loser;
  }
  return null;
}

// the 8 groups whose third-placed team is among the best 8 (sorted), or null until the group stage ends
function bestThirdGroups(standings) {
  const best = bestThirds(standings);
  if (!best) return null;
  return Object.keys(DATA.fixtures.groups)
    .filter(g => standings[g].table[2] && best.has(standings[g].table[2].c))
    .sort();
}
// FIFA Annex C: map each third-facing group winner -> the actual third-placed team in its R32 slot
function thirdSlotMap(standings) {
  const groups = bestThirdGroups(standings);
  if (!groups || !DATA.thirdAllocation) return null;
  const assign = DATA.thirdAllocation.table[groups.join('')];
  if (!assign) return null;
  const slotOrder = DATA.thirdAllocation.slotOrder; // "ABDEGIKL"
  const map = {};
  for (let i = 0; i < slotOrder.length; i++) {
    const t = standings[assign[i]];
    map[slotOrder[i]] = (t && t.table[2]) ? t.table[2].c : null;
  }
  return map;
}
function koTeams(m, standings) {
  const r = DATA.results.matches[m.id];
  if (r && r.home && r.away) return { home: r.home, away: r.away };
  // third-slot matches (homeRef "1X" vs awayRef "3:...") resolve via the FIFA allocation table
  if (String(m.awayRef).startsWith('3:')) {
    const map = thirdSlotMap(standings);
    return { home: resolveRef(m.homeRef, standings), away: map ? (map[m.homeRef[1]] || null) : null };
  }
  return { home: resolveRef(m.homeRef, standings), away: resolveRef(m.awayRef, standings) };
}

// winner/loser by score (+ optional penalties field)
function matchWinner(m, standings) {
  const r = res(m.id);
  if (!r || r.status !== 'FINISHED') return null;
  const { home, away } = m.stage === 'KO' ? koTeams(m, standings) : { home: m.home, away: m.away };
  if (!home || !away) return null;
  let hw = r.homeScore > r.awayScore;
  if (r.homeScore === r.awayScore && r.homePens != null && r.awayPens != null) hw = r.homePens > r.awayPens;
  return hw ? { winner: home, loser: away } : { winner: away, loser: home };
}

/* ============================================================
   VIEW: SCHEDULE
   ============================================================ */
let scheduleFilter = 'all';
let favTeam = (() => { try { return localStorage.getItem('wc2026_fav') || 'SWE'; } catch (e) { return 'SWE'; } })();
let onlyFav = false;

function matchInvolves(m, standings) {
  if (!favTeam) return false;
  if (m.stage === 'GROUP') return m.home === favTeam || m.away === favTeam;
  const t = koTeams(m, standings);
  return t.home === favTeam || t.away === favTeam;
}

function matchCard(m, standings, isFav) {
  const ko = kickoff(m);
  let home, away;
  if (m.stage === 'KO') {
    const t = koTeams(m, standings);
    home = t.home ? team(t.home) : { flag: '⬜', sv: refLabel(m.homeRef), tbd: true };
    away = t.away ? team(t.away) : { flag: '⬜', sv: refLabel(m.awayRef), tbd: true };
  } else { home = team(m.home); away = team(m.away); }

  const r = res(m.id);
  const finished = r && r.status === 'FINISHED';
  const live = r && r.status === 'IN_PLAY';
  const mid = r
    ? `<div class="score">${r.homeScore}<span class="vs"> – </span>${r.awayScore}</div>`
    : `<div class="vs">${ko.time}</div>`;
  const status = finished ? `<span class="badge ft">FT</span>`
    : live ? `<span class="badge live">LIVE</span>` : '';

  return `<div class="match ${m.stage === 'KO' ? 'ko' : ''} ${finished ? 'finished' : ''}${isFav ? ' fav' : ''}">
    <div class="side home"><span class="flag">${home.flag}</span><span class="tname">${home.sv}</span></div>
    <div class="mid">${mid}</div>
    <div class="side away"><span class="tname">${away.sv}</span><span class="flag">${away.flag}</span></div>
    <div class="meta">
      <span>${m.round} · ${m.city}</span>
      <span class="ko-time">${status}<span class="kotime">🕒 ${ko.time}</span></span>
    </div>
  </div>`;
}

function renderSchedule() {
  const standings = allStandings();
  const body = $('#schedule-body');
  let ms = DATA.fixtures.matches.slice();
  if (scheduleFilter === 'GROUP') ms = ms.filter(m => m.stage === 'GROUP');
  if (scheduleFilter === 'KO') ms = ms.filter(m => m.stage === 'KO');
  if (onlyFav) ms = ms.filter(m => matchInvolves(m, standings));
  ms.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));

  const byDay = {};
  ms.forEach(m => { const k = kickoff(m); (byDay[k.key] ||= { meta: k, items: [] }).items.push(m); });
  const tkey = todayKey();

  body.innerHTML = Object.values(byDay).map(d => {
    const isToday = d.meta.key === tkey;
    return `<div class="day-block">
      <div class="day-head ${isToday ? 'is-today' : ''}">
        <span class="dow">${d.meta.dow}</span>
        <span class="date">${d.meta.date}</span>
        ${isToday ? '<span class="today-pill">IDAG</span>' : ''}
      </div>
      <div class="match-grid">${d.items.map(m => matchCard(m, standings, matchInvolves(m, standings))).join('')}</div>
    </div>`;
  }).join('') || '<div class="loading">Inga matcher.</div>';
}

/* ============================================================
   VIEW: GROUPS
   ============================================================ */
function bestThirds(standings) {
  // every group must be finished before thirds can be ranked
  for (const g of Object.keys(DATA.fixtures.groups)) {
    const st = standings[g];
    if (!st || !st.complete) return null;
  }
  const groups = Object.keys(DATA.fixtures.groups);
  const thirdCode = g => { const t = standings[g].table[2]; return t ? t.c : null; };
  // official override: the exact 8 qualifying thirds entered in standings.json (used verbatim, FIFA-authoritative)
  const ov = DATA.standings && DATA.standings.thirdsOverride;
  if (Array.isArray(ov) && ov.length === 8) {
    const valid = new Set(groups.map(thirdCode).filter(Boolean));
    if (ov.every(c => valid.has(c))) return new Set(ov);
  }
  // fair-play (team-conduct) points per FIFA, if supplied per team in standings.json (negative; higher is better)
  const fpOf = c => {
    const gr = (DATA.standings && DATA.standings.groups) || {};
    for (const g in gr) if (gr[g].rows && gr[g].rows[c] && typeof gr[g].rows[c].fp === 'number') return gr[g].rows[c].fp;
    return null;
  };
  const thirds = groups.map(g => {
    const t = standings[g].table[2];
    return t ? { g, c: t.c, pts: t.pts, gd: t.gd, gf: t.gf, fp: fpOf(t.c) } : null;
  }).filter(Boolean);
  // FIFA criteria: points, goal difference, goals scored, then fair-play (when known), then group as last resort
  thirds.sort((x, y) =>
    y.pts - x.pts || y.gd - x.gd || y.gf - x.gf ||
    ((x.fp != null && y.fp != null) ? (y.fp - x.fp) : 0) ||
    x.g.localeCompare(y.g));
  return new Set(thirds.slice(0, 8).map(t => t.c));
}

function renderGroups() {
  const standings = allStandings();
  const thirds = bestThirds(standings); // Set of 8 qualifying codes, or null until the group stage is over
  const body = $('#groups-body');
  body.innerHTML = Object.keys(DATA.fixtures.groups).map(g => {
    const st = standings[g];
    const rows = st.table.map((t, i) => {
      let cls = '';
      if (i === 0) cls = 'q1';
      else if (i === 1) cls = 'q2';
      else if (i === 2) cls = thirds ? (thirds.has(t.c) ? 'q3' : 'q3-out') : 'q3';
      const tt = team(t.c);
      return `<tr class="${cls}">
        <td class="tl"><span class="flag">${tt.flag}</span>${tt.sv}</td>
        <td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
        <td>${t.gf}-${t.ga}</td><td>${t.gd > 0 ? '+' + t.gd : t.gd}</td>
        <td class="pts">${t.pts}</td>
      </tr>`;
    }).join('');
    return `<div class="group-card">
      <h3>Grupp ${g}</h3>
      <table class="gtable">
        <thead><tr><th class="tl">Lag</th><th>S</th><th>V</th><th>O</th><th>F</th><th>Mål</th><th>+/−</th><th>P</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="qkey"><span class="k1">Vidare</span><span class="k3">${thirds ? '3:a vidare' : 'Möjlig 3:a'}</span>${thirds ? '<span class="kout">3:a utslagen</span>' : ''}</div>
    </div>`;
  }).join('');
}

/* ============================================================
   VIEW: BRACKET
   ============================================================ */
function bracketRow(ref, code, score, isWin) {
  const t = code ? team(code) : null;
  const name = t ? t.sv : refLabel(ref);
  const flag = t ? t.flag : '⬜';
  return `<div class="brow ${isWin ? 'win' : ''}">
    <span class="flag">${flag}</span>
    <span class="bn ${t ? '' : 'tbd'}">${name}</span>
    <span class="bsc">${score ?? ''}</span>
  </div>`;
}

function bracketTie(m, standings, cls = '') {
  const { home, away } = koTeams(m, standings);
  const r = res(m.id);
  const w = matchWinner(m, standings);
  const isFinal = m.roundKey === 'FINAL';
  const k = kickoff(m);
  const tag = m.roundKey === '3RD' ? 'Brons' : ('M' + m.no);
  return `<div class="btie ${isFinal ? 'final-tie' : ''} ${cls}">
    <div class="bno"><span>${tag}</span><span>${k.date} ${k.time}</span></div>
    ${bracketRow(m.homeRef, home, r ? r.homeScore : null, w && w.winner === home && home)}
    ${bracketRow(m.awayRef, away, r ? r.awayScore : null, w && w.winner === away && away)}
  </div>`;
}

// which half a knockout match belongs to (left feeds SF m101, right feeds m102)
function koSide(m) {
  if (m.roundKey === 'FINAL' || m.roundKey === '3RD') return 'C';
  const n = m.no;
  if (m.roundKey === 'R32') return n <= 80 ? 'L' : 'R';
  if (m.roundKey === 'R16') return n <= 92 ? 'L' : 'R';
  if (m.roundKey === 'QF') return n <= 98 ? 'L' : 'R';
  return n === 101 ? 'L' : 'R'; // SF
}

// DESKTOP: two halves converging on a centred final
function bracketConverging(standings) {
  const kos = DATA.fixtures.matches.filter(m => m.stage === 'KO');
  const half = (sideKey, order) => order.map(([key, label]) => {
    const list = kos.filter(m => m.roundKey === key && koSide(m) === sideKey).sort((a, b) => a.no - b.no);
    const slots = list.map(m => `<div class="bslot">${bracketTie(m, standings)}</div>`).join('');
    return `<div class="bcol col-${key.toLowerCase()}"><div class="bcol-title">${label}</div><div class="bcol-slots">${slots}</div></div>`;
  }).join('');
  const order = [['R32', 'Sextondel'], ['R16', 'Åttondel'], ['QF', 'Kvart'], ['SF', 'Semi']];
  const left = half('L', order);
  const right = half('R', order.slice().reverse());
  const finalM = kos.find(m => m.roundKey === 'FINAL');
  const bronze = kos.find(m => m.roundKey === '3RD');
  const center = `<div class="bcol bcol-center">
    <div class="bcol-title gold">🏆 Final</div>
    <div class="bcol-slots center">
      <div class="bslot">${bracketTie(finalM, standings)}</div>
      <div class="bronze-block"><div class="bcol-title small">Bronsmatch</div>${bracketTie(bronze, standings, 'bronze')}</div>
    </div>
  </div>`;
  return `<div class="bracket converging">
    <div class="bhalf left">${left}</div>
    ${center}
    <div class="bhalf right">${right}</div>
  </div>`;
}

// MOBILE: vertical tree, rounds stacked top to bottom
function bracketVertical(standings) {
  const kos = DATA.fixtures.matches.filter(m => m.stage === 'KO');
  const rounds = [['R32', 'Sextondel (R32)'], ['R16', 'Åttondel (R16)'], ['QF', 'Kvartsfinal'], ['SF', 'Semifinal'], ['FINAL', 'Final & brons']];
  return `<div class="bracket vertical">` + rounds.map(([key, label]) => {
    const list = kos.filter(m => m.roundKey === key || (key === 'FINAL' && m.roundKey === '3RD')).sort((a, b) => a.no - b.no);
    const ties = list.map(m => bracketTie(m, standings, m.roundKey === '3RD' ? 'bronze' : '')).join('');
    return `<div class="vround"><div class="vround-title">${label}</div><div class="vround-grid">${ties}</div></div>`;
  }).join('') + `</div>`;
}

let _bracketMode = null;
function renderBracket() {
  const standings = allStandings();
  const body = $('#bracket-body');
  const desktop = window.innerWidth >= 920;
  _bracketMode = desktop ? 'd' : 'm';
  body.innerHTML = desktop ? bracketConverging(standings) : bracketVertical(standings);
}

/* ============================================================
   MONEY: data model
   ============================================================ */
function tournamentDays() {
  const ms = DATA.fixtures.matches.map(m => kickoff(m).key).sort();
  const start = ms[0], end = ms[ms.length - 1];
  const out = [];
  let d = new Date(new Date(start + 'T12:00:00').getTime() - 864e5); // day before kickoff = 200 baseline
  const endD = new Date(end + 'T12:00:00');
  while (d <= endD) { out.push(swKey.format(d)); d = new Date(d.getTime() + 864e5); }
  return out;
}

let _draftCache = null;
function loadDraft() {
  if (_draftCache) return _draftCache;
  try { _draftCache = JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; }
  catch { _draftCache = {}; }
  return _draftCache;
}
function saveDraft(d) {
  _draftCache = d;
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* memory-only fallback */ }
}

// merged balances: in live mode Firebase is the single source of truth;
// in local mode the committed file is overlaid by this browser's draft
function effectiveBalances() {
  const base = JSON.parse(JSON.stringify(DATA.betting.balances || {}));
  if (BETTING.mode === 'live') return base;
  const db = (loadDraft().balances) || {};
  Object.keys(db).forEach(day => {
    base[day] = Object.assign({}, base[day] || {}, db[day]);
  });
  return base;
}
// merged bet notes (what each person bet on), same overlay logic as balances
function effectiveBets() {
  const base = JSON.parse(JSON.stringify(DATA.betting.bets || {}));
  if (BETTING.mode === 'live') return base;
  const dn = (loadDraft().bets) || {};
  Object.keys(dn).forEach(day => {
    base[day] = Object.assign({}, base[day] || {}, dn[day]);
  });
  return base;
}

// carry-forward series per player up to last day with any data
function moneySeries() {
  const players = DATA.betting.players;
  const start = DATA.betting.startAmount;
  const bal = effectiveBalances();
  const days = tournamentDays();
  // show the curve up to the last day that anyone has entered a value for
  let lastIdx = 0;
  days.forEach((d, i) => { if (bal[d] && Object.keys(bal[d]).length) lastIdx = i; });
  const used = days.slice(0, lastIdx + 1);

  const last = {}; players.forEach(p => last[p] = start);
  const series = {}; players.forEach(p => series[p] = []);
  used.forEach(d => {
    players.forEach(p => {
      if (bal[d] && bal[d][p] != null && bal[d][p] !== '') last[p] = Number(bal[d][p]);
      series[p].push(last[p]);
    });
  });
  return { days: used, series, start, players };
}

function indexSeries(history, days) {
  const h = (history || []).filter(x => x.close != null);
  if (!h.length) return null;
  const map = {}; h.forEach(x => map[x.date] = Number(x.close));
  const start = DATA.betting.startAmount;
  const sorted = h.slice().sort((a, b) => a.date.localeCompare(b.date));
  // anchor = June 10 close (the baseline day); if absent, fall back to first stored close
  const anchorEntry = sorted.find(x => x.date === '2026-06-10') || sorted[0];
  const anchor = anchorEntry.close;
  const anchorDate = anchorEntry.date;
  // plot the anchor day itself at 200 (so it lines up with the players' baseline),
  // then each later day shows its close relative to the anchor; days before it have no line
  let lastClose = anchor;
  return days.map(d => {
    if (d < anchorDate) return null;
    if (map[d] != null) lastClose = map[d];
    else {
      for (let i = sorted.length - 1; i >= 0; i--) { if (sorted[i].date <= d) { lastClose = sorted[i].close; break; } }
    }
    return +(lastClose / anchor * start).toFixed(2);
  });
}
function omxSeries(days) { return indexSeries(DATA.omx && DATA.omx.history, days); }
function sp500Series(days) { return indexSeries(DATA.sp500 && DATA.sp500.history, days); }

/* ---------- MONEY render ---------- */
function fmtPct(v) {
  const s = (v >= 0 ? '+' : '') + v.toFixed(1) + '%';
  const cls = v > 0.05 ? 'up' : v < -0.05 ? 'down' : 'flat';
  return { s, cls };
}

// money: show no decimals for whole numbers, 2 decimals otherwise
function fmtMoney(v) {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(2);
}

function applyThemeIcon() {
  const b = document.getElementById('theme-toggle'); if (!b) return;
  b.textContent = document.documentElement.getAttribute('data-theme') === 'light' ? '☀️' : '🌙';
}

function renderMoney() {
  const { days, series, start, players } = moneySeries();
  // latest value per player
  const latest = {}; players.forEach(p => latest[p] = series[p].length ? series[p][series[p].length - 1] : start);
  const ranked = players.slice().sort((a, b) => latest[b] - latest[a]);
  const maxVal = Math.max(...players.map(p => latest[p]));
  const minVal = Math.min(...players.map(p => latest[p]));
  const leaders = ranked.filter(p => latest[p] === maxVal); // everyone tied at the top
  const allTied = leaders.length === players.length;
  // standard competition ranking: tied players share a rank (1,1,3,…)
  const rankOf = p => 1 + players.filter(q => latest[q] > latest[p]).length;

  // leader card
  const topPct = (maxVal / start - 1) * 100;
  const tp = fmtPct(topPct);
  const lc = $('#leader-card');
  lc.dataset.player = leaders[0];
  if (allTied) {
    lc.innerHTML = `
      <div class="lc-tag">🤝 ALLA LIGGER LIKA</div>
      <div class="lc-name">Oavgjort</div>
      <div><span class="lc-amt">${fmtMoney(maxVal)} SEK</span>
        <span class="lc-chg ${tp.cls}">${tp.s}</span></div>`;
  } else {
    const names = leaders.length === 1 ? leaders[0]
      : leaders.length === 2 ? leaders.join(' & ')
      : leaders.slice(0, -1).join(', ') + ' & ' + leaders[leaders.length - 1];
    lc.innerHTML = `
      <div class="lc-tag">👑 ${leaders.length > 1 ? 'DELAD LEDNING' : 'LEDER LIGAN JUST NU'}</div>
      <div class="lc-name${leaders.length > 1 ? ' multi' : ''}">${names}</div>
      <div>
        <span class="lc-amt">${fmtMoney(maxVal)} SEK</span>
        <span class="lc-chg ${tp.cls}">${tp.s}</span>
      </div>
      <div class="lc-more">Klicka för historik →</div>`;
  }

  // board
  if (days.length === 0) {
    lc.innerHTML = '<div class="empty-state">Ingen har registrerat något saldo ännu.<br>Var den modigaste — sätt dig i ledning! 🏆</div>';
    $('#standings-money').innerHTML = '';
    renderStatsBar();
    renderChart([], {}, players);
    renderAwards();
    renderCompare();
    renderHistory();
    return;
  }

  // board
  $('#standings-money').innerHTML = ranked.map((p) => {
    const rank = rankOf(p);
    const pct = (latest[p] / start - 1) * 100;
    const f = fmtPct(pct);
    const w = Math.max(8, (latest[p] / Math.max(start, maxVal)) * 160);
    const pidx = DATA.betting.players.indexOf(p);
    const pc = PLAYER_COLORS[pidx % PLAYER_COLORS.length];
    const isTop = latest[p] === maxVal && !allTied;
    const isBot = latest[p] === minVal && minVal < maxVal;
    let tag = '';
    if (isTop) tag = '<span class="rank-tag rt-gold">👑 LIGALEDARE</span>';
    else if (isBot) tag = '<span class="rank-tag rt-red">💀 BOTTENSKRAPET</span>';
    else if (pct > 60) tag = '<span class="rank-tag rt-lime">🚀 RAKET</span>';
    return `<div class="mrow${isTop ? ' mrow-top' : isBot ? ' mrow-bot' : ''}" data-player="${p}">
      <span class="rk">${rank}</span>
      <span class="nm">
        <span class="pdot" style="background:${pc}"></span>
        ${p}${tag}
        <span class="bar" style="width:${w}px;background:${pc}"></span>
      </span>
      <span class="amt">${fmtMoney(latest[p])} kr</span>
      <span class="chg ${f.cls}">${f.s}</span>
    </div>`;
  }).join('');

  // index chips (OMXS30 + S&P 500, normalised to start)
  renderIndexChips(days);
  renderStatsBar();
  renderChart(days, series, players);
  renderAwards();
  renderCompare();
  renderHistory();
}

/* ---------- awards & streaks ---------- */
function renderAwards() {
  const el = document.getElementById('awards'); if (!el) return;
  const { days, series, start, players } = moneySeries();
  if (days.length <= 1) { el.innerHTML = ''; return; }

  let biggestWin = null, biggestLoss = null, peak = null, bestStreak = null, mostVolatile = null;
  const leadDays = {}; players.forEach(p => leadDays[p] = 0);
  for (let i = 0; i < days.length; i++) {
    let mx = -Infinity; players.forEach(p => { if (series[p][i] > mx) mx = series[p][i]; });
    players.forEach(p => { if (series[p][i] === mx) leadDays[p]++; });
  }
  players.forEach(p => {
    const s = series[p]; let prev = start, streak = 0; const rets = [];
    for (let i = 0; i < s.length; i++) {
      const ch = s[i] - prev;
      if (ch > 0 && (!biggestWin || ch > biggestWin.val)) biggestWin = { p, val: ch, day: days[i] };
      if (ch < 0 && (!biggestLoss || ch < biggestLoss.val)) biggestLoss = { p, val: ch, day: days[i] };
      if (ch > 0) { streak++; if (!bestStreak || streak > bestStreak.val) bestStreak = { p, val: streak }; } else streak = 0;
      if (prev > 0) rets.push(ch / prev);
      if (!peak || s[i] > peak.val) peak = { p, val: s[i], day: days[i] };
      prev = s[i];
    }
    if (rets.length >= 2) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
      const sd = Math.sqrt(variance) * 100;
      if (!mostVolatile || sd > mostVolatile.val) mostVolatile = { p, val: sd };
    }
  });
  let topLead = null;
  players.forEach(p => { if (!topLead || leadDays[p] > topLead.val) topLead = { p, val: leadDays[p] }; });

  const dl = d => swDate.format(new Date(d + 'T12:00:00'));
  const card = (icon, label, name, value, sub) =>
    `<div class="award"><div class="aw-ico">${icon}</div><div class="aw-body">
      <div class="aw-label">${label}</div><div class="aw-name">${name}</div>
      <div class="aw-val">${value}${sub ? ` <span class="aw-sub">${sub}</span>` : ''}</div></div></div>`;

  const cards = [];
  if (biggestWin) cards.push(card('🚀', 'Största dagsvinst', biggestWin.p, '+' + fmtMoney(biggestWin.val) + ' kr', dl(biggestWin.day)));
  if (biggestLoss) cards.push(card('💥', 'Största dagsförlust', biggestLoss.p, fmtMoney(biggestLoss.val) + ' kr', dl(biggestLoss.day)));
  if (bestStreak) cards.push(card('🔥', 'Längsta vinstsvit', bestStreak.p, bestStreak.val + ' dagar', ''));
  if (topLead && topLead.val > 0) cards.push(card('👑', 'Flest dagar i ledning', topLead.p, topLead.val + ' dagar', ''));
  if (peak) cards.push(card('📈', 'Högsta saldo', peak.p, fmtMoney(peak.val) + ' kr', dl(peak.day)));
  if (mostVolatile) cards.push(card('🎲', 'Degen-index', mostVolatile.p, mostVolatile.val.toFixed(1) + '%', 'volatilitet'));

  el.innerHTML = `<h3 class="awards-title">🏅 Utmärkelser</h3><div class="awards-grid">${cards.join('')}</div>`;
}

/* ---------- head-to-head compare ---------- */
let _cmpSel = null; // Set of selected labels

function compareAllLines() {
  const { days, series, players, start } = moneySeries();
  const lines = players.map((p, i) => ({ label: p, color: PLAYER_COLORS[i % PLAYER_COLORS.length], dash: [], data: series[p] }));
  const omx = omxSeries(days); if (omx) lines.push({ label: 'OMXS30', color: '#ffffff', dash: [6, 4], data: omx, index: true });
  const sp = sp500Series(days); if (sp) lines.push({ label: 'S&P 500', color: '#c9d4ea', dash: [2, 4], data: sp, index: true });
  return { days, lines, series, players, start };
}

function renderCompare() {
  const chipsEl = document.getElementById('compare-chips');
  const cv = document.getElementById('compareChart');
  if (!chipsEl || !cv) return;
  const { days, lines, series, players, start } = compareAllLines();
  if (!_cmpSel) {
    const latest = {}; players.forEach(p => latest[p] = series[p].length ? series[p][series[p].length - 1] : start);
    _cmpSel = new Set(players.slice().sort((a, b) => latest[b] - latest[a]).slice(0, 2));
  }
  chipsEl.innerHTML = lines.map(l => {
    const on = _cmpSel.has(l.label);
    return `<button class="cmp-chip${on ? ' on' : ''}" data-label="${l.label}" style="--c:${l.color}">
      <span class="cmp-dot${l.dash.length ? ' dashed' : ''}"></span>${l.label}</button>`;
  }).join('');
  const sel = lines.filter(l => _cmpSel.has(l.label));
  _compare = { cv, days, lines: sel, hi: -1, hovi: null };
  cv._state = _compare;
  if (sel.length && days.length) {
    layoutChart(_compare); drawChart(_compare);
  } else {
    const ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
  }
  if (!cv._wired) { cv._wired = true; wireChartHover(cv); }
}

function renderIndexChips(days) {
  const start = DATA.betting.startAmount;
  const chip = (label, ser) => {
    if (!ser || !ser.length) return '';
    const v = ser[ser.length - 1];
    const f = fmtPct((v / start - 1) * 100);
    return `<span class="ichip"><span class="ic-lbl">${label}</span>
      <span class="ic-val">${v.toFixed(1)}</span>
      <span class="chg ${f.cls}">${f.s}</span></span>`;
  };
  const html = chip('OMXS30', omxSeries(days)) + chip('S&P 500', sp500Series(days));
  $('#index-chips').innerHTML = html || '<span class="ichip muted-chip">Index uppdateras dagligen</span>';
}

/* ---------- chart (interactive canvas, hover to highlight a line) ---------- */
const PLAYER_COLORS = ['#ff2d78', '#19e3d6', '#c6ff3d', '#ffd23f', '#8a5cff', '#34e29b', '#ff8a3d'];
let _chart = null, _compare = null;

function renderChart(days, series, players) {
  const cv = document.getElementById('moneyChart'); if (!cv) return;
  const lines = players.map((p, i) => ({ label: p, color: PLAYER_COLORS[i % PLAYER_COLORS.length], dash: [], data: series[p] }));
  const omx = omxSeries(days); if (omx) lines.push({ label: 'OMXS30', color: '#ffffff', dash: [6, 4], data: omx, index: true });
  const sp = sp500Series(days); if (sp) lines.push({ label: 'S&P 500', color: '#c9d4ea', dash: [2, 4], data: sp, index: true });
  _chart = { cv, days, lines, hi: -1, hovi: null };
  cv._state = _chart;
  layoutChart(_chart);
  drawChart(_chart);
  renderLegend();
  if (!cv._wired) { cv._wired = true; wireChartHover(cv); }
}

function renderLegend() {
  const el = document.getElementById('chart-legend'); if (!el || !_chart) return;
  el.innerHTML = _chart.lines.map((l, i) =>
    `<span class="leg-item" data-idx="${i}">
      <span class="leg-swatch${l.dash.length ? ' dashed' : ''}" style="--c:${l.color}"></span>${l.label}
    </span>`).join('');
}

function layoutChart(c = _chart) {
  if (!c) return;
  const cv = c.cv, wrap = cv.parentElement;
  const W = Math.max(280, (wrap && wrap.clientWidth) || 640), H = 340, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  let mn = Infinity, mx = -Infinity;
  c.lines.forEach(l => l.data.forEach(v => { if (v < mn) mn = v; if (v > mx) mx = v; }));
  if (!isFinite(mn)) { mn = 160; mx = 240; }
  const pad = (mx - mn) * 0.12 || 20; mn -= pad; mx += pad;
  const L = 46, R = 12, T = 30, B = 26, n = c.days.length;
  const X = i => n <= 1 ? L + (W - L - R) / 2 : L + (i / (n - 1)) * (W - L - R);
  const Y = v => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
  c.lines.forEach(l => { l.pts = l.data.map((v, i) => ({ x: X(i), y: Y(v), v })); });
  Object.assign(c, { W, H, dpr, mn, mx, L, R, T, B, n, X, Y });
}

function _rrect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function drawChart(c = _chart) {
  if (!c) return;
  const ctx = c.cv.getContext('2d');
  ctx.setTransform(c.dpr, 0, 0, c.dpr, 0, 0); ctx.clearRect(0, 0, c.W, c.H);
  const start = DATA.betting.startAmount;
  ctx.font = '10px "Space Mono",monospace';
  for (let g = 0; g <= 4; g++) {
    const val = c.mn + (c.mx - c.mn) * g / 4, yy = c.Y(val);
    ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(c.L, yy); ctx.lineTo(c.W - c.R, yy); ctx.stroke();
    ctx.fillStyle = '#8a9bb4'; ctx.fillText(Math.round(val), 6, yy + 3);
  }
  const step = Math.max(1, Math.ceil(c.n / 7));
  for (let i = 0; i < c.n; i += step) { ctx.fillStyle = '#8a9bb4'; ctx.fillText(c.days[i].slice(5), c.X(i) - 11, c.H - 8); }
  // vertical guide at hovered index
  if (c.hovi != null && c.lines.length) {
    const gx = c.X(c.hovi);
    ctx.strokeStyle = 'rgba(255,255,255,.16)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(gx, c.T); ctx.lineTo(gx, c.H - c.B); ctx.stroke(); ctx.setLineDash([]);
  }
  c.lines.forEach((l, idx) => {
    const dim = c.hi >= 0 && c.hi !== idx;
    ctx.globalAlpha = dim ? 0.16 : 1;
    ctx.beginPath(); ctx.lineWidth = (c.hi === idx) ? 3.4 : (l.dash.length ? 1.8 : 2.2);
    ctx.setLineDash(l.dash); ctx.strokeStyle = l.color;
    l.pts.forEach((p, i) => { i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
    ctx.stroke(); ctx.setLineDash([]);
  });
  ctx.globalAlpha = 1;
  if (c.hi >= 0 && c.hovi != null) {
    const l = c.lines[c.hi], p = l.pts[c.hovi];
    if (p) {
      ctx.beginPath(); ctx.fillStyle = l.color; ctx.arc(p.x, p.y, 4.5, 0, 7); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#0b111a'; ctx.stroke();
      const pct = (p.v / start - 1) * 100;
      const txt = `${l.label}  ${p.v.toFixed(0)} kr  ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
      ctx.font = '600 12px Sora,sans-serif';
      const tw = ctx.measureText(txt).width + 16;
      let bx = p.x + 12; if (bx + tw > c.W - c.R) bx = p.x - 12 - tw;
      let by = p.y - 28; if (by < c.T) by = p.y + 12;
      ctx.fillStyle = 'rgba(11,17,26,.95)'; _rrect(ctx, bx, by, tw, 22, 6); ctx.fill();
      ctx.strokeStyle = l.color; ctx.lineWidth = 1; _rrect(ctx, bx, by, tw, 22, 6); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(txt, bx + 8, by + 15);
    }
  }
}

function chartHit(c, clientX, clientY) {
  if (!c || !c.n) return;
  const rect = c.cv.getBoundingClientRect();
  const mx = clientX - rect.left, my = clientY - rect.top;
  let hovi = 0, best = Infinity;
  for (let i = 0; i < c.n; i++) { const dx = Math.abs(c.X(i) - mx); if (dx < best) { best = dx; hovi = i; } }
  let hi = -1, bestY = Infinity;
  c.lines.forEach((l, idx) => { const p = l.pts[hovi]; if (!p) return; const dy = Math.abs(p.y - my); if (dy < bestY) { bestY = dy; hi = idx; } });
  c.hi = hi; c.hovi = hovi; drawChart(c);
}

function wireChartHover(cv) {
  const move = (e) => { const c = cv._state; if (!c) return; const t = e.touches ? e.touches[0] : e; chartHit(c, t.clientX, t.clientY); };
  const clear = () => { const c = cv._state; if (c) { c.hi = -1; c.hovi = null; drawChart(c); } };
  cv.addEventListener('mousemove', move);
  cv.addEventListener('mouseleave', clear);
  cv.addEventListener('touchstart', move, { passive: true });
  cv.addEventListener('touchmove', move, { passive: true });
  cv.addEventListener('touchend', clear);
}

/* ---------- history (read-only) ---------- */
function renderHistory() {
  const players = DATA.betting.players;
  const days = tournamentDays();
  const bal = effectiveBalances();
  const tkey = todayKey();
  // show rows up to the last day with data (at least the first day)
  let lastIdx = 0;
  days.forEach((d, i) => { if (bal[d] && Object.keys(bal[d]).length) lastIdx = i; });
  const shown = days.slice(0, lastIdx + 1);

  const head = `<tr><th class="daycol">Dag</th>${players.map(p => `<th>${p}</th>`).join('')}</tr>`;
  // carry-forward for display so blanks show the inherited value greyed out
  const last = {}; players.forEach(p => last[p] = DATA.betting.startAmount);
  const rows = shown.map((d) => {
    const isToday = d === tkey;
    const cells = players.map(p => {
      const entered = bal[d] && bal[d][p] != null && bal[d][p] !== '';
      if (entered) last[p] = Number(bal[d][p]);
      const cls = entered ? '' : 'carry';
      return `<td class="${cls}">${fmtMoney(last[p])}</td>`;
    }).join('');
    return `<tr class="${isToday ? 'today-row' : ''}"><td class="daycol">${swDate.format(new Date(d + 'T12:00:00'))}</td>${cells}</tr>`;
  }).join('');

  $('#editor-grid').innerHTML = `<table class="egrid"><thead>${head}</thead><tbody>${rows}</tbody></table>`;
}

/* ---------- betting backend (Firebase live, or local fallback) ---------- */
function bettingConfigured() {
  const c = window.FIREBASE_CONFIG;
  return !!(c && typeof c.databaseURL === 'string'
    && c.databaseURL && !/YOUR_|example|xxxx/i.test(c.databaseURL)
    && typeof firebase !== 'undefined');
}

function initBetting(onUpdate) {
  if (bettingConfigured()) {
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      BETTING.ref = firebase.database().ref(); // root: holds balances + bets
      BETTING.mode = 'live';
      BETTING.ref.on('value', (snap) => {
        const val = snap.val() || {};
        DATA.betting.balances = val.balances || {};
        DATA.betting.bets = val.bets || {};
        DATA.predictions = val.predictions || {};
        // seed day-1 baseline (everyone at start) once, if missing
        const d1 = tournamentDays()[0];
        if (!DATA.betting.balances[d1]) {
          const base = {}; DATA.betting.players.forEach(p => base[p] = DATA.betting.startAmount);
          BETTING.ref.child('balances/' + d1).set(base); // re-fires this listener
        }
        onUpdate();
      }, (err) => {
        console.error('Firebase read failed, switching to local mode', err);
        BETTING.mode = 'local'; updateBackendStatus(); onUpdate();
      });
      updateBackendStatus();
      return;
    } catch (e) {
      console.error('Firebase init failed, local mode', e);
    }
  }
  BETTING.mode = 'local';
  updateBackendStatus();
  onUpdate();
}

function updateBackendStatus() {
  const el = $('#backend-status'); if (!el) return;
  const exportRow = $('#export-row');
  const guide = $('#firebase-guide');
  if (BETTING.mode === 'live') {
    el.textContent = '🟢 Live';
    el.className = 'backend-status live';
    el.title = 'Alla ser dina ändringar direkt';
    if (exportRow) exportRow.classList.add('hidden');
    if (guide) guide.classList.add('hidden');
  } else {
    el.textContent = '💾 Lokalt läge';
    el.className = 'backend-status local';
    el.title = 'Sparas i din webbläsare. Committa betting.json för att dela.';
    if (exportRow) exportRow.classList.remove('hidden');
    if (guide) guide.classList.remove('hidden');
  }
}

async function submitBalance(date, player, amount, note) {
  const clean = (note && note.trim()) ? note.trim() : null;
  if (BETTING.mode === 'live' && BETTING.ref) {
    const updates = {};
    updates['balances/' + date + '/' + player] = amount;
    updates['bets/' + date + '/' + player] = clean; // null clears it
    await BETTING.ref.update(updates); // listener re-renders for everyone
  } else {
    const draft = loadDraft();
    draft.balances ||= {}; draft.bets ||= {};
    (draft.balances[date] ||= {})[player] = amount;
    if (clean) (draft.bets[date] ||= {})[player] = clean;
    else if (draft.bets[date]) delete draft.bets[date][player];
    saveDraft(draft);
    renderMoney();
  }
}

function populateForm() {
  const psel = $('#f-player'), dsel = $('#f-date');
  psel.innerHTML = DATA.betting.players.map(p => `<option value="${p}">${p}</option>`).join('');
  const days = tournamentDays();
  const tkey = todayKey();
  dsel.innerHTML = days.map(d =>
    `<option value="${d}">${swDate.format(new Date(d + 'T12:00:00'))}</option>`).join('');
  // default to today if the tournament is running, otherwise the opening day
  dsel.value = days.includes(tkey) ? tkey : days[0];
}

function handleSubmit() {
  const player = $('#f-player').value;
  const date = $('#f-date').value;
  const raw = $('#f-amount').value.replace(',', '.');
  const note = $('#f-note').value;
  const msg = $('#submit-msg');
  if (raw === '' || isNaN(Number(raw)) || Number(raw) < 0) {
    msg.className = 'submit-msg err';
    msg.textContent = 'Ange ett giltigt belopp (0 eller mer)';
    return;
  }
  const amount = Math.round(Number(raw) * 100) / 100;
  submitBalance(date, player, amount, note).then(() => {
    msg.className = 'submit-msg ok';
    const dlabel = swDate.format(new Date(date + 'T12:00:00'));
    msg.textContent = `✓ Sparat: ${player} ${fmtMoney(amount)} kr för ${dlabel}${note && note.trim() ? ' · ' + note.trim() : ''}`;
    $('#f-submit').textContent = '✏️ Uppdatera';
    fireConfetti();
  }).catch((e) => {
    msg.className = 'submit-msg err';
    msg.textContent = 'Kunde inte spara: ' + e.message;
  });
}

// fill the form with whatever is already stored for the chosen player+day,
// so a mistake can simply be edited and re-submitted
function populateFavTeam() {
  const sel = document.getElementById('fav-team'); if (!sel || !DATA.fixtures) return;
  const teams = DATA.fixtures.teams;
  const codes = Object.keys(teams).sort((a, b) => teams[a].sv.localeCompare(teams[b].sv, 'sv'));
  sel.innerHTML = codes.map(c => `<option value="${c}">${teams[c].flag} ${teams[c].sv}</option>`).join('');
  if (teams[favTeam]) sel.value = favTeam; else { favTeam = codes[0]; sel.value = favTeam; }
}

function prefillForm() {
  const player = $('#f-player').value, date = $('#f-date').value;
  if (!player || !date) return;
  const bal = effectiveBalances(), bets = effectiveBets();
  const has = bal[date] && bal[date][player] != null && bal[date][player] !== '';
  $('#f-amount').value = has ? bal[date][player] : '';
  $('#f-note').value = (bets[date] && bets[date][player]) || '';
  $('#f-submit').textContent = has ? '✏️ Uppdatera' : '✅ Spara';
  const msg = $('#submit-msg'); if (msg) { msg.textContent = ''; msg.className = 'submit-msg'; }
}

function exportBetting() {
  const out = JSON.parse(JSON.stringify(DATA.betting));
  const bal = effectiveBalances();
  // keep only days that have data
  out.balances = {};
  Object.keys(bal).sort().forEach(d => {
    const clean = {};
    Object.keys(bal[d]).forEach(p => { if (bal[d][p] !== '' && bal[d][p] != null) clean[p] = Number(bal[d][p]); });
    if (Object.keys(clean).length) out.balances[d] = clean;
  });
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'betting.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
   PLAYER DETAIL MODAL
   ============================================================ */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// per-day balance + change + bet note for one player (carry-forward), up to last day with data
function playerHistory(player) {
  const bal = effectiveBalances();
  const bets = effectiveBets();
  const days = tournamentDays();
  let lastIdx = 0;
  days.forEach((d, i) => { if (bal[d] && Object.keys(bal[d]).length) lastIdx = i; });
  const used = days.slice(0, lastIdx + 1);
  const out = []; let prev = DATA.betting.startAmount, cur = DATA.betting.startAmount;
  used.forEach(d => {
    const entered = bal[d] && bal[d][player] != null && bal[d][player] !== '';
    if (entered) cur = Number(bal[d][player]);
    const note = (bets[d] && bets[d][player]) || '';
    out.push({ date: d, balance: cur, change: cur - prev, entered, note });
    prev = cur;
  });
  return out;
}

function openPlayerModal(player) {
  const start = DATA.betting.startAmount;
  const hist = playerHistory(player);
  const cur = hist.length ? hist[hist.length - 1].balance : start;
  const f = fmtPct((cur / start - 1) * 100);
  const pidx = DATA.betting.players.indexOf(player);
  const pc = PLAYER_COLORS[pidx % PLAYER_COLORS.length];
  // rank
  const { series, players } = moneySeries();
  const latest = {}; players.forEach(p => latest[p] = series[p].length ? series[p][series[p].length - 1] : start);
  const rank = players.slice().sort((a, b) => latest[b] - latest[a]).indexOf(player) + 1;

  const rows = hist.slice().reverse().map(h => {
    const cls = h.change > 0 ? 'pos' : h.change < 0 ? 'neg' : '';
    const ch = h.change === 0 ? '–' : (h.change > 0 ? '+' : '') + fmtMoney(h.change);
    const noteCell = h.note ? escapeHtml(h.note) : '<span class="muted">–</span>';
    return `<tr>
      <td>${swDate.format(new Date(h.date + 'T12:00:00'))}</td>
      <td class="num">${fmtMoney(h.balance)} kr</td>
      <td class="num ${cls}">${ch}</td>
      <td class="note">${noteCell}</td>
    </tr>`;
  }).join('');

  $('#modal-body').innerHTML = `
    <div class="pm-head">
      <span class="pm-dot" style="background:${pc}"></span>
      <div>
        <div class="pm-name">${escapeHtml(player)}</div>
        <div class="pm-sub">#${rank} · ${fmtMoney(cur)} kr · <span class="${f.cls}">${f.s}</span></div>
      </div>
    </div>
    <div class="pm-chart-wrap"><canvas id="pm-chart"></canvas></div>
    <table class="pm-table">
      <thead><tr><th>Dag</th><th class="num">Saldo (slut)</th><th class="num">Förändring</th><th>Satsade på</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
  $('#player-modal').classList.remove('hidden');
  drawMiniChart(hist.map(h => h.balance), pc);
}

function closePlayerModal() { $('#player-modal').classList.add('hidden'); }

function drawMiniChart(values, color) {
  const cv = document.getElementById('pm-chart'); if (!cv || !values.length) return;
  const wrap = cv.parentElement;
  const W = Math.max(240, wrap.clientWidth || 300), H = 130, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  let mn = Math.min(...values), mx = Math.max(...values); const pad = (mx - mn) * 0.15 || 10; mn -= pad; mx += pad;
  const L = 8, R = 8, T = 8, B = 8, n = values.length;
  const X = i => n <= 1 ? W / 2 : L + (i / (n - 1)) * (W - L - R);
  const Y = v => T + (1 - (v - mn) / (mx - mn)) * (H - T - B);
  const sy = Y(DATA.betting.startAmount);
  if (sy > T && sy < H - B) {
    ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(L, sy); ctx.lineTo(W - R, sy); ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.beginPath(); ctx.lineWidth = 2.6; ctx.strokeStyle = color;
  values.forEach((v, i) => { const x = X(i), y = Y(v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.stroke();
  const lp = values.length - 1;
  ctx.beginPath(); ctx.fillStyle = color; ctx.arc(X(lp), Y(values[lp]), 3.5, 0, 7); ctx.fill();
}

/* ============================================================
   CONFETTI
   ============================================================ */
function fireConfetti() {
  const cv = document.getElementById('confetti-canvas'); if (!cv) return;
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W; cv.height = H; cv.style.display = 'block';
  const cols = ['#ff2d78','#19e3d6','#c6ff3d','#ffd23f','#8a5cff','#34e29b','#ff8a3d'];
  const pts = Array.from({ length: 80 }, () => ({
    x: W * Math.random(), y: -8 - Math.random() * 30,
    vx: (Math.random() - .5) * 5, vy: 3 + Math.random() * 4,
    rot: Math.random() * 360, rs: (Math.random() - .5) * 7,
    w: 7 + Math.random() * 7, h: 4 + Math.random() * 4,
    c: cols[Math.floor(Math.random() * cols.length)],
  }));
  let t0 = null;
  const ctx = cv.getContext('2d');
  function frame(ts) {
    if (!t0) t0 = ts;
    const e = (ts - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    let any = false;
    pts.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += .13; p.rot += p.rs;
      const alpha = Math.max(0, 1 - Math.max(0, e - .5) / 1.5);
      if (p.y < H + 20 && alpha > 0) any = true;
      ctx.save(); ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y); ctx.rotate(p.rot * Math.PI / 180);
      ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (any) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, W, H); cv.style.display = 'none'; }
  }
  requestAnimationFrame(frame);
}

/* ============================================================
   STATS BAR
   ============================================================ */
function renderStatsBar() {
  const el = $('#stats-bar'); if (!el || !DATA.fixtures || !DATA.results) return;
  const played = Object.values(DATA.results.matches).filter(r => r && r.status === 'FINISHED').length;
  const total = DATA.fixtures.matches.length;
  const pct = total ? Math.round(played / total * 100) : 0;
  const finalUTC = new Date('2026-07-19T19:00:00Z');
  const daysLeft = Math.max(0, Math.ceil((finalUTC - new Date()) / 864e5));

  const { series, players, start } = moneySeries();
  const latest = {}; players.forEach(p => latest[p] = series[p].length ? series[p][series[p].length - 1] : start);
  const maxVal = Math.max(...players.map(p => latest[p]));
  const leaders = players.filter(p => latest[p] === maxVal);
  let leaderHtml = '';
  if (leaders.length && leaders.length < players.length) {
    const names = leaders.length <= 2 ? leaders.join(' & ') : leaders.length + ' delar ledningen';
    leaderHtml = `<span class="sb-leader">👑 ${names}${maxVal !== start ? ' · ' + fmtMoney(maxVal) + ' kr' : ''}</span>`;
  } else if (leaders.length === players.length) {
    leaderHtml = `<span class="sb-leader">🤝 alla lika</span>`;
  }

  el.innerHTML = `
    <div class="sb-track"><div class="sb-fill" style="width:${pct}%"></div></div>
    <div class="sb-row">
      <span>${played}/${total} matcher</span>
      <span class="sb-dot">·</span>
      <span>${daysLeft} dagar till finalen</span>
      <span class="sb-dot">·</span>
      ${leaderHtml}
    </div>`;
}

/* ============================================================
   COUNTDOWN + NAV
   ============================================================ */
function renderCountdown() {
  const now = new Date();
  const upcoming = DATA.fixtures.matches
    .map(m => ({ m, d: new Date(m.kickoff) }))
    .filter(x => x.d > now)
    .sort((a, b) => a.d - b.d)[0];
  const el = $('#countdown');
  if (!upcoming) {
    const finished = Object.keys(DATA.results.matches).length;
    el.innerHTML = finished ? '🏆 VM 2026 är slut. Tack för spelandet.' : '⚽ Snart drar det igång!';
    return;
  }
  const k = kickoff(upcoming.m);
  let h, a;
  if (upcoming.m.stage === 'KO') {
    const t = koTeams(upcoming.m, allStandings());
    h = t.home ? team(t.home).sv : refLabel(upcoming.m.homeRef);
    a = t.away ? team(t.away).sv : refLabel(upcoming.m.awayRef);
  } else { h = team(upcoming.m.home).sv; a = team(upcoming.m.away).sv; }
  const diff = upcoming.d - now;
  const dd = Math.floor(diff / 864e5), hh = Math.floor(diff % 864e5 / 36e5), mm = Math.floor(diff % 36e5 / 6e4);
  const cd = dd > 0 ? `${dd}d ${hh}h` : `${hh}h ${mm}m`;
  el.innerHTML = `⚽ Nästa: <b>${h} – ${a}</b> · ${k.dow} ${k.time} · om <b>${cd}</b>`;
}

/* ============================================================
   VIEW: TIPS  (pre-tournament prediction game)
   ============================================================ */
const TIP_PTS = { exact: 5, diff: 3, outcome: 2, groupWinner: 3, finalist: 20, champion: 40 };
// Phase 2 "Slutspelstippning": a real bracket. Points awarded per correctly predicted match winner, per round.
const TIP_PTS_KO = { R32: 3, R16: 6, QF: 10, SF: 16, FINAL: 30 };
const KO_ROUNDS = [
  { rk: 'R32', label: 'Sextondelsfinaler', pts: TIP_PTS_KO.R32 },
  { rk: 'R16', label: 'Åttondelsfinaler', pts: TIP_PTS_KO.R16 },
  { rk: 'QF', label: 'Kvartsfinaler', pts: TIP_PTS_KO.QF },
  { rk: 'SF', label: 'Semifinaler', pts: TIP_PTS_KO.SF },
  { rk: 'FINAL', label: 'Final', pts: TIP_PTS_KO.FINAL },
];
let _koDraft = null; // in-memory bracket being edited { matchId: winnerCode }
let _koDraftPlayer = null;
let _tipPlayer = (() => { try { return localStorage.getItem('wc2026_tip_player'); } catch (e) { return null; } })();
let _auditPlayer = null;

function nowDate() { return new Date(); }
function predictionDeadline() {
  // Extended: Phase 1 stays open through the end of 13 June (Europe/Stockholm),
  // but individual matches lock as they kick off (see buildTipForm) so already-played games can't be backfilled.
  return new Date('2026-06-12T23:59:59+02:00');
}
function predictionsLocked() { return nowDate().getTime() >= predictionDeadline().getTime(); }

function effectivePredictions() {
  const base = JSON.parse(JSON.stringify(DATA.predictions || {}));
  if (BETTING.mode === 'live') return base;
  const dp = (loadDraft().predictions) || {};
  Object.keys(dp).forEach(p => base[p] = dp[p]);
  return base;
}
async function savePredictions(player, pred) {
  if (BETTING.mode === 'live' && BETTING.ref) {
    await BETTING.ref.update({ ['predictions/' + player]: pred });
  } else {
    const draft = loadDraft(); draft.predictions ||= {}; draft.predictions[player] = pred; saveDraft(draft); renderTips();
  }
}
function groupMatches(g) {
  return DATA.fixtures.matches.filter(m => m.stage === 'GROUP' && m.group === g).sort((a, b) => a.no - b.no);
}

// points for one scoreline prediction
function scoreOutcome(ph, pa, ah, aa) {
  if (ph == null || pa == null) return 0;
  if (ph === ah && pa === aa) return TIP_PTS.exact;
  const po = Math.sign(ph - pa), ao = Math.sign(ah - aa);
  if (po !== ao) return 0;
  if ((ph - pa) === (ah - aa)) return TIP_PTS.diff;
  return TIP_PTS.outcome;
}

// teams that reached a given knockout round, resolved from the bracket
function teamsInRound(rk, standings) {
  const s = new Set();
  DATA.fixtures.matches.forEach(m => {
    if (m.roundKey !== rk) return;
    const t = koTeams(m, standings);
    if (t.home) s.add(t.home);
    if (t.away) s.add(t.away);
  });
  return s;
}
// one advancement-tier row (pure: caller sums pts)
function advRow(label, picks, reachedSet, ready, ptsEach, count) {
  const uniq = [...new Set((picks || []).filter(Boolean))];
  const pickDisp = uniq.length ? uniq.map(c => team(c).flag).join(' ') : '—';
  if (!ready) return { label, pickDisp, actualDisp: 'pågår', pts: null, max: ptsEach * count };
  const hits = uniq.filter(c => reachedSet.has(c)).length;
  return { label, pickDisp, actualDisp: `${hits}/${count} rätt`, pts: hits * ptsEach, max: ptsEach * count };
}

// the 32 teams that reached the round of 32 (top 2 per group + 8 best thirds); [] until the group stage ends
function qualifiedTeams(standings) {
  const set = new Set();
  Object.keys(DATA.fixtures.groups).forEach(g => {
    const st = standings[g];
    if (st && st.table[0]) set.add(st.table[0].c);
    if (st && st.table[1]) set.add(st.table[1].c);
  });
  const thirds = bestThirds(standings);
  if (thirds) thirds.forEach(c => set.add(c));
  return [...set];
}
function groupStageDone(standings) { return bestThirds(standings) !== null; }
function koDeadline() {
  const ks = DATA.fixtures.matches.filter(m => m.roundKey === 'R32').map(m => new Date(m.kickoff).getTime());
  return new Date(Math.min(...ks));
}
function koLocked() { return nowDate().getTime() >= koDeadline().getTime(); }
function koOpen(standings) { return groupStageDone(standings) && !koLocked(); }
function koDeadlineText() {
  const dl = koDeadline();
  if (koLocked()) return '🔒 Stängd';
  const ms = dl.getTime() - nowDate().getTime();
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
  return `⏳ Stänger ${swDate.format(dl)} ${swTime.format(dl)} · om ${d}d ${h}h`;
}

// --- bracket helpers ---
// KO matches of one round, in bracket order (excludes the 3rd-place playoff)
function koMatches(rk) {
  return DATA.fixtures.matches.filter(m => m.stage === 'KO' && m.roundKey === rk && m.roundKey !== '3RD').sort((a, b) => a.no - b.no);
}
// the two teams contesting a match inside ONE player's bracket:
// R32 uses the real qualified teams; later rounds follow the player's own winners from the feeder matches
function playerBracketTeams(m, picks, standings) {
  if (m.roundKey === 'R32') return koTeams(m, standings);
  return { home: picks['m' + String(m.homeRef).slice(1)] || null, away: picks['m' + String(m.awayRef).slice(1)] || null };
}
// drop any pick whose team is no longer one of the two teams in that slot (cascade after an upstream change)
function cleanupBracket(picks, standings) {
  for (const { rk } of KO_ROUNDS) {
    koMatches(rk).forEach(m => {
      const { home, away } = playerBracketTeams(m, picks, standings);
      const w = picks[m.id];
      if (w && w !== home && w !== away) delete picks[m.id];
    });
  }
  return picks;
}

// Phase 2 scoring: one point bucket per round, comparing each slot's predicted winner to the actual winner
function scoreKoPredictions(ko, standings) {
  ko = ko || {};
  const picks = ko.picks || {};
  const reveal = koLocked(); // only expose what others picked once the phase-2 deadline has passed
  const rows = []; let total = 0, pending = 0;
  for (const { rk, label, pts } of KO_ROUNDS) {
    const ms = koMatches(rk);
    let hits = 0, decided = 0;
    ms.forEach(m => {
      const w = matchWinner(m, standings);
      if (!w || !w.winner) return;
      decided++;
      if (picks[m.id] && picks[m.id] === w.winner) hits++;
    });
    const ready = decided === ms.length;
    const lbl = rk === 'FINAL' ? 'Final · VM-vinnare' : label;
    const picked = ms.map(m => picks[m.id]).filter(Boolean);
    const pickDisp = (reveal && picked.length) ? `<span class="ta-flags">${picked.map(c => team(c).flag).join(' ')}</span>` : '';
    if (ready) { total += hits * pts; rows.push({ label: lbl, pickDisp, actualDisp: `${hits}/${ms.length} rätt`, pts: hits * pts, max: pts * ms.length }); }
    else { pending++; rows.push({ label: lbl, pickDisp, actualDisp: 'pågår', pts: null, max: pts * ms.length }); }
  }
  return { total, pending, rows, submitted: !!ko.submitted };
}

// combined Phase 1 + Phase 2 score for the league table
function combinedScore(player, predAll, standings) {
  const pred = predAll[player] || {};
  const p1 = pred.submitted ? scorePlayerPredictions(player, predAll, standings) : null;
  const p2 = (pred.ko && pred.ko.submitted) ? scoreKoPredictions(pred.ko, standings) : null;
  return {
    player,
    total: (p1 ? p1.total : 0) + (p2 ? p2.total : 0),
    pending: (p1 ? p1.pending : 0) + (p2 ? p2.pending : 0),
    p1, p2, submittedAt: pred.submittedAt
  };
}

function scorePlayerPredictions(player, predAll, standings) {
  const pred = predAll[player];
  if (!pred || !pred.submitted) return null;
  const teamDisp = c => c ? `${team(c).flag} ${team(c).sv}` : '—';
  let total = 0, pending = 0;
  const detail = { matches: [], bonus: [] };

  DATA.fixtures.matches.forEach(m => {
    if (m.stage !== 'GROUP') return;
    const pm = (pred.matches || {})[m.id];
    const pick = (pm && pm.h != null && pm.a != null) ? pm : null;
    const r = res(m.id);
    let pts = null, actual = null;
    if (r) actual = { h: r.homeScore, a: r.awayScore };
    if (pick && r) { pts = scoreOutcome(pick.h, pick.a, r.homeScore, r.awayScore); total += pts; }
    else if (pick && !r) pending++;
    detail.matches.push({ m, pick, actual, pts });
  });

  Object.keys(DATA.fixtures.groups).forEach(g => {
    const pick = (pred.groupWinners || {})[g] || null;
    const st = standings[g];
    let pts = null, actualDisp = 'pågår';
    if (st && st.complete) { const a = st.table[0].c; pts = (pick === a) ? TIP_PTS.groupWinner : 0; total += pts; actualDisp = teamDisp(a); }
    detail.bonus.push({ label: 'Vinnare grupp ' + g, pickDisp: teamDisp(pick), actualDisp, pts, max: TIP_PTS.groupWinner });
  });

  const finalM = DATA.fixtures.matches.find(x => x.roundKey === 'FINAL');
  const fin = finalM ? koTeams(finalM, standings) : { home: null, away: null };
  const actualFin = [fin.home, fin.away].filter(Boolean);
  const ready = actualFin.length === 2;
  const predFin = [...new Set((pred.finalists || []).filter(Boolean))];
  for (let i = 0; i < 2; i++) {
    const pk = predFin[i] || null;
    let pts = null;
    if (ready) { pts = (pk && actualFin.includes(pk)) ? TIP_PTS.finalist : 0; total += pts; }
    detail.bonus.push({ label: 'Finalist ' + (i + 1), pickDisp: teamDisp(pk), actualDisp: ready ? actualFin.map(teamDisp).join(' & ') : 'pågår', pts, max: TIP_PTS.finalist });
  }

  let champActual = null, champPts = null;
  if (finalM) { const w = matchWinner(finalM, standings); if (w) champActual = w.winner; }
  if (champActual != null) { champPts = (pred.champion === champActual) ? TIP_PTS.champion : 0; total += champPts; }
  detail.bonus.push({ label: 'VM-vinnare', pickDisp: teamDisp(pred.champion), actualDisp: champActual ? teamDisp(champActual) : 'pågår', pts: champPts, max: TIP_PTS.champion });

  return { player, total, pending, detail, submittedAt: pred.submittedAt };
}

function tipDeadlineText() {
  const dl = predictionDeadline();
  if (predictionsLocked()) return '🔒 Tippningen är stängd';
  const ms = dl.getTime() - nowDate().getTime();
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5);
  return `⏳ Stänger ${swDate.format(dl)} ${swTime.format(dl)} · om ${d}d ${h}h`;
}

function renderTipRules() {
  const el = document.getElementById('tip-rules-body'); if (!el) return;
  el.innerHTML = `
  <h5 class="tip-rule-h">⚽ Gruppspelstippning (fas 1)</h5>
  <ul class="tip-rule-list">
    <li><b>Exakt resultat</b> – ${TIP_PTS.exact} p (t.ex. du 2–1, facit 2–1)</li>
    <li><b>Rätt utgång + målskillnad</b> – ${TIP_PTS.diff} p (du 3–2, facit 2–1)</li>
    <li><b>Rätt utgång (1/X/2)</b> – ${TIP_PTS.outcome} p</li>
    <li><b>Fel utgång</b> – 0 p</li>
    <li><b>Rätt gruppvinnare</b> – ${TIP_PTS.groupWinner} p styck (×12)</li>
    <li><b>Rätt finalist</b> – ${TIP_PTS.finalist} p styck (×2)</li>
    <li><b>Rätt VM-vinnare</b> – ${TIP_PTS.champion} p</li>
  </ul>
  <h5 class="tip-rule-h">🏆 Slutspelstippning (fas 2)</h5>
  <p class="tip-rule-note">Öppnar när gruppspelet är klart och alla 32 lag är satta i slutspelsträdet. Du fyller i ett eget slutspelsträd: välj vinnare i varje match, vinnaren går vidare till nästa runda. Poängen läggs ovanpå fas 1.</p>
  <ul class="tip-rule-list">
    <li><b>Rätt vinnare i sextondelsfinal</b> – ${TIP_PTS_KO.R32} p styck (×16)</li>
    <li><b>Rätt vinnare i åttondelsfinal</b> – ${TIP_PTS_KO.R16} p styck (×8)</li>
    <li><b>Rätt vinnare i kvartsfinal</b> – ${TIP_PTS_KO.QF} p styck (×4)</li>
    <li><b>Rätt vinnare i semifinal</b> – ${TIP_PTS_KO.SF} p styck (×2)</li>
    <li><b>Rätt VM-vinnare (final)</b> – ${TIP_PTS_KO.FINAL} p</li>
  </ul>
  <p class="tip-rule-note">Varje match poängsätts mot facit för just den platsen i trädet. Lag du inte tagit vidare gråmarkeras automatiskt i nästa runda, och de två finalisterna kommer alltid från var sin halva av trädet.</p>`;
}

function renderTips() {
  if (!DATA.fixtures) return;
  const locked = predictionsLocked();
  const standings = allStandings();
  const dEl = document.getElementById('tip-deadline');
  if (dEl) { dEl.textContent = tipDeadlineText(); dEl.className = 'tip-deadline ' + (locked ? 'closed' : 'open'); }
  const intro = document.getElementById('tip-intro');
  if (intro) intro.textContent = locked
    ? 'Tippningen är stängd. Poängen räknas löpande när matcherna spelas. Klicka på en spelare i ligan för att granska allas tips.'
    : 'Tippa alla gruppspelsmatcher, gruppvinnare, finalister och VM-vinnare före första avsparken. Slutspelslagen tippas i en andra omgång när gruppspelet är klart. Andras tips visas först när tippningen stänger.';
  renderTipRules();
  const entry = document.getElementById('tip-entry');
  if (entry) {
    if (!locked) { entry.style.display = ''; buildTipForm(); }
    else { entry.style.display = 'none'; entry.innerHTML = ''; }
  }
  renderKoSection(standings);
  renderTipBoard(standings, locked);
  if (locked) renderTipAudit(standings); else { const a = document.getElementById('tip-audit'); if (a) a.innerHTML = ''; }
}

function renderKoSection(standings) {
  const el = document.getElementById('tipko-section'); if (!el) return;
  if (!groupStageDone(standings)) {
    el.innerHTML = `<div class="tipko-head"><h3>🏆 Slutspelstippning</h3><span class="tipko-status soon">Snart</span></div>
      <p class="tipko-note">Öppnar när gruppspelet är färdigspelat. Då är alla 32 slutspelslag klara och du tippar vilka som tar sig vidare runda för runda. Poängen läggs ovanpå din gruppspelspoäng.</p>`;
    return;
  }
  if (koLocked()) {
    el.innerHTML = `<div class="tipko-head"><h3>🏆 Slutspelstippning</h3><span class="tipko-status closed">🔒 Stängd</span></div>
      <p class="tipko-note">Slutspelstipsen är låsta och räknas löpande in i totalpoängen nedan.</p>`;
    return;
  }
  buildKoForm(standings);
}

function buildTipForm() {
  const entry = document.getElementById('tip-entry'); if (!entry) return;
  const players = DATA.betting.players;
  if (!_tipPlayer || !players.includes(_tipPlayer)) _tipPlayer = players[0];
  const mine = effectivePredictions()[_tipPlayer] || {};
  const M = mine.matches || {}, GW = mine.groupWinners || {}, FN = mine.finalists || [], CH = mine.champion || '';
  const teams = DATA.fixtures.teams;
  const allOpts = sel => Object.keys(teams).sort((a, b) => teams[a].sv.localeCompare(teams[b].sv, 'sv'))
    .map(c => `<option value="${c}"${c === sel ? ' selected' : ''}>${teams[c].flag} ${teams[c].sv}</option>`).join('');

  const groups = Object.keys(DATA.fixtures.groups).map(g => {
    const rows = groupMatches(g).map(m => {
      const h = team(m.home), a = team(m.away), pm = M[m.id] || {};
      const started = new Date(m.kickoff).getTime() <= nowDate().getTime();
      const dis = started ? ' disabled' : '';
      return `<div class="tip-match${started ? ' locked' : ''}"${started ? ' title="Matchen har startat – låst"' : ''}>
        <span class="tm-team home"><span class="tname">${h.sv}</span><span class="flag">${h.flag}</span></span>
        <span class="tm-score"><input class="ti-score" type="number" min="0" max="30" inputmode="numeric" data-mid="${m.id}" data-side="h" value="${pm.h ?? ''}"${dis}><span class="tm-dash">${started ? '🔒' : '–'}</span><input class="ti-score" type="number" min="0" max="30" inputmode="numeric" data-mid="${m.id}" data-side="a" value="${pm.a ?? ''}"${dis}></span>
        <span class="tm-team away"><span class="flag">${a.flag}</span><span class="tname">${a.sv}</span></span>
      </div>`;
    }).join('');
    const gw = DATA.fixtures.groups[g].map(c => `<option value="${c}"${c === GW[g] ? ' selected' : ''}>${teams[c].flag} ${teams[c].sv}</option>`).join('');
    return `<details class="tip-group"><summary>Grupp ${g}</summary>
      <div class="tip-matches">${rows}</div>
      <label class="tip-gw">🥇 Gruppvinnare<select class="ti-gw" data-g="${g}"><option value="">– välj –</option>${gw}</select></label>
    </details>`;
  }).join('');

  entry.innerHTML = `
    <div class="tip-entry-head">
      <label class="tip-who">Vems tips<select id="tip-player">${players.map(p => `<option value="${p}"${p === _tipPlayer ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
      ${mine.submitted ? '<span class="tip-saved">✓ Inlämnat · går att ändra till deadline</span>' : ''}
    </div>
    <div class="tip-groups">${groups}</div>
    <div class="tip-bonus">
      <h4>🎯 Bonustips</h4>
      <div class="tip-bonus-grid">
        <label>🏅 Finalist 1<select id="tip-fin0"><option value="">– välj –</option>${allOpts(FN[0])}</select></label>
        <label>🏅 Finalist 2<select id="tip-fin1"><option value="">– välj –</option>${allOpts(FN[1])}</select></label>
        <label>🏆 VM-vinnare<select id="tip-champ"><option value="">– välj –</option>${allOpts(CH)}</select></label>
      </div>
    </div>
    <div class="tip-actions">
      <button id="tip-save" class="btn btn-primary tip-save-btn">💾 Spara mina tips</button>
      <span id="tip-msg" class="submit-msg"></span>
    </div>`;
  document.getElementById('tip-player').addEventListener('change', e => {
    _tipPlayer = e.target.value;
    try { localStorage.setItem('wc2026_tip_player', _tipPlayer); } catch (err) { /* ignore */ }
    buildTipForm();
  });
  document.getElementById('tip-save').addEventListener('click', handleTipSave);
}

function handleTipSave() {
  if (predictionsLocked()) { renderTips(); return; } // window closed while the page sat open
  const player = document.getElementById('tip-player').value;
  const matches = {};
  $$('#tip-entry .ti-score').forEach(inp => {
    const v = inp.value.trim(); if (v === '') return;
    const n = parseInt(v, 10); if (isNaN(n) || n < 0) return;
    (matches[inp.dataset.mid] ||= {})[inp.dataset.side] = n;
  });
  Object.keys(matches).forEach(id => { if (matches[id].h == null || matches[id].a == null) delete matches[id]; });
  const groupWinners = {};
  $$('#tip-entry .ti-gw').forEach(sel => { if (sel.value) groupWinners[sel.dataset.g] = sel.value; });
  const finalists = [document.getElementById('tip-fin0').value, document.getElementById('tip-fin1').value].filter(Boolean);
  const champion = document.getElementById('tip-champ').value || null;
  // merge onto the existing prediction so a Phase 2 bracket (pred.ko) is never overwritten
  const pred = JSON.parse(JSON.stringify(effectivePredictions()[player] || {}));
  pred.submitted = true; pred.submittedAt = nowDate().toISOString();
  pred.matches = matches; pred.groupWinners = groupWinners; pred.finalists = finalists; pred.champion = champion;
  const msg = document.getElementById('tip-msg');
  savePredictions(player, pred).then(() => {
    msg.className = 'submit-msg ok';
    msg.textContent = `✓ Sparat: ${Object.keys(matches).length} matchtips + bonus för ${player}`;
    fireConfetti();
  }).catch(e => { msg.className = 'submit-msg err'; msg.textContent = 'Kunde inte spara: ' + e.message; });
}

function buildKoForm(standings) {
  const el = document.getElementById('tipko-section'); if (!el) return;
  const players = DATA.betting.players;
  if (!_tipPlayer || !players.includes(_tipPlayer)) _tipPlayer = players[0];
  const saved = ((effectivePredictions()[_tipPlayer] || {}).ko) || {};
  if (_koDraft === null || _koDraftPlayer !== _tipPlayer) {
    _koDraft = JSON.parse(JSON.stringify(saved.picks || {}));
    _koDraftPlayer = _tipPlayer;
  }
  cleanupBracket(_koDraft, standings);
  const picks = _koDraft, teams = DATA.fixtures.teams;
  const chip = (mid, code) => {
    if (!code) return `<span class="bm-team tbd">– väntar –</span>`;
    const t = teams[code];
    return `<button type="button" class="bm-team${picks[mid] === code ? ' win' : ''}" data-mid="${mid}" data-code="${code}">${t.flag} ${t.sv}</button>`;
  };
  const roundHtml = ({ rk, label, pts }) => {
    const ms = koMatches(rk); let done = 0;
    const cards = ms.map(m => {
      const { home, away } = playerBracketTeams(m, picks, standings);
      if (picks[m.id]) done++;
      return `<div class="bm">${chip(m.id, home)}<span class="bm-v">mot</span>${chip(m.id, away)}</div>`;
    }).join('');
    return `<div class="ko-round"><div class="kr-head"><span>${label}</span><span class="kr-meta">${done}/${ms.length} · ${pts}p/rätt</span></div><div class="kr-matches">${cards}</div></div>`;
  };
  const finalId = (koMatches('FINAL')[0] || {}).id;
  const champ = finalId ? picks[finalId] : null;
  const champBanner = champ
    ? `<div class="ko-champ">🏆 Din VM-vinnare: <b>${teams[champ].flag} ${teams[champ].sv}</b></div>`
    : `<div class="ko-champ empty">🏆 Fyll i trädet hela vägen till en VM-vinnare</div>`;
  el.innerHTML = `
    <div class="tipko-head"><h3>🏆 Slutspelstippning</h3><span class="tipko-status open">${koDeadlineText()}</span></div>
    <p class="tipko-note">Gruppspelet är klart – alla 32 lag är satta i trädet. Välj vinnare i varje match, vinnaren går vidare. Lag du väljer bort gråmarkeras i nästa runda. ${saved.submitted ? '<b>✓ Inlämnat</b> · går att ändra till första slutspelsmatchen' : ''}</p>
    <div class="tip-entry-head"><label class="tip-who">Vems träd<select id="tipko-player">${players.map(p => `<option value="${p}"${p === _tipPlayer ? ' selected' : ''}>${p}</option>`).join('')}</select></label><span class="ko-progress">${Object.keys(picks).length}/31 val</span></div>
    ${champBanner}
    <div class="ko-bracket">${KO_ROUNDS.map(roundHtml).join('')}</div>
    <div class="tip-actions"><button id="tipko-save" class="btn btn-primary tip-save-btn">💾 Spara slutspelsträd</button><span id="tipko-msg" class="submit-msg"></span></div>`;
  document.getElementById('tipko-player').addEventListener('change', e => {
    _tipPlayer = e.target.value;
    try { localStorage.setItem('wc2026_tip_player', _tipPlayer); } catch (err) { /* ignore */ }
    _koDraft = null;
    buildKoForm(standings);
  });
  el.querySelectorAll('.bm-team[data-code]').forEach(btn => {
    btn.addEventListener('click', () => {
      const mid = btn.dataset.mid, code = btn.dataset.code;
      if (picks[mid] === code) delete picks[mid]; else picks[mid] = code;
      cleanupBracket(picks, standings);
      buildKoForm(standings);
    });
  });
  document.getElementById('tipko-save').addEventListener('click', () => handleKoSave(standings));
}

function handleKoSave(standings) {
  if (koLocked()) { renderTips(); return; } // slutspel window closed while the page sat open
  const player = document.getElementById('tipko-player').value;
  const picks = cleanupBracket(JSON.parse(JSON.stringify(_koDraft || {})), standings);
  const finalId = (koMatches('FINAL')[0] || {}).id;
  const ko = { submitted: true, submittedAt: nowDate().toISOString(), picks, champion: finalId ? (picks[finalId] || null) : null };
  const base = JSON.parse(JSON.stringify(effectivePredictions()[player] || {}));
  base.ko = ko;
  const msg = document.getElementById('tipko-msg');
  savePredictions(player, base).then(() => {
    msg.className = 'submit-msg ok';
    msg.textContent = `✓ Slutspelsträd sparat för ${player} (${Object.keys(picks).length}/31 val)`;
    fireConfetti();
  }).catch(e => { msg.className = 'submit-msg err'; msg.textContent = 'Kunde inte spara: ' + e.message; });
}

function renderTipBoard(standings, locked) {
  const board = document.getElementById('tip-board'); if (!board) return;
  const predAll = effectivePredictions();
  const submitted = DATA.betting.players.filter(p => predAll[p] && (predAll[p].submitted || (predAll[p].ko && predAll[p].ko.submitted)));
  const hint = document.getElementById('tip-board-hint');
  if (!submitted.length) {
    if (hint) hint.textContent = locked ? 'Ingen lämnade in tips i tid.' : 'Ingen har lämnat in ännu.';
    board.innerHTML = ''; return;
  }
  const rows = submitted.map(p => combinedScore(p, predAll, standings)).sort((a, b) => b.total - a.total);
  if (hint) hint.textContent = locked ? '👆 Klicka på en spelare för att granska tipsen' : `${submitted.length} har lämnat in · poäng räknas när matcherna spelas`;
  if (locked && (!_auditPlayer || !submitted.includes(_auditPlayer))) _auditPlayer = rows[0].player;
  let rank = 0, prev = null;
  board.innerHTML = rows.map((r, i) => {
    if (prev === null || r.total !== prev) { rank = i + 1; prev = r.total; }
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
    const breakdown = r.p2 ? `<span class="tr-split">${r.p1 ? r.p1.total : 0}+${r.p2.total}</span>` : '';
    return `<div class="tip-row${locked ? ' clickable' : ''}${_auditPlayer === r.player ? ' sel' : ''}" data-player="${r.player}">
      <span class="tr-rank">${medal}</span>
      <span class="tr-name">${r.player}</span>
      <span class="tr-pts">${r.total} p${breakdown}</span>
    </div>`;
  }).join('');
}

function ptBadge(pts, max) {
  if (pts == null) return `<span class="pb pending">–</span>`;
  return `<span class="pb ${pts > 0 ? 'good' : 'zero'}">${pts > 0 ? '+' + pts : '0'}</span>`;
}

function renderTipAudit(standings) {
  const el = document.getElementById('tip-audit'); if (!el) return;
  const predAll = effectivePredictions();
  const pred = predAll[_auditPlayer];
  if (!_auditPlayer || !(pred && (pred.submitted || (pred.ko && pred.ko.submitted)))) { el.innerHTML = ''; return; }
  const cs = combinedScore(_auditPlayer, predAll, standings);
  const sc = cs.p1;

  const p1bonus = sc ? sc.detail.bonus.map(b =>
    `<tr><td>${b.label}</td><td>${b.pickDisp}</td><td class="ta-act">${b.actualDisp}</td><td class="ta-pts">${ptBadge(b.pts, b.max)}</td></tr>`).join('') : '';

  const byGroup = sc ? Object.keys(DATA.fixtures.groups).map(g => {
    const rows = sc.detail.matches.filter(x => x.m.group === g);
    const sub = rows.reduce((s, x) => s + (x.pts || 0), 0);
    const body = rows.map(x => {
      const h = team(x.m.home), a = team(x.m.away);
      const pick = x.pick ? `${x.pick.h}–${x.pick.a}` : '—';
      const act = x.actual ? `${x.actual.h}–${x.actual.a}` : '—';
      return `<tr><td class="tam-teams">${h.flag} ${h.sv} – ${a.sv} ${a.flag}</td><td class="tam-pick">${pick}</td><td class="tam-act">${act}</td><td class="ta-pts">${ptBadge(x.pts, TIP_PTS.exact)}</td></tr>`;
    }).join('');
    return `<details class="ta-group"><summary>Grupp ${g} <span class="ta-sub">${sub} p</span></summary>
      <table class="ta-mtable"><tbody>${body}</tbody></table></details>`;
  }).join('') : '';

  const p1total = sc ? sc.total : 0;
  const p1block = sc ? `
    <h4 class="ta-sec">🎯 Gruppspelstips <span class="ta-phase">${p1total} p</span></h4>
    <table class="ta-btable"><thead><tr><th>Bonustips</th><th>Gissning</th><th>Facit</th><th></th></tr></thead><tbody>${p1bonus}</tbody></table>
    <div class="ta-groups">${byGroup}</div>` : '<p class="tipko-note">Lämnade inte in gruppspelstips.</p>';

  let p2block = '';
  if (cs.p2) {
    const p2rows = cs.p2.rows.map(b =>
      `<tr><td>${b.label}</td><td>${b.pickDisp}</td><td class="ta-act">${b.actualDisp}</td><td class="ta-pts">${ptBadge(b.pts, b.max)}</td></tr>`).join('');
    p2block = `
      <h4 class="ta-sec">🏆 Slutspelstippning <span class="ta-phase">${cs.p2.total} p</span></h4>
      <table class="ta-btable"><thead><tr><th>Tips</th><th>Gissning</th><th>Facit</th><th></th></tr></thead><tbody>${p2rows}</tbody></table>`;
  }

  el.innerHTML = `
    <div class="ta-head">
      <h3>${_auditPlayer} · ${cs.total} p</h3>
      ${cs.pending ? `<span class="ta-pending">${cs.pending} tips väntar på resultat</span>` : ''}
    </div>
    ${p1block}
    ${p2block}`;
}

function setView(v) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  if (v === 'schedule') renderSchedule();
  if (v === 'groups') renderGroups();
  if (v === 'bracket') renderBracket();
  if (v === 'money') renderMoney();
  if (v === 'tips') renderTips();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function wire() {
  $$('.tab').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));
  $$('#schedule-filter .seg-btn').forEach(b => b.addEventListener('click', () => {
    $$('#schedule-filter .seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); scheduleFilter = b.dataset.f; renderSchedule();
  }));
  $('#f-submit').addEventListener('click', handleSubmit);
  $('#f-amount').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSubmit(); });
  $('#f-player').addEventListener('change', prefillForm);
  $('#f-date').addEventListener('change', prefillForm);
  $('#export-json').addEventListener('click', exportBetting);
  $('#fav-team').addEventListener('change', (e) => {
    favTeam = e.target.value;
    try { localStorage.setItem('wc2026_fav', favTeam); } catch (err) { /* ignore */ }
    renderSchedule();
  });
  $('#only-fav').addEventListener('change', (e) => { onlyFav = e.target.checked; renderSchedule(); });
  $('#compare-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.cmp-chip'); if (!b || !_cmpSel) return;
    const lbl = b.dataset.label;
    if (_cmpSel.has(lbl)) _cmpSel.delete(lbl); else _cmpSel.add(lbl);
    renderCompare();
  });
  $('#tip-board').addEventListener('click', (e) => {
    const row = e.target.closest('.tip-row.clickable'); if (!row) return;
    _auditPlayer = row.dataset.player;
    $$('#tip-board .tip-row').forEach(r => r.classList.toggle('sel', r.dataset.player === _auditPlayer));
    renderTipAudit(allStandings());
  });
  window.addEventListener('resize', () => {
    const bv = $('#view-bracket');
    if (bv && bv.classList.contains('active')) {
      const want = window.innerWidth >= 920 ? 'd' : 'm';
      if (want !== _bracketMode) renderBracket();
    }
    if ($('#view-money').classList.contains('active')) {
      if (_chart) { layoutChart(_chart); drawChart(_chart); }
      if (_compare && _compare.lines && _compare.lines.length) { layoutChart(_compare); drawChart(_compare); }
    }
  });
  // open player detail on click (delegated, survives re-renders)
  $('#standings-money').addEventListener('click', (e) => {
    const row = e.target.closest('.mrow');
    if (row && row.dataset.player) openPlayerModal(row.dataset.player);
  });
  $('#leader-card').addEventListener('click', () => {
    const p = $('#leader-card').dataset.player; if (p) openPlayerModal(p);
  });
  $('#modal-close').addEventListener('click', closePlayerModal);
  $('#modal-backdrop').addEventListener('click', closePlayerModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePlayerModal(); });
  // legend hover highlights the matching chart line
  const legend = $('#chart-legend');
  if (legend) {
    legend.addEventListener('mouseover', (e) => {
      const it = e.target.closest('.leg-item'); if (!it || !_chart) return;
      _chart.hi = +it.dataset.idx; _chart.hovi = null; drawChart();
    });
    legend.addEventListener('mouseout', () => { if (_chart) { _chart.hi = -1; _chart.hovi = null; drawChart(); } });
  }
  // theme toggle
  $('#theme-toggle').addEventListener('click', () => {
    const next = (document.documentElement.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('wc2026_theme', next); } catch (e) { /* ignore */ }
    applyThemeIcon();
  });
  applyThemeIcon();
}
function flash(sel, txt) {
  const el = $(sel), old = el.textContent; el.textContent = txt;
  setTimeout(() => el.textContent = old, 1200);
}

/* ============================================================
   INIT
   ============================================================ */
function rerenderActive() {
  renderCountdown();
  renderStatsBar();
  const v = document.querySelector('.view.active');
  const id = v ? v.id : '';
  if (id === 'view-schedule') renderSchedule();
  else if (id === 'view-groups') renderGroups();
  else if (id === 'view-bracket') renderBracket();
  else if (id === 'view-money') renderMoney();
  else if (id === 'view-tips') renderTips();
}

// poll the static JSON so an open page updates itself without a manual reload.
// cache-busting query bypasses the GitHub Pages edge cache; failures are ignored.
async function refreshData() {
  try {
    const bust = '?t=' + Date.now();
    const [results, omx, sp500, official] = await Promise.all([
      getJSON('./data/results.json' + bust),
      getJSON('./data/omx.json' + bust).catch(() => null),
      getJSON('./data/sp500.json' + bust).catch(() => null),
      getJSON('./data/standings.json' + bust).catch(() => null),
    ]);
    let changed = false;
    if (results && results.updated !== (DATA.results && DATA.results.updated)) { DATA.results = results; changed = true; }
    if (omx && omx.updated !== (DATA.omx && DATA.omx.updated)) { DATA.omx = omx; changed = true; }
    if (sp500 && sp500.updated !== (DATA.sp500 && DATA.sp500.updated)) { DATA.sp500 = sp500; changed = true; }
    if (official && official.updated !== (DATA.standings && DATA.standings.updated)) { DATA.standings = official; changed = true; }
    if (changed) rerenderActive();
  } catch (e) { /* offline or transient: keep current data */ }
}

async function init() {
  try {
    const [fixtures, results, omx, sp500, betting, thirdAlloc, officialStandings] = await Promise.all([
      getJSON('./data/fixtures.json'),
      getJSON('./data/results.json'),
      getJSON('./data/omx.json'),
      getJSON('./data/sp500.json').catch(() => ({ history: [] })),
      getJSON('./data/betting.json'),
      getJSON('./data/third_allocation.json').catch(() => null),
      getJSON('./data/standings.json').catch(() => null),
    ]);
    DATA.fixtures = fixtures; DATA.results = results; DATA.omx = omx; DATA.sp500 = sp500; DATA.betting = betting;
    DATA.thirdAllocation = thirdAlloc;
    DATA.standings = officialStandings;
    DATA.predictions = {};
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="loading">Kunde inte ladda data.<br>${e.message}</div>`;
    return;
  }
  wire();
  populateForm();
  prefillForm();
  populateFavTeam();
  renderSchedule();
  renderCountdown();
  renderStatsBar();
  setInterval(renderCountdown, 60000);
  setInterval(renderStatsBar, 60000);
  setInterval(refreshData, 60000);
  // betting + predictions: live via Firebase if configured, else local. onUpdate re-renders.
  initBetting(() => {
    renderMoney();
    const tv = document.getElementById('view-tips');
    if (tv && tv.classList.contains('active')) renderTips();
  });
}
document.addEventListener('DOMContentLoaded', init);
