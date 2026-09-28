'use strict';

// ---------- Storage ----------
const STORE_KEY = 'levelup-fitness-v1';
const KG_PER_LB = 0.45359237;

function defaultState() {
  return {
    profile: null, // {name, sex, unit, goal, goalKg, startKg}
    sessions: [],
    weights: [], // {date, kg}
    xpLog: [],   // {date, amount, reason, sessionId?}
    achievements: {},
    draft: null,
    settings: { restSec: 90 },
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return Object.assign(defaultState(), JSON.parse(raw));
  } catch (e) { /* ignore */ }
  return defaultState();
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { toast('⚠️ Could not save data'); }
}

// ---------- Helpers ----------
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayStr = () => dateStr(new Date());
function dateStr(d) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function fmtDate(s) { return parseDate(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
const unit = () => state.profile?.unit || 'lb';
const toDisp = (kg) => (unit() === 'lb' ? kg / KG_PER_LB : kg);
const fromDisp = (v) => (unit() === 'lb' ? v * KG_PER_LB : v);
const fmtW = (kg, dec = 1) => `${+toDisp(kg).toFixed(dec)} ${unit()}`;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

function bodyweightKg() {
  const w = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  return w.length ? w[w.length - 1].kg : (state.profile?.startKg || 80);
}

// ---------- Scoring ----------
function e1rm(w, r) { if (!w || !r) return 0; r = Math.min(r, 15); return r <= 1 ? w : w * (1 + r / 30); }

function thresholds(std, region) {
  const f = state.profile?.sex === 'female' ? (FEMALE_FACTOR[region] || 1) : 1;
  return std.map((x) => x * f);
}
function anchors(t) { return [0, t[0], t[1], (t[1] + t[2]) / 2, t[2], (t[2] + t[3]) / 2, t[3], t[4], t[4] * 1.2]; }

// Returns continuous score 0..8 (grade index + progress)
function scoreFor(v, t) {
  const A = anchors(t);
  if (v <= 0) return 0;
  for (let g = A.length - 1; g >= 0; g--) {
    if (v >= A[g]) {
      if (g === A.length - 1) return g;
      return g + (v - A[g]) / (A[g + 1] - A[g]);
    }
  }
  return 0;
}
function nextTarget(v, t) {
  const A = anchors(t);
  for (let g = 0; g < A.length; g++) if (v < A[g]) return { grade: g, value: A[g] };
  return null;
}
const gradeIdx = (score) => Math.max(0, Math.min(8, Math.floor(score + 1e-9)));

function sessionsSorted() { return [...state.sessions].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created); }

// Best performance of an exercise across sessions (optionally excluding a session id)
function bestFor(exId, sessions = state.sessions) {
  const ex = EXERCISES[exId];
  let best = 0;
  for (const s of sessions) for (const e of s.exercises || []) {
    if (e.id !== exId) continue;
    for (const st of e.sets) {
      const v = ex.type === 'reps' ? st.r : e1rm(st.w, st.r);
      if (v > best) best = v;
    }
  }
  return best;
}
function courtBest(cat, sessions = state.sessions) {
  let best = 0;
  for (const s of sessions) if (s.court) for (const st of s.court.stations) if (st.cat === cat) for (const r of st.reps) best = Math.max(best, r || 0);
  return best;
}

function exerciseStats(exId, sessions) {
  const ex = EXERCISES[exId];
  const best = bestFor(exId, sessions);
  if (!best) return null;
  const t = thresholds(ex.std, ex.region);
  const bw = bodyweightKg();
  const v = ex.type === 'reps' ? best : best / bw;
  return { best, v, t, score: scoreFor(v, t) };
}

function muscleScores(sessions = state.sessions) {
  const acc = {};
  const add = (m, w, s, src) => { (acc[m] ||= { sum: 0, w: 0, src: [] }); acc[m].sum += w * s; acc[m].w += w; acc[m].src.push(src); };
  for (const id of Object.keys(EXERCISES)) {
    const st = exerciseStats(id, sessions);
    if (!st) continue;
    for (const [m, w] of Object.entries(EXERCISES[id].muscles)) if (w >= 0.5) add(m, w, st.score, { kind: 'ex', id, ...st });
  }
  for (const c of COURT_STATIONS) {
    const best = courtBest(c.cat, sessions);
    if (!best) continue;
    const t = thresholds(c.std, 'core');
    const score = scoreFor(best, t);
    for (const [m, w] of Object.entries(c.muscles)) add(m, w, score, { kind: 'court', cat: c.cat, name: c.name, best, v: best, t, score });
  }
  const out = {};
  for (const [m, a] of Object.entries(acc)) out[m] = { score: a.sum / a.w, src: a.src };
  return out;
}
function overallScore(ms = muscleScores()) {
  const vals = Object.values(ms).map((x) => x.score);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// ---------- Leveling ----------
const totalXP = () => state.xpLog.reduce((a, x) => a + x.amount, 0);
const xpNeed = (L) => Math.round(100 * Math.pow(L, 1.25));
function levelInfo(xp = totalXP()) {
  let L = 1, rem = xp;
  while (rem >= xpNeed(L)) { rem -= xpNeed(L); L++; }
  return { level: L, into: rem, need: xpNeed(L) };
}
function titleFor(L) { let t = TITLES[0][1]; for (const [l, n] of TITLES) if (L >= l) t = n; return t; }
function addXP(amount, reason, sessionId) { if (amount > 0) state.xpLog.push({ date: todayStr(), amount: Math.round(amount), reason, sessionId }); }

function weekStart(d) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
function sessionsThisWeek(ref = new Date()) {
  const ws = weekStart(ref), we = new Date(ws); we.setDate(ws.getDate() + 7);
  return state.sessions.filter((s) => { const d = parseDate(s.date); return d >= ws && d < we; });
}
function weekStreak() {
  // consecutive weeks (ending this week or last) with >= 3 workouts
  let streak = 0; const d = new Date();
  if (sessionsThisWeek(d).length < 3) d.setDate(d.getDate() - 7);
  while (sessionsThisWeek(d).length >= 3) { streak++; d.setDate(d.getDate() - 7); }
  return streak;
}

function checkAchievements(events) {
  const unlock = (id) => {
    if (state.achievements[id]) return;
    state.achievements[id] = todayStr();
    const a = ACHIEVEMENTS[id];
    addXP(a.xp, `🏅 ${a.name}`);
    events.push({ type: 'ach', id });
  };
  const n = state.sessions.length;
  if (n >= 1) unlock('first_workout');
  if (n >= 10) unlock('workouts_10');
  if (n >= 50) unlock('workouts_50');
  if (n >= 100) unlock('workouts_100');
  if (state.xpLog.some((x) => x.reason.startsWith('PR'))) unlock('first_pr');
  if (state.sessions.some((s) => { const w = sessionsThisWeek(parseDate(s.date)); return new Set(w.map((x) => x.day)).size >= 5; })) unlock('full_week');
  if (state.sessions.some((s) => s.court && s.court.rounds >= 3)) unlock('court_3');
  const ms = muscleScores();
  const maxG = Math.max(-1, ...Object.values(ms).map((m) => gradeIdx(m.score)));
  if (maxG >= 3) unlock('rank_c');
  if (maxG >= 5) unlock('rank_a');
  if (maxG >= 6) unlock('rank_s');
  if (bestFor('bench') >= bodyweightKg()) unlock('bw_bench');
  const p = state.profile;
  if (p && state.weights.length) {
    const moved = p.goal === 'gain' ? bodyweightKg() - p.startKg : p.startKg - bodyweightKg();
    if (p.goal !== 'maintain') {
      if (moved >= 2.26) unlock('weight_5');
      if (moved >= 4.53) unlock('weight_10');
    }
    if (p.goalKg && p.goal !== 'maintain') {
      const hit = p.goal === 'lose' ? bodyweightKg() <= p.goalKg : bodyweightKg() >= p.goalKg;
      if (hit) unlock('goal_weight');
    }
  }
}

// ---------- Draft (in-progress workout) ----------
function lastSessionWith(exId) {
  const ss = sessionsSorted().reverse();
  for (const s of ss) { const e = (s.exercises || []).find((x) => x.id === exId); if (e) return { s, e }; }
  return null;
}
function suggestion(exId, lo, hi) {
  const ex = EXERCISES[exId];
  const last = lastSessionWith(exId);
  if (!last) return { w: '', text: 'First time — pick a weight you can do for ' + (ex.type === 'reps' ? 'max reps' : `${hi} clean reps`) + '.' };
  const sets = last.e.sets;
  if (ex.type === 'reps') return { w: '', text: `Last: ${sets.map((s) => s.r).join(', ')} reps. Beat it!` };
  const topW = Math.max(...sets.map((s) => s.w));
  const allHit = sets.every((s) => s.r >= hi);
  const lastTxt = `Last: ${sets.map((s) => `${+toDisp(s.w).toFixed(1)}×${s.r}`).join(', ')}`;
  if (allHit) {
    const incKg = unit() === 'lb' ? ex.inc * KG_PER_LB : ex.inc / 2;
    return { w: +toDisp(topW + incKg).toFixed(1), text: `${lastTxt} — you hit ${hi} on every set. ⬆️ Add ${unit() === 'lb' ? ex.inc : ex.inc / 2} ${unit()}!` };
  }
  return { w: +toDisp(topW).toFixed(1), text: `${lastTxt} — same weight, aim for ${hi} reps.` };
}

function newDraft(day, date = todayStr()) {
  const plan = PLAN[day];
  const d = { day, date, type: plan.type, title: plan.title, exercises: [], court: null };
  if (plan.type === 'lift') {
    for (const [idOrAlts, sets, lo, hi] of plan.items) {
      const alts = Array.isArray(idOrAlts) ? idOrAlts : null;
      const id = alts ? alts[0] : idOrAlts;
      const sug = suggestion(id, lo, hi);
      d.exercises.push({ id, alts, lo, hi, sets: Array.from({ length: sets }, () => ({ w: sug.w, r: '', done: false })) });
    }
  } else if (plan.type === 'court') {
    d.court = { rounds: 1, stations: COURT_STATIONS.map((c) => ({ cat: c.cat, name: plan.variations ? c.alts[0] : c.name, reps: [''] })) };
  }
  return d;
}

// ---------- Finish workout ----------
function finishWorkout() {
  const d = state.draft;
  if (!d) return;
  const beforeMs = muscleScores();
  const beforeLevel = levelInfo().level;
  const prevSessions = [...state.sessions];
  const sid = uid();
  const session = { id: sid, created: Date.now(), date: d.date, day: d.day, title: d.title, type: d.type, exercises: [], court: null };
  let setCount = 0;
  const xpItems = [];

  if (d.type === 'lift') {
    for (const e of d.exercises) {
      const ex = EXERCISES[e.id];
      const sets = e.sets.filter((s) => num(s.r) > 0 && (ex.type === 'reps' || num(s.w) > 0))
        .map((s) => ({ w: ex.type === 'reps' ? fromDisp(num(s.w)) : fromDisp(num(s.w)), r: Math.round(num(s.r)) }));
      if (!sets.length) continue;
      session.exercises.push({ id: e.id, sets });
      setCount += sets.length;
    }
    if (!setCount) { toast('Log at least one set (weight + reps) first'); return; }
    xpItems.push([setCount * 10, `${setCount} sets completed`]);
  } else {
    const rounds = d.court.rounds;
    const stations = d.court.stations.map((s) => ({ cat: s.cat, name: s.name, reps: s.reps.slice(0, rounds).map((r) => Math.round(num(r))) }));
    const filled = stations.reduce((a, s) => a + s.reps.filter((r) => r > 0).length, 0);
    if (!filled) { toast('Enter reps for at least one station'); return; }
    session.court = { rounds, stations };
    const fullRounds = [...Array(rounds).keys()].filter((i) => stations.every((s) => s.reps[i] > 0)).length;
    xpItems.push([filled * 8, `${filled} stations completed`]);
    if (fullRounds) xpItems.push([fullRounds * 25, `${fullRounds} full round${fullRounds > 1 ? 's' : ''}`]);
  }
  xpItems.push([50, `Workout complete: ${d.title}`]);

  // PRs
  const prs = [];
  for (const e of session.exercises) {
    const prev = bestFor(e.id, prevSessions);
    const now = bestFor(e.id, [session]);
    if (prev > 0 && now > prev + 1e-6) { prs.push(EXERCISES[e.id].name); xpItems.push([75, `PR: ${EXERCISES[e.id].name}`]); }
  }
  if (session.court) for (const st of session.court.stations) {
    const prev = courtBest(st.cat, prevSessions);
    const now = Math.max(0, ...st.reps);
    if (prev > 0 && now > prev) { prs.push(`${st.cat} (${st.name})`); xpItems.push([40, `PR: ${st.cat} station`]); }
  }

  state.sessions.push(session);

  // Rank ups
  const afterMs = muscleScores();
  const rankUps = [];
  for (const [m, a] of Object.entries(afterMs)) {
    const b = beforeMs[m] ? gradeIdx(beforeMs[m].score) : -1;
    const g = gradeIdx(a.score);
    if (g > b) {
      rankUps.push({ m, from: b, to: g });
      if (b >= 0) xpItems.push([150 * (g - b), `Rank up: ${MUSCLES[m].name} → ${GRADES[g]}`]);
      else xpItems.push([50, `New rank: ${MUSCLES[m].name} ${GRADES[g]}`]);
    }
  }
  for (const [amt, reason] of xpItems) addXP(amt, reason, sid);
  session.xp = xpItems.reduce((a, x) => a + x[0], 0);

  const events = [];
  checkAchievements(events);
  state.draft = null;
  save();
  stopRestTimer();
  showResults({ xpItems, prs, rankUps, events, beforeLevel, afterLevel: levelInfo().level });
}

// ---------- Bodyweight ----------
function logWeight(val) {
  const kg = fromDisp(num(val));
  if (kg < 25 || kg > 350) { toast('Enter a valid bodyweight'); return; }
  const p = state.profile;
  const today = todayStr();
  const prev = state.weights.map((w) => w.kg);
  const beforeLevel = levelInfo().level;
  const already = state.weights.find((w) => w.date === today);
  if (already) already.kg = kg; else state.weights.push({ date: today, kg });
  if (!already) addXP(5, 'Weigh-in');
  if (prev.length && p.goal !== 'maintain') {
    const record = p.goal === 'lose' ? Math.min(p.startKg, ...prev) : Math.max(p.startKg, ...prev);
    const delta = p.goal === 'lose' ? record - kg : kg - record;
    if (delta > 0.05) addXP(delta * 60, p.goal === 'lose' ? `New low: −${fmtW(delta)}` : `New high: +${fmtW(delta)}`);
  }
  const events = [];
  checkAchievements(events);
  save();
  events.forEach((e) => toast(`🏅 Achievement: ${ACHIEVEMENTS[e.id].name}`));
  if (levelInfo().level > beforeLevel) showLevelUp(levelInfo().level);
  render();
}

// ---------- UI: shell ----------
let tab = 'home';
let openMuscle = null;
let openSession = null;

function render() {
  if (!state.profile) { renderOnboarding(); return; }
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  const main = $('#main');
  const views = { home: viewHome, train: viewTrain, ranks: viewRanks, body: viewBody, history: viewHistory, settings: viewSettings };
  main.innerHTML = views[tab]();
  if (tab === 'body') drawWeightChart();
}

function badge(g, size = '') {
  if (g == null || g < 0) return `<span class="badge g-none ${size}">–</span>`;
  return `<span class="badge g${g} ${size}">${GRADES[g]}</span>`;
}

function xpBar() {
  const li = levelInfo();
  return `<div class="xpbar"><div class="xpfill" style="width:${(li.into / li.need) * 100}%"></div></div>
    <div class="xptext"><span>${li.into} / ${li.need} XP</span><span>${totalXP().toLocaleString()} total</span></div>`;
}

// ---------- Views ----------
function viewHome() {
  const li = levelInfo();
  const ms = muscleScores();
  const ov = overallScore(ms);
  const todayPlan = PLAN[new Date().getDay()];
  const wk = sessionsThisWeek();
  const recent = [...state.xpLog].slice(-8).reverse();
  const bw = state.weights.length ? bodyweightKg() : null;
  const bwDelta = bw != null ? bw - state.profile.startKg : 0;
  return `
  <section class="card hero">
    <div class="hero-top">
      <div>
        <div class="muted small">HUNTER</div>
        <div class="hero-name">${esc(state.profile.name)}</div>
        <div class="title-chip">${titleFor(li.level)}</div>
      </div>
      <div class="lvl"><div class="muted small">LEVEL</div><div class="lvl-num">${li.level}</div></div>
      <div class="ov"><div class="muted small">RANK</div>${ov == null ? badge(null, 'xl') : badge(gradeIdx(ov), 'xl')}</div>
    </div>
    ${xpBar()}
  </section>

  <section class="card quest">
    <div class="row between">
      <div><div class="muted small">TODAY'S QUEST</div><div class="h2">${todayPlan.emoji} ${todayPlan.title}</div></div>
      ${todayPlan.type !== 'rest' ? `<button class="btn primary" data-act="start-today">${state.draft ? 'Continue' : 'Start'}</button>` : ''}
    </div>
    ${todayPlan.type === 'rest' ? '<p class="muted">Recover, stretch, walk, hydrate. Log your bodyweight in the Body tab!</p>' : ''}
  </section>

  <section class="stats">
    <div class="stat"><div class="stat-v">${wk.length}/5</div><div class="stat-l">This week</div></div>
    <div class="stat"><div class="stat-v">${weekStreak()}🔥</div><div class="stat-l">Week streak</div></div>
    <div class="stat"><div class="stat-v">${state.sessions.length}</div><div class="stat-l">Workouts</div></div>
    <div class="stat"><div class="stat-v">${bw == null ? '–' : (bwDelta > 0 ? '+' : '') + (+toDisp(bwDelta).toFixed(1))}</div><div class="stat-l">${unit()} change</div></div>
  </section>

  <section class="card">
    <div class="row between"><div class="h3">Muscle Ranks</div><button class="link" data-tab-go="ranks">All ›</button></div>
    <div class="mini-ranks">
      ${Object.keys(MUSCLES).map((m) => `<div class="mini-rank">${badge(ms[m] ? gradeIdx(ms[m].score) : null, 'sm')}<span>${MUSCLES[m].name}</span></div>`).join('')}
    </div>
  </section>

  <section class="card">
    <div class="h3">Achievements <span class="muted small">${Object.keys(state.achievements).length}/${Object.keys(ACHIEVEMENTS).length}</span></div>
    <div class="ach-grid">
      ${Object.entries(ACHIEVEMENTS).map(([id, a]) => `<div class="ach ${state.achievements[id] ? 'got' : ''}" title="${esc(a.desc)}"><div class="ach-i">${a.icon}</div><div class="ach-n">${a.name}</div><div class="ach-d">${a.desc} · ${a.xp} XP</div></div>`).join('')}
    </div>
  </section>

  <section class="card">
    <div class="h3">Recent XP</div>
    ${recent.length ? recent.map((x) => `<div class="xp-row"><span>${esc(x.reason)}</span><span class="xp-plus">+${x.amount}</span></div>`).join('') : '<p class="muted">Finish your first workout to earn XP.</p>'}
  </section>`;
}

function viewTrain() {
  const d = state.draft;
  if (!d) {
    const days = [1, 2, 3, 4, 5, 6, 0];
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date().getDay();
    return `<section class="card"><div class="h2">Choose a workout</div><p class="muted">Today is highlighted. You can log any day.</p></section>
      ${days.map((day) => { const p = PLAN[day]; return `
        <button class="card day-card ${day === today ? 'today' : ''}" data-act="${p.type === 'rest' ? '' : 'start-day'}" data-day="${day}" ${p.type === 'rest' ? 'disabled' : ''}>
          <div class="day-name">${names[day]}</div>
          <div class="day-title">${p.emoji} ${p.title}</div>
          <div class="muted small">${p.type === 'lift' ? p.items.map((i) => Array.isArray(i[0]) ? i[0].map((x) => EXERCISES[x].name).join(' / ') : EXERCISES[i[0]].name).join(' · ') : p.type === 'court' ? '7 stations · 45s work / 15s rest · 1–3 rounds' : 'Recovery'}</div>
        </button>`; }).join('')}`;
  }
  const header = `<section class="card">
      <div class="row between"><div><div class="muted small">IN PROGRESS</div><div class="h2">${PLAN[d.day].emoji} ${esc(d.title)}</div></div>
      <button class="btn ghost small" data-act="cancel-draft">Discard</button></div>
      <label class="field inline">Date <input type="date" data-bind="date" value="${d.date}" max="${todayStr()}"></label>
    </section>`;
  if (d.type === 'lift') {
    return header + d.exercises.map((e, i) => {
      const ex = EXERCISES[e.id];
      const sug = suggestion(e.id, e.lo, e.hi);
      const isReps = ex.type === 'reps';
      return `<section class="card ex-card">
        <div class="row between">
          <div>
            ${e.alts ? `<select class="ex-select" data-alt="${i}">${e.alts.map((a) => `<option value="${a}" ${a === e.id ? 'selected' : ''}>${EXERCISES[a].name}</option>`).join('')}</select>` : `<div class="h3">${ex.name}</div>`}
            <div class="muted small">${e.sets.length} × ${e.lo}–${e.hi}${ex.note ? ` · ${ex.note}` : ''}</div>
          </div>
          ${exBadge(e.id)}
        </div>
        <div class="hint">${esc(sug.text)}</div>
        <div class="set-head"><span>Set</span><span>${isReps ? 'Added wt (opt.)' : unit()}</span><span>Reps</span><span></span></div>
        ${e.sets.map((s, j) => `<div class="set-row ${s.done ? 'done' : ''}">
            <span class="set-n">${j + 1}</span>
            <input inputmode="decimal" type="number" step="any" min="0" placeholder="${isReps ? '0' : unit()}" value="${s.w}" data-set="${i}:${j}:w">
            <input inputmode="numeric" type="number" min="0" placeholder="${e.lo}-${e.hi}" value="${s.r}" data-set="${i}:${j}:r">
            <button class="check ${s.done ? 'on' : ''}" data-act="toggle-set" data-ij="${i}:${j}">✓</button>
          </div>`).join('')}
        <div class="row gap"><button class="btn ghost small" data-act="add-set" data-i="${i}">+ Set</button>${e.sets.length > 1 ? `<button class="btn ghost small" data-act="rm-set" data-i="${i}">− Set</button>` : ''}</div>
      </section>`;
    }).join('') + `<button class="btn primary block big" data-act="finish">⚔️ Finish Workout</button><div class="spacer"></div>`;
  }
  // court
  const c = d.court;
  return header + `<section class="card">
      <div class="row between"><div class="h3">Rounds</div>
        <div class="seg">${[1, 2, 3].map((r) => `<button class="${c.rounds === r ? 'on' : ''}" data-act="rounds" data-r="${r}">${r}</button>`).join('')}</div></div>
      <p class="muted small">45 sec work / 15 sec rest. Start with 1 round (7 min); work up to 2–3 when you recover well. Count reps during each 45s interval.</p>
      <button class="btn primary block" data-act="interval">⏱️ Start Interval Timer (${c.rounds * 7} min)</button>
    </section>
    ${c.stations.map((s, i) => {
      const def = COURT_STATIONS[i];
      const best = courtBest(s.cat);
      const g = best ? gradeIdx(scoreFor(best, thresholds(def.std, 'core'))) : null;
      return `<section class="card ex-card">
        <div class="row between"><div><div class="muted small">${s.cat.toUpperCase()}</div>
          <select class="ex-select" data-station="${i}">${[def.name, ...def.alts].map((n) => `<option ${n === s.name ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          ${badge(g, 'sm')}</div>
        ${best ? `<div class="hint">Best: ${best} reps in 45s</div>` : ''}
        <div class="round-inputs">${[...Array(c.rounds).keys()].map((r) => `<label>R${r + 1}<input inputmode="numeric" type="number" min="0" placeholder="reps" value="${s.reps[r] ?? ''}" data-court="${i}:${r}"></label>`).join('')}</div>
      </section>`;
    }).join('')}
    <button class="btn primary block big" data-act="finish">⚔️ Finish Workout</button><div class="spacer"></div>`;
}

function exBadge(id) {
  const st = exerciseStats(id);
  return st ? badge(gradeIdx(st.score), 'sm') : badge(null, 'sm');
}

function viewRanks() {
  const ms = muscleScores();
  const ov = overallScore(ms);
  const bw = bodyweightKg();
  return `<section class="card">
      <div class="row between"><div><div class="h2">Muscle Ranks</div>
      <div class="muted small">Based on your best estimated 1-rep max vs. bodyweight (${fmtW(bw)}), compared to population strength standards.</div></div>
      ${ov == null ? badge(null, 'lg') : badge(gradeIdx(ov), 'lg')}</div>
      <div class="legend">${GRADES.map((g, i) => `<span>${badge(i, 'xs')} ${GRADE_LABELS[i]}</span>`).join('')}</div>
    </section>
    ${Object.keys(MUSCLES).map((m) => {
      const d = ms[m];
      const g = d ? gradeIdx(d.score) : null;
      const prog = d ? (g >= 8 ? 100 : (d.score - g) * 100) : 0;
      const open = openMuscle === m;
      return `<section class="card muscle ${open ? 'open' : ''}">
        <button class="muscle-head" data-act="muscle" data-m="${m}">
          ${badge(g, 'md')}
          <div class="muscle-mid"><div class="h3">${MUSCLES[m].icon} ${MUSCLES[m].name}</div>
            <div class="pbar"><div class="pfill g${g ?? 'n'}" style="width:${prog}%"></div></div>
            <div class="muted small">${d ? (g >= 8 ? 'MAX RANK' : `${Math.round(prog)}% to ${GRADES[g + 1]}`) : 'Unranked — log an exercise for this muscle'}</div></div>
          <span class="chev">${open ? '▾' : '▸'}</span>
        </button>
        ${open && d ? `<div class="muscle-body">${d.src.map(srcRow).join('')}</div>` : ''}
      </section>`;
    }).join('')}
    <p class="muted small pad">Standards are estimates compiled from public strength-standard tables (Strength Level, Legion, Stronger) and scaled for ${state.profile.sex === 'female' ? 'women' : 'men'}. Dumbbell lifts use the weight of one dumbbell. Estimated 1RM uses the Epley formula.</p>`;
}

function srcRow(s) {
  const g = gradeIdx(s.score);
  if (s.kind === 'court') {
    const nt = nextTarget(s.v, s.t);
    return `<div class="src"><div>${badge(g, 'xs')} <b>${esc(s.name)}</b> <span class="muted">(${s.cat} station)</span></div>
      <div class="muted small">Best ${s.best} reps / 45s${nt ? ` · ${GRADES[nt.grade]} at ${Math.ceil(nt.value)} reps` : ''}</div></div>`;
  }
  const ex = EXERCISES[s.id];
  const nt = nextTarget(s.v, s.t);
  if (ex.type === 'reps') {
    return `<div class="src"><div>${badge(g, 'xs')} <b>${ex.name}</b></div><div class="muted small">Best ${s.best} reps${nt ? ` · ${GRADES[nt.grade]} at ${Math.ceil(nt.value)} reps` : ''}</div></div>`;
  }
  const bw = bodyweightKg();
  let next = '';
  if (nt) {
    const need = nt.value * bw;
    next = ` · ${GRADES[nt.grade]} at ${fmtW(need, 0)} 1RM (≈ ${fmtW(need / (1 + 8 / 30), 0)} × 8)`;
  }
  return `<div class="src"><div>${badge(g, 'xs')} <b>${ex.name}</b></div>
    <div class="muted small">Est. 1RM ${fmtW(s.best, 0)} · ${s.v.toFixed(2)}× BW${next}</div>
    ${sparkline(s.id)}</div>`;
}

function sparkline(id) {
  const pts = [];
  for (const s of sessionsSorted()) {
    const e = (s.exercises || []).find((x) => x.id === id);
    if (e) pts.push(Math.max(...e.sets.map((st) => e1rm(st.w, st.r))));
  }
  if (pts.length < 2) return '';
  const W = 240, H = 36, mn = Math.min(...pts), mx = Math.max(...pts), rng = mx - mn || 1;
  const d = pts.map((p, i) => `${(i / (pts.length - 1)) * W},${H - 4 - ((p - mn) / rng) * (H - 8)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><polyline points="${d}" /></svg>`;
}

function viewBody() {
  const p = state.profile;
  const ws = [...state.weights].sort((a, b) => b.date.localeCompare(a.date));
  const cur = bodyweightKg();
  const goalTxt = { lose: 'Lose weight', gain: 'Gain weight', maintain: 'Maintain' }[p.goal];
  let pct = null;
  if (p.goalKg && p.goal !== 'maintain' && Math.abs(p.goalKg - p.startKg) > 0.01) pct = Math.max(0, Math.min(100, ((p.startKg - cur) / (p.startKg - p.goalKg)) * 100));
  return `<section class="card">
      <div class="h2">Bodyweight</div>
      <div class="stats three">
        <div class="stat"><div class="stat-v">${+toDisp(cur).toFixed(1)}</div><div class="stat-l">Current (${unit()})</div></div>
        <div class="stat"><div class="stat-v">${+toDisp(p.startKg).toFixed(1)}</div><div class="stat-l">Start</div></div>
        <div class="stat"><div class="stat-v">${p.goalKg ? +toDisp(p.goalKg).toFixed(1) : '–'}</div><div class="stat-l">Goal</div></div>
      </div>
      <div class="muted small">Goal: ${goalTxt}. ${p.goal === 'maintain' ? 'You earn XP for each weigh-in.' : `You earn ~${unit() === 'lb' ? 27 : 60} XP per ${unit()} of progress toward your goal each time you hit a new ${p.goal === 'lose' ? 'low' : 'high'}.`} Lighter bodyweight also raises your relative-strength ranks!</div>
      ${pct != null ? `<div class="pbar big"><div class="pfill gA" style="width:${pct}%"></div></div><div class="muted small">${Math.round(pct)}% to goal</div>` : ''}
      <div class="row gap mt">
        <input id="bw-in" inputmode="decimal" type="number" step="any" placeholder="Today's weight (${unit()})">
        <button class="btn primary" data-act="log-weight">Log</button>
      </div>
    </section>
    <section class="card"><div class="h3">Trend</div><div id="chart"></div></section>
    <section class="card"><div class="h3">Entries</div>
      ${ws.length ? ws.map((w) => `<div class="xp-row"><span>${fmtDate(w.date)}</span><span>${fmtW(w.kg)} <button class="link danger" data-act="del-weight" data-d="${w.date}">✕</button></span></div>`).join('') : '<p class="muted">No entries yet.</p>'}
    </section>`;
}

function drawWeightChart() {
  const el = $('#chart');
  if (!el) return;
  const ws = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
  if (ws.length < 2) { el.innerHTML = '<p class="muted">Log at least 2 weigh-ins to see your trend.</p>'; return; }
  const W = 320, H = 150, P = 28;
  const vals = ws.map((w) => toDisp(w.kg));
  const goal = state.profile.goalKg ? toDisp(state.profile.goalKg) : null;
  const all = goal != null ? [...vals, goal] : vals;
  const mn = Math.min(...all) - 1, mx = Math.max(...all) + 1;
  const t0 = parseDate(ws[0].date).getTime(), t1 = parseDate(ws[ws.length - 1].date).getTime() || t0 + 1;
  const x = (d) => P + ((parseDate(d).getTime() - t0) / (t1 - t0 || 1)) * (W - P - 8);
  const y = (v) => 8 + (1 - (v - mn) / (mx - mn)) * (H - 28);
  const pts = ws.map((w, i) => `${x(w.date)},${y(vals[i])}`).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="chart">
    <text x="2" y="${y(mx - 1) + 4}" class="axis">${(mx - 1).toFixed(0)}</text>
    <text x="2" y="${y(mn + 1) + 4}" class="axis">${(mn + 1).toFixed(0)}</text>
    ${goal != null ? `<line x1="${P}" x2="${W - 8}" y1="${y(goal)}" y2="${y(goal)}" class="goal-line"/><text x="${W - 8}" y="${y(goal) - 4}" text-anchor="end" class="axis">goal</text>` : ''}
    <polyline points="${pts}" class="wline"/>
    ${ws.map((w, i) => `<circle cx="${x(w.date)}" cy="${y(vals[i])}" r="3" class="wdot"/>`).join('')}
    <text x="${P}" y="${H - 4}" class="axis">${fmtDate(ws[0].date)}</text>
    <text x="${W - 8}" y="${H - 4}" text-anchor="end" class="axis">${fmtDate(ws[ws.length - 1].date)}</text>
  </svg>`;
}

function viewHistory() {
  const ss = sessionsSorted().reverse();
  if (!ss.length) return '<section class="card"><div class="h2">History</div><p class="muted">No workouts yet. Go start your first quest!</p></section>';
  return `<section class="card"><div class="h2">History</div><div class="muted small">${ss.length} workouts · ${totalXP().toLocaleString()} XP earned</div></section>` +
    ss.map((s) => {
      const open = openSession === s.id;
      let body = '';
      if (open) {
        if (s.exercises?.length) body = s.exercises.map((e) => `<div class="src"><b>${EXERCISES[e.id].name}</b><div class="muted small">${e.sets.map((st) => EXERCISES[e.id].type === 'reps' ? `${st.r} reps` : `${+toDisp(st.w).toFixed(1)}×${st.r}`).join(' · ')}</div></div>`).join('');
        if (s.court) body = `<div class="muted small">${s.court.rounds} round(s)</div>` + s.court.stations.map((st) => `<div class="src"><b>${esc(st.name)}</b> <span class="muted small">(${st.cat})</span><div class="muted small">${st.reps.join(' / ')} reps</div></div>`).join('');
        body += `<button class="btn ghost small danger mt" data-act="del-session" data-id="${s.id}">Delete workout</button>`;
      }
      return `<section class="card">
        <button class="muscle-head" data-act="session" data-id="${s.id}">
          <div class="muscle-mid"><div class="h3">${PLAN[s.day]?.emoji || '🏋️'} ${esc(s.title)}</div><div class="muted small">${fmtDate(s.date)}</div></div>
          <span class="xp-plus">+${s.xp || 0} XP</span><span class="chev">${open ? '▾' : '▸'}</span>
        </button>${open ? `<div class="muscle-body">${body}</div>` : ''}</section>`;
    }).join('');
}

function viewSettings() {
  const p = state.profile;
  return `<section class="card"><div class="h2">Profile</div>
    ${profileForm(p)}
    <button class="btn primary block mt" data-act="save-profile">Save</button></section>
    <section class="card"><div class="h3">Rest timer</div>
      <label class="field">Seconds between sets <input type="number" id="rest-sec" value="${state.settings.restSec}" min="0" step="15"></label>
      <button class="btn ghost small" data-act="save-rest">Save</button></section>
    <section class="card"><div class="h3">Backup</div>
      <p class="muted small">Your data is stored only on this device. Export a backup regularly (e.g. to Files / Drive).</p>
      <div class="row gap"><button class="btn ghost" data-act="export">Export</button>
      <label class="btn ghost">Import<input type="file" accept=".json,application/json" id="import-file" hidden></label></div></section>
    <section class="card"><div class="h3 danger">Danger zone</div><button class="btn ghost danger" data-act="reset">Reset everything</button></section>
    <p class="muted small pad">Level Up Fitness · works offline · v1</p>`;
}

function profileForm(p = {}) {
  const u = p.unit || 'lb';
  const conv = (kg) => (kg ? +(u === 'lb' ? kg / KG_PER_LB : kg).toFixed(1) : '');
  return `
    <label class="field">Name <input id="pf-name" value="${esc(p.name || '')}" placeholder="Your hunter name"></label>
    <label class="field">Sex (for strength standards)
      <select id="pf-sex"><option value="male" ${p.sex !== 'female' ? 'selected' : ''}>Male</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>Female</option></select></label>
    <label class="field">Units <select id="pf-unit"><option value="lb" ${u === 'lb' ? 'selected' : ''}>lb</option><option value="kg" ${u === 'kg' ? 'selected' : ''}>kg</option></select></label>
    <label class="field">${p.startKg ? 'Starting' : 'Current'} bodyweight <input id="pf-bw" inputmode="decimal" type="number" step="any" value="${conv(p.startKg)}"></label>
    <label class="field">Goal <select id="pf-goal">
      <option value="lose" ${p.goal === 'lose' || !p.goal ? 'selected' : ''}>Lose weight</option>
      <option value="gain" ${p.goal === 'gain' ? 'selected' : ''}>Gain weight / bulk</option>
      <option value="maintain" ${p.goal === 'maintain' ? 'selected' : ''}>Maintain / recomp</option></select></label>
    <label class="field">Goal bodyweight (optional) <input id="pf-goalw" inputmode="decimal" type="number" step="any" value="${conv(p.goalKg)}"></label>`;
}
function readProfileForm() {
  const u = $('#pf-unit').value;
  const toKg = (v) => (num(v) ? (u === 'lb' ? num(v) * KG_PER_LB : num(v)) : null);
  return { name: $('#pf-name').value.trim() || 'Hunter', sex: $('#pf-sex').value, unit: u, startKg: toKg($('#pf-bw').value), goal: $('#pf-goal').value, goalKg: toKg($('#pf-goalw').value) };
}

function renderOnboarding() {
  $('#main').innerHTML = `<section class="card hero onboard">
    <div class="h1">⚔️ Level Up</div>
    <p>Welcome, hunter. Every set, PR and pound moves you up. Your muscles are ranked <b>F → S++</b> against real-world strength standards.</p>
    ${profileForm({})}
    <button class="btn primary block big mt" data-act="create-profile">Begin</button></section>`;
}

// ---------- Modals & toasts ----------
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3100);
}
function modal(html) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box">${html}<button class="btn primary block mt" data-act="close-modal">Continue</button></div>`;
  m.hidden = false;
}
function showResults({ xpItems, prs, rankUps, events, beforeLevel, afterLevel }) {
  const total = xpItems.reduce((a, x) => a + x[0], 0) + events.reduce((a, e) => a + ACHIEVEMENTS[e.id].xp, 0);
  modal(`<div class="result">
    <div class="h1 glow">QUEST COMPLETE</div>
    <div class="big-xp">+${total} XP</div>
    ${afterLevel > beforeLevel ? `<div class="levelup">⬆️ LEVEL UP! ${beforeLevel} → <b>${afterLevel}</b><div class="muted">${titleFor(afterLevel)}</div></div>` : ''}
    ${rankUps.length ? `<div class="h3 mt">Rank Ups</div>${rankUps.map((r) => `<div class="rankup">${MUSCLES[r.m].name}: ${badge(r.from, 'xs')} → ${badge(r.to, 'sm')}</div>`).join('')}` : ''}
    ${prs.length ? `<div class="h3 mt">🔥 New PRs</div><div>${prs.map(esc).join(', ')}</div>` : ''}
    ${events.length ? `<div class="h3 mt">🏅 Achievements</div>${events.map((e) => `<div>${ACHIEVEMENTS[e.id].icon} ${ACHIEVEMENTS[e.id].name} (+${ACHIEVEMENTS[e.id].xp})</div>`).join('')}` : ''}
    <div class="h3 mt">Breakdown</div>
    ${xpItems.map(([a, r]) => `<div class="xp-row"><span>${esc(r)}</span><span class="xp-plus">+${a}</span></div>`).join('')}
  </div>`);
  vibrate([60, 40, 120]);
}
function showLevelUp(L) {
  modal(`<div class="result"><div class="h1 glow">LEVEL UP!</div><div class="lvl-num huge">${L}</div><div class="title-chip">${titleFor(L)}</div></div>`);
  vibrate([60, 40, 120]);
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) { /* noop */ } }

// ---------- Rest timer (between sets) ----------
let restTimer = null;
function startRestTimer() {
  const secs = state.settings.restSec;
  if (!secs) return;
  stopRestTimer();
  const end = Date.now() + secs * 1000;
  const el = $('#rest');
  el.hidden = false;
  const tick = () => {
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    el.innerHTML = `⏱️ Rest ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} <button data-act="stop-rest">✕</button>`;
    if (left <= 0) { beep(880, 0.3); vibrate([200, 100, 200]); stopRestTimer(); toast('💪 Rest over — next set!'); }
  };
  tick();
  restTimer = setInterval(tick, 500);
}
function stopRestTimer() { clearInterval(restTimer); restTimer = null; const el = $('#rest'); if (el) el.hidden = true; }

// ---------- Interval timer (Fitness Court) ----------
let audioCtx = null;
function beep(freq = 660, dur = 0.15) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.25, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (e) { /* noop */ }
}
let iv = null;
async function startInterval() {
  const c = state.draft.court;
  const phases = [{ kind: 'ready', sec: 10, label: 'Get ready', next: c.stations[0].name }];
  for (let r = 0; r < c.rounds; r++) c.stations.forEach((s, i) => {
    phases.push({ kind: 'work', sec: 45, label: s.name, cat: s.cat, round: r + 1 });
    const nxt = c.stations[i + 1] || (r + 1 < c.rounds ? c.stations[0] : null);
    if (nxt) phases.push({ kind: 'rest', sec: 15, label: 'Rest', next: nxt.name });
  });
  let wake = null;
  try { wake = await navigator.wakeLock?.request('screen'); } catch (e) { /* noop */ }
  try { window.AndroidBridge?.keepScreenOn(true); } catch (e) { /* noop */ }
  iv = { phases, idx: 0, end: Date.now() + phases[0].sec * 1000, paused: false, left: 0, wake, rounds: c.rounds };
  beep(); $('#timer').hidden = false;
  iv.handle = setInterval(ivTick, 200); ivTick();
}
function ivTick() {
  if (!iv) return;
  const ph = iv.phases[iv.idx];
  const left = iv.paused ? iv.left : Math.max(0, (iv.end - Date.now()) / 1000);
  const secs = Math.ceil(left);
  if (!iv.paused && secs <= 3 && secs > 0 && iv.lastBeep !== `${iv.idx}:${secs}`) { iv.lastBeep = `${iv.idx}:${secs}`; beep(520, 0.1); }
  if (!iv.paused && left <= 0) { ivNext(); return; }
  $('#timer').innerHTML = `<div class="timer-box ${ph.kind}">
    <div class="timer-kind">${ph.kind === 'work' ? `WORK · ${ph.cat} · Round ${ph.round}/${iv.rounds}` : ph.kind.toUpperCase()}</div>
    <div class="timer-label">${esc(ph.label)}</div>
    <div class="timer-sec">${secs}</div>
    ${ph.next ? `<div class="muted">Next: ${esc(ph.next)}</div>` : ''}
    <div class="timer-prog">${iv.idx + 1} / ${iv.phases.length}</div>
    <div class="row gap center mt">
      <button class="btn ghost" data-act="iv-pause">${iv.paused ? '▶ Resume' : '⏸ Pause'}</button>
      <button class="btn ghost" data-act="iv-skip">⏭ Skip</button>
      <button class="btn ghost danger" data-act="iv-stop">■ Stop</button>
    </div></div>`;
}
function ivNext() {
  iv.idx++;
  if (iv.idx >= iv.phases.length) { beep(880, 0.5); vibrate([300, 100, 300]); stopInterval(); toast('🌳 Circuit complete! Enter your reps.'); return; }
  const ph = iv.phases[iv.idx];
  beep(ph.kind === 'work' ? 990 : 440, 0.35); vibrate(ph.kind === 'work' ? [200] : [80, 60, 80]);
  iv.end = Date.now() + ph.sec * 1000;
}
function stopInterval() {
  if (!iv) return;
  clearInterval(iv.handle);
  try { iv.wake?.release(); } catch (e) { /* noop */ }
  try { window.AndroidBridge?.keepScreenOn(false); } catch (e) { /* noop */ }
  iv = null; $('#timer').hidden = true;
}

// Android back button: close overlays, then return to Home, then exit.
window.__back = () => {
  if (iv) { stopInterval(); return true; }
  if (!$('#modal').hidden) { $('#modal').hidden = true; tab = 'home'; render(); return true; }
  if (state.profile && tab !== 'home') { tab = 'home'; render(); window.scrollTo(0, 0); return true; }
  return false;
};

// ---------- Events ----------
document.addEventListener('click', (ev) => {
  const tabBtn = ev.target.closest('.tabbar button, [data-tab-go]');
  if (tabBtn && state.profile) { tab = tabBtn.dataset.tab || tabBtn.dataset.tabGo; render(); window.scrollTo(0, 0); return; }
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const d = state.draft;
  switch (act) {
    case 'create-profile': {
      const p = readProfileForm();
      if (!p.startKg) { toast('Enter your bodyweight'); return; }
      state.profile = p;
      state.weights.push({ date: todayStr(), kg: p.startKg });
      save(); render(); break;
    }
    case 'save-profile': {
      const p = readProfileForm();
      if (!p.startKg) { toast('Enter your bodyweight'); return; }
      state.profile = p; save(); toast('Saved'); render(); break;
    }
    case 'save-rest': state.settings.restSec = Math.max(0, Math.round(num($('#rest-sec').value))); save(); toast('Saved'); break;
    case 'start-today': {
      const day = new Date().getDay();
      if (!state.draft) state.draft = newDraft(day);
      save(); tab = 'train'; render(); window.scrollTo(0, 0); break;
    }
    case 'start-day': state.draft = newDraft(+el.dataset.day); save(); render(); window.scrollTo(0, 0); break;
    case 'cancel-draft': if (confirm('Discard this workout?')) { state.draft = null; save(); stopRestTimer(); render(); } break;
    case 'toggle-set': {
      const [i, j] = el.dataset.ij.split(':').map(Number);
      const s = d.exercises[i].sets[j];
      s.done = !s.done;
      if (s.done && !s.r) s.r = d.exercises[i].hi;
      save(); render();
      if (s.done) startRestTimer();
      break;
    }
    case 'add-set': { const e = d.exercises[+el.dataset.i]; const last = e.sets[e.sets.length - 1]; e.sets.push({ w: last?.w ?? '', r: '', done: false }); save(); render(); break; }
    case 'rm-set': { d.exercises[+el.dataset.i].sets.pop(); save(); render(); break; }
    case 'rounds': {
      const r = +el.dataset.r; d.court.rounds = r;
      d.court.stations.forEach((s) => { while (s.reps.length < r) s.reps.push(''); });
      save(); render(); break;
    }
    case 'interval': startInterval(); break;
    case 'iv-pause': if (iv) { if (iv.paused) { iv.end = Date.now() + iv.left * 1000; iv.paused = false; } else { iv.left = Math.max(0, (iv.end - Date.now()) / 1000); iv.paused = true; } ivTick(); } break;
    case 'iv-skip': if (iv) { if (iv.paused) { iv.paused = false; } ivNext(); ivTick(); } break;
    case 'iv-stop': stopInterval(); break;
    case 'finish': finishWorkout(); break;
    case 'close-modal': $('#modal').hidden = true; tab = 'home'; render(); window.scrollTo(0, 0); break;
    case 'muscle': openMuscle = openMuscle === el.dataset.m ? null : el.dataset.m; render(); break;
    case 'session': openSession = openSession === el.dataset.id ? null : el.dataset.id; render(); break;
    case 'del-session':
      if (confirm('Delete this workout and the XP it earned?')) {
        state.sessions = state.sessions.filter((s) => s.id !== el.dataset.id);
        state.xpLog = state.xpLog.filter((x) => x.sessionId !== el.dataset.id);
        save(); render();
      }
      break;
    case 'log-weight': logWeight($('#bw-in').value); break;
    case 'del-weight': state.weights = state.weights.filter((w) => w.date !== el.dataset.d); save(); render(); break;
    case 'stop-rest': stopRestTimer(); break;
    case 'export': {
      if (window.AndroidBridge) { AndroidBridge.saveFile(`levelup-backup-${todayStr()}.json`, JSON.stringify(state, null, 2)); break; }
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `levelup-backup-${todayStr()}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'reset': if (confirm('Erase ALL data? This cannot be undone.') && confirm('Really erase everything?')) { state = defaultState(); save(); tab = 'home'; render(); } break;
  }
});

document.addEventListener('input', (ev) => {
  const t = ev.target, d = state.draft;
  if (t.dataset.set && d) {
    const [i, j, k] = t.dataset.set.split(':');
    d.exercises[+i].sets[+j][k] = t.value; save();
  } else if (t.dataset.court && d) {
    const [i, r] = t.dataset.court.split(':').map(Number);
    d.court.stations[i].reps[r] = t.value; save();
  } else if (t.dataset.bind === 'date' && d) {
    d.date = t.value || todayStr(); save();
  }
});

document.addEventListener('change', (ev) => {
  const t = ev.target, d = state.draft;
  if (t.dataset.alt != null && d) {
    const e = d.exercises[+t.dataset.alt];
    e.id = t.value;
    const sug = suggestion(e.id, e.lo, e.hi);
    e.sets.forEach((s) => { if (!s.done) s.w = sug.w; });
    save(); render();
  } else if (t.dataset.station != null && d) {
    d.court.stations[+t.dataset.station].name = t.value; save();
  } else if (t.id === 'import-file' && t.files[0]) {
    const r = new FileReader();
    r.onload = () => {
      try {
        const data = JSON.parse(r.result);
        if (!data.profile || !Array.isArray(data.sessions)) throw new Error('bad');
        state = Object.assign(defaultState(), data); save(); toast('Backup imported'); render();
      } catch (e) { toast('Invalid backup file'); }
    };
    r.readAsText(t.files[0]);
  }
});

// ---------- Boot ----------
render();
if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.AndroidBridge) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
