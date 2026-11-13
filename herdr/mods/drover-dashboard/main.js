// Per-project mission flow. Props: { folder, name, space, mission?, showArchived?, demo? }.
// openOverlay({ mod: "drover-dashboard", kind: "dialog", width: 1120, height: 760,
//   props: { folder, name, space, mission } });
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, props, closeOverlay, run, shared, machines, panes, spaces, notify } from "herdr";
// Show an agent's terminal: focus its pane (switching space/tab first); with no pane, peek it.
function showTerminal(terminal) {
  const pane = panes().find((p) => p.terminal === terminal);
  if (!pane) { run("terminal.peek", { terminal }); return; }
  const space = spaces().find((s) => s.tabs.some((tb) => tb.id === pane.tab));
  const tab = space?.tabs.find((tb) => tb.id === pane.tab);
  if (space && !space.active) run("space.select", { id: space.id });
  if (tab && !tab.active) run("tab.select", { id: tab.id });
  run("pane.focus", { terminal });
}


const POLL_MS = 1500;
// Pasture art is laid out on an AW x AH grid of sprite pixels and drawn at an integer scale (2-4), so pixels stay crisp.
const SPR = "mods/drover-dashboard/sprites/";
const AW = 360, AH = 170, SKY = 24;
const ZONE = { queued: "pen", working: "meadow", changes: "meadow", done: "gate", review: "gate", approved: "past", merged: "barn" };
const ACTIVE = ["queued", "working", "changes", "done", "review"];
const FAMILIES = { anthropic: "anthropic", openai: "openai", cursor: "cursor", github: "github", copilot: "github" };
const BY_AGENT = { claude: "anthropic", codex: "openai", cursor: "cursor", copilot: "github" };
const hash = (s) => { let h = 7; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
// Sprite files carry a 1px transparent margin; the image is drawn one pixel out and clipped to the w x h art box,
// which cuts off the faint lines the renderer leaves along an image's outer edge.
const spr = (name, w, h, sc) => div().relative().w(w * sc).h(h * sc).flex_none().overflow_hidden()
  .child(image(`${SPR}${name}.svg`).absolute().left(-sc).top(-sc).w((w + 2) * sc).h((h + 2) * sc));
// Two-frame flip, run natively: both frames swing their opacity far past 0..1 in opposite phase,
// so each reads as on/off instead of a fade. No redraw timer.
const flip = (a, b, w, h, sc, period = 700) => div().relative().w(w * sc).h(h * sc).flex_none()
  .child(div().absolute().left(0).top(0).loop("opacity", { from: 9, to: -8, period, easing: "linear" }).child(spr(a, w, h, sc)))
  .child(div().absolute().left(0).top(0).loop("opacity", { from: -8, to: 9, period, easing: "linear" }).child(spr(b, w, h, sc)));
// Pasture motion: zone changes trot over TROT ms; walking paths step every STEP_MS.
const TROT = 1600, STEP_MS = 110, LINE = 13;
// Wrap text to lines of at most n chars; past `max` lines the last one ends in an ellipsis.
function wrap(text, n, max = 2) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines = [];
  let cur = "";
  for (let w of words) {
    while (w.length > n) { if (cur) { lines.push(cur); cur = ""; } lines.push(w.slice(0, n)); w = w.slice(n); }
    if (!cur) cur = w; else if (cur.length + 1 + w.length <= n) cur += ` ${w}`; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length > max) { const last = lines[max - 1]; lines.length = max; lines[max - 1] = `${last.length >= n ? last.slice(0, n - 1) : last}…`; }
  return lines;
}
const bubbleW = (lines, chW) => Math.ceil(Math.max(1, ...lines.map((l) => l.length)) * chW) + 14;
const bubbleH = (lines) => lines.length * LINE + 10;
// Overlap area of two rects, each grown by m.
const area = (a, b, m = 0) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) + m - Math.max(a.x, b.x) + m)
  * Math.max(0, Math.min(a.y + a.h, b.y + b.h) + m - Math.max(a.y, b.y) + m);
const rectGap = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
// Loose flock inside rect R: each sheep (in order) takes the best of a few candidates seeded by its id,
// keeping clear of the others (spacing grows when there is room) while drawn to the middle.
// foot(task) -> { w, h, top, inner }: reserved box, sheep sits `top` px down, centred if `inner` < w.
function flock(tasks, R, foot, out) {
  const placed = [], feet = tasks.map(foot);
  const avg = feet.reduce((s, f) => s + f.w * f.h, 0) / Math.max(1, feet.length);
  const want = Math.max(6, Math.min(60, Math.sqrt(R.w * R.h / Math.max(1, tasks.length)) - Math.sqrt(avg)));
  const mx = R.x + R.w / 2, my = R.y + R.h / 2;
  tasks.forEach((task, i) => {
    const f = feet[i];
    let seed = hash(task.id) || 1, best = null, score = -Infinity;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    for (let k = 0; k < 28; k++) {
      const r = { x: R.x + (rnd() + rnd()) / 2 * Math.max(0, R.w - f.w), y: R.y + (rnd() + rnd()) / 2 * Math.max(0, R.h - f.h), w: f.w, h: f.h };
      const gap = placed.reduce((g, q) => Math.min(g, rectGap(r, q)), Infinity);
      const v = Math.min(gap, want) - 0.06 * Math.hypot(r.x + f.w / 2 - mx, r.y + f.h / 2 - my);
      if (v > score) { score = v; best = r; }
    }
    placed.push(best);
    out.set(task.id, { x: Math.round(best.x + (f.w - (f.inner ?? f.w)) / 2), y: Math.round(best.y + (f.top || 0)) });
  });
}
const tag = (text) => div().flex_none().h(13).whitespace_nowrap().px(3).rounded(3).bg("#00000077").text_color("#ffffff").text_size(9).child(text);
const STAGES = ["Queued", "Working", "Review", "Approved", "Merged"];
const STAGE = { queued: 0, working: 1, changes: 1, done: 2, review: 2, approved: 3, merged: 4 };
// Rough list prices in USD per million tokens: [input, output, cache read, cache write]. Shown as "est." only.
const PRICES = {
  anthropic: { opus: [15, 75, 1.5, 18.75], sonnet: [3, 15, 0.3, 3.75], haiku: [0.8, 4, 0.08, 1], _: [3, 15, 0.3, 3.75] },
  openai: { _: [1.25, 10, 0.125, 0] },
  google: { _: [1.25, 10, 0.31, 0] },
  _: { _: [3, 15, 0.3, 3.75] },
};
function estCost(d) {
  let sum = 0, any = false;
  for (const a of d.agents || []) {
    const tk = a.tokens;
    if (!tk) continue;
    const fam = PRICES[String(a.family || "").toLowerCase()] || PRICES._;
    const key = Object.keys(fam).find((k) => k !== "_" && String(a.model || "").toLowerCase().includes(k));
    const [i, o, cr, cw] = fam[key || "_"];
    sum += (count(tk.input) * i + count(tk.output) * o + count(tk.cache_read) * cr + count(tk.cache_write) * cw) / 1e6;
    any = true;
  }
  return any ? sum : null;
}
const FAMILY_ANSI = { anthropic: "ansi3", openai: "ansi2", google: "ansi4", cursor: "ansi5", copilot: "ansi6" };
function famColor(t, a) {
  const fam = String(a?.family || "").toLowerCase();
  const byAgent = { claude: "anthropic", codex: "openai", gemini: "google", cursor: "cursor", copilot: "copilot" }[a?.agent];
  return t[FAMILY_ANSI[fam || byAgent]] || hue(t, a?.agent || a?.family);
}
const KIND = {
  task: { icon: "▣", label: "task" }, review: { icon: "◎", label: "review", tone: "ansi5" },
  verdict: { icon: "⚖", label: "verdict", tone: "ansi5" }, merge: { icon: "⎇", label: "merge", tone: "done" },
  reroute: { icon: "⇄", label: "reroute", tone: "ansi3" }, drop: { icon: "✕", label: "drop", tone: "dim" },
  done: { icon: "✓", label: "done", tone: "done" }, mission: { icon: "⚑", label: "mission" },
  say: { icon: "✉", label: "message" }, message: { icon: "✉", label: "message" }, merged: { icon: "⎇", label: "merge", tone: "done" },
};
const count = (n) => Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
const compact = (n) => n == null ? "—" : count(n) >= 1e6 ? `${(count(n) / 1e6).toFixed(1)}M`
  : count(n) >= 1000 ? `${(count(n) / 1000).toFixed(1)}k` : String(count(n));
const seconds = (at) => typeof at === "number" ? at : Date.parse(at) / 1000;
function duration(n) {
  n = Math.max(0, Math.floor(n || 0));
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.floor(n / 60)}m`;
  if (n < 86400) return `${Math.floor(n / 3600)}h ${Math.floor(n % 3600 / 60)}m`;
  return `${Math.floor(n / 86400)}d ${Math.floor(n % 86400 / 3600)}h`;
}
const ago = (at) => at ? `${duration(Date.now() / 1000 - seconds(at))} ago` : "—";
const tokenTip = (v) => v ? `Tokens · ${compact(v.total)} total\nInput ${compact(v.input)} · output ${compact(v.output)}\nCache read ${compact(v.cache_read)} · cache write ${compact(v.cache_write)}` : "Token usage unknown";
function untilText(until) {
  const d = new Date(until * 1000), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `until ${hm}`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return d.toDateString() === tomorrow.toDateString() ? `until tomorrow ${hm}`
    : `until ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${hm}`;
}
const identity = (a) => a ? `${a.agent || "agent"}@${a.machine || "?"} · ${a.model || "model unknown"}` : "Not assigned";
function hue(t, name) {
  const pool = [t.ansi4, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi1, t.ansi12, t.ansi13];
  let h = 0;
  for (const c of String(name || "drover")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length] ?? t.accent;
}
const color = (t, state) => ({ working: t.working, running: t.working, starting: t.working,
  blocked: t.blocked, changes: t.ansi3, stopped: t.ansi3, done: t.done,
  approved: t.done, merged: t.done, review: t.ansi5, gone: t.dim, idle: t.dim }[state] || t.muted);
function dot(c, pulse = false) {
  return div().w(6).h(6).flex_none().rounded(3).bg(c)
    .when(pulse, (el) => el.loop("opacity", { from: 0.3, to: 1, period: 1400 }));
}
function pill(t, text, c) {
  return div().px(7).py(3).rounded(5).bg(`${c}1a`).text_color(c).text_size(10).font_semibold().child(text);
}
function heading(t, text, detail) {
  return h_flex().items_center().gap(8).mb(10)
    .child(div().flex_1().text_size(10).font_semibold().text_color(t.dim).child(text))
    .children(detail ? [div().text_size(10).text_color(t.dim).child(detail)] : []);
}
function card(t) { return v_flex().rounded(10).bg(t.surface).border(1).border_color(t.border); }

// Sample data shown whenever props.demo is set. Never a production fallback.
const NOW = 1794510099;
const tk = (i, o, cr, cw) => ({ input: i, output: o, cache_read: cr, cache_write: cw, total: i + o + cr + cw });
const SAMPLE = {
  project: "drover", repo: "/demo", generated: NOW,
  missions: [
    { id: "demo-flow", goal: "Give every mission a live command deck with a friendly overview and progress at a glance", state: "running", created: NOW - 5400, updated: NOW, tasks: 7, merged: 2 },
    { id: "demo-old", goal: "Tidy the settings screen", state: "done", created: NOW - 90000, updated: NOW - 80000, tasks: 3, merged: 3 },
  ],
  mission: { id: "demo-flow", goal: "Give every mission a live command deck with a friendly overview and progress at a glance", state: "running", base: "main", created: NOW - 5400, updated: NOW },
  agents: [
    { who: "coordinator", role: "coordinator", task: null, agent: "codex", model: "gpt-5.4", family: "openai", machine: "workstation", status: "working", msg: "Coordinating the dashboard rollout", tokens: tk(40000, 20000, 160000, 10000) },
    { who: "t3", role: "worker", task: "t3", agent: "codex", model: "gpt-5.4", family: "openai", machine: "workstation", status: "working", msg: "Connecting live mission snapshots", tokens: tk(50000, 30000, 120000, 0) },
    { who: "t4", role: "worker", task: "t4", agent: "claude", model: "sonnet", family: "anthropic", machine: "studio", status: "blocked", msg: "Waiting for a test fixture", tokens: tk(20000, 10000, 30000, 0) },
    { who: "review:t5", role: "reviewer", task: "t5", agent: "claude", model: "sonnet", family: "anthropic", machine: "studio", status: "working", msg: "Reading the diff", tokens: tk(20000, 10000, 30000, 0) },
    { who: "t2", role: "worker", task: "t2", agent: "cursor", model: null, family: "cursor", machine: "studio", status: "idle", msg: null, tokens: tk(8000, 2000, 5000, 0) },
    { who: "t10", role: "worker", task: "t10", agent: "claude", model: "haiku", family: "anthropic", machine: "studio", status: "working", msg: "Polishing the barn door animation", address: "d10", tokens: tk(5000, 1000, 2000, 0) },
    { who: "t1", role: "worker", task: "t1", agent: "gemini", model: "gemini-3", family: "google", machine: "workstation", status: "gone", msg: null, tokens: tk(6000, 2000, 4000, 0) },
  ],
  tasks: [
    { id: "t1", title: "Stream mission state from the engine", state: "merged", agent: "gemini", model: "gemini-3", machine: "workstation", rounds: 1, created: NOW - 5000, updated: NOW - 3600, review: { model: "sonnet", family: "anthropic", verdict: "approve" }, tokens: { total: 12000 } },
    { id: "t2", title: "Polish the project rail", state: "merged", agent: "cursor", machine: "studio", rounds: 2, created: NOW - 5000, updated: NOW - 2400, review: { model: "gpt-5.4", family: "openai", verdict: "approve" }, tokens: { total: 15000 } },
    { id: "t3", title: "Redesign the dashboard overview", state: "working", agent: "codex", model: "gpt-5.4", machine: "workstation", rounds: 0, depends_on: ["t1"], created: NOW - 3000, updated: NOW - 20, review: null, tokens: { total: 200000 },
      alternatives: [{ agent: "claude", model: "sonnet", family: "anthropic", used_percent: 41, resets_at: NOW + 9000 }, { agent: "gemini", model: "gemini-3", family: "google", used_percent: 23, resets_at: NOW + 50000 }, { agent: "cursor", model: null, family: "cursor", used_percent: null, resets_at: null }] },
    { id: "t4", title: "Add project entry points", state: "changes", agent: "claude", model: "sonnet", machine: "studio", rounds: 1, depends_on: ["t2"], created: NOW - 2800, updated: NOW - 300, review: { model: "gpt-5.4", family: "openai", verdict: "changes" }, tokens: { total: 60000 } },
    { id: "t5", title: "Animate the mission flow", state: "review", agent: "codex", model: "gpt-5.4", machine: "workstation", rounds: 1, created: NOW - 2000, updated: NOW - 100, review: { model: "sonnet", family: "anthropic", verdict: null }, tokens: { total: 60000 },
      alternatives: [{ agent: "gemini", model: "gemini-3", family: "google", used_percent: 23, resets_at: NOW + 50000 }, { agent: "cursor", model: null, family: "cursor", used_percent: 67, resets_at: NOW + 3600 }] },
    { id: "t6", title: "Document the dashboard", state: "approved", agent: "claude", model: "opus", machine: "studio", rounds: 1, created: NOW - 1800, updated: NOW - 60, review: { model: "gpt-5.4", family: "openai", verdict: "approve" }, tokens: { total: 30000 } },
    { id: "t7", title: "Ship release notes", state: "queued", agent: null, rounds: 0, depends_on: ["t3", "t5"], created: NOW - 1000, updated: NOW - 1000, review: null, tokens: null },
    { id: "t9", title: "Localise the dashboard", state: "queued", agent: null, rounds: 0, depends_on: ["t4"], created: NOW - 900, updated: NOW - 900, review: null, tokens: null },
    { id: "t10", title: "Animate the barn door", state: "working", agent: "claude", model: "haiku", machine: "studio", rounds: 0, created: NOW - 700, updated: NOW - 10, review: null, tokens: { total: 8000 } },
    { id: "t11", title: "Tidy the changelog", state: "merged", agent: "claude", model: "sonnet", machine: "studio", rounds: 1, created: NOW - 4800, updated: NOW - 3000, review: { model: "gpt-5.4", family: "openai", verdict: "approve" }, tokens: { total: 9000 } },
    { id: "t8", title: "Experiment with a 3D view", state: "dropped", reason: "Out of scope for this mission", rounds: 0, created: NOW - 4000, updated: NOW - 3500, tokens: null },
  ],
  capacity: [
    { agent: "codex", name: "Codex", machine: null, until: NOW + 7200, reason: "usage limit reached", since: NOW - 100 },
    { agent: "gemini", name: "Gemini", machine: "studio", until: NOW + 90000, reason: "daily quota used", since: NOW - 4000 },
  ],
  usage: [
    { agent: "claude", machine: null, used_percent: 41, window: "5h", resets_at: NOW + 9000, source: "statusline", read_at: NOW - 30 },
    { agent: "claude", machine: null, used_percent: 78, window: "7d", resets_at: NOW + 200000, source: "statusline", read_at: NOW - 30 },
    { agent: "gemini", machine: null, used_percent: 23, window: "5h", resets_at: NOW + 50000, source: "statusline", read_at: NOW - 30 },
    { agent: "cursor", machine: null, used_percent: 67, window: "5h", resets_at: NOW + 3600, source: "statusline", read_at: NOW - 30 },
    { agent: "codex", machine: null, used_percent: 100, window: "5h", resets_at: NOW + 7200, source: "session log", read_at: NOW - 60 },
  ],
  tokens: { total: 598000, coordinator: 230000, worker: 300000, reviewer: 68000 },
  impediments: [
    { kind: "needs_you", severity: "block", who: "t4", task: "t4", text: "Waiting for a test fixture", since: NOW - 120 },
    { kind: "capacity", severity: "warn", who: "t3", task: "t3", text: "codex is out of capacity until 20:00 (usage limit reached)", since: NOW - 100 },
    { kind: "gone", severity: "block", who: "t1", task: "t1", text: "agent terminal no longer exists", since: NOW - 600 },
  ],
  needs_you: [{ kind: "needs_you", severity: "block", who: "t4", task: "t4", text: "Waiting for a test fixture", since: NOW - 120, action: "hc attach d4" }],
  log: [
    { at: NOW - 5300, kind: "mission", from: "you", to: "coordinator", text: "Mission started" },
    { at: NOW - 5000, kind: "task", from: "coordinator", to: "t1", text: "Assigned t1 to gemini@workstation", task: "t1" },
    { at: NOW - 3700, kind: "merge", from: "coordinator", to: "t1", text: "Stream mission state merged into main", task: "t1" },
    { at: NOW - 3500, kind: "drop", from: "coordinator", to: "t8", text: "Dropped t8: out of scope", task: "t8" },
    { at: NOW - 2000, kind: "reroute", from: "coordinator", to: "t5", text: "cursor ran out; re-routed t5 to codex", task: "t5" },
    { at: NOW - 900, kind: "review", from: "review:t6", to: "coordinator", text: "Reviewing t6", task: "t6" },
    { at: NOW - 400, kind: "verdict", from: "review:t6", to: "coordinator", text: "Approved: docs are clear", task: "t6", verdict: "approve" },
    { at: NOW - 300, kind: "verdict", from: "review:t4", to: "coordinator", text: "Changes requested: add the fixture", task: "t4", verdict: "changes" },
    { at: NOW - 90, kind: "merge", failed: true, from: "coordinator", to: "t2", text: "merge conflict in rail.js", task: "t2" },
    { at: NOW - 30, kind: "say", from: "t3", to: "coordinator", text: "Live snapshots are wired; checking empty missions", task: "t3" },
  ],
};
// Sample data for props.demo (always, never as a fallback). Times are shifted to "now".
// The archived demo mission (or props.demo === "calm") shows a pasture with every sheep home.
function demoData(calm) {
  const d = JSON.parse(JSON.stringify(SAMPLE));
  const shift = Math.floor(Date.now() / 1000) - SAMPLE.generated;
  for (const entry of [d.mission, ...d.missions, ...d.tasks, ...d.log, ...d.impediments, ...d.needs_you, ...d.capacity, ...d.usage]) {
    for (const field of ["created", "updated", "at", "since", "until", "resets_at", "read_at"]) if (entry[field]) entry[field] += shift;
    for (const a of entry.alternatives || []) if (a.resets_at) a.resets_at += shift;
  }
  d.generated += shift;
  if (!calm) return d;
  const old = d.missions[1];
  return { ...d, mission: { ...old, base: "main" }, agents: [], impediments: [], needs_you: [], capacity: [],
    usage: d.usage.filter((u) => u.agent === "claude").map((u) => ({ ...u, used_percent: 12 })),
    tasks: [
      { id: "t1", title: "Tidy the settings screen", state: "merged", agent: "claude", rounds: 1, created: old.created, updated: old.updated },
      { id: "t2", title: "Rename the toggles", state: "merged", agent: "codex", rounds: 1, created: old.created, updated: old.updated },
      { id: "t3", title: "Settings tests", state: "merged", agent: "cursor", rounds: 1, created: old.created, updated: old.updated },
    ], log: d.log.slice(0, 1) };
}


export default class MissionDashboard extends View {
  init(_props, cx) {
    this.data = null;
    this.error = null;
    this.demo = false;
    this.selected = props()?.mission || null;
    this.showArchived = !!props()?.showArchived;
    this.version = 0;
    this.busy = false;
    this.switching = false;
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.history = false; this.picker = false; this.size = null;
    this.cw10 = 60; this.pos = new Map(); this.trot = new Map(); this.trotUntil = 0; this.hovered = null;
    this.load(cx);
    this.panel = null; this.peekLines = []; this.result = null; this.confirmDrop = false; this.acting = false; this.moveOpen = false;
    this.sayInput = InputState.new({ placeholder: "Say something to this agent…" });
    // Demo only: props.panel opens that sheep's panel at start, props.move also opens its "Move to…" picker.
    { const p = props() || {}; if (p.demo && p.panel) { this.panel = p.panel; this.moveOpen = !!p.move; } }
    cx.timer.every(POLL_MS, (cx) => this.load(cx));
    cx.timer.every(2000, (cx) => this.peek(cx));
  }

  select(id, cx) {
    if (this.selected === id) return;
    this.selected = id;
    this.version++;
    this.busy = false;
    this.switching = true;
    this.error = null;
    this.load(cx);
    cx.notify();
  }

  load(cx) {
    if (this.busy) return;
    const p = props() ?? {};
    if (p.demo) {
      const calm = p.demo === "calm" || this.selected === "demo-old";
      // The demo's t10 goes to review and back every 12s, so its sheep can be seen trotting.
      const phase = calm ? 0 : Math.floor(Date.now() / 12000) % 2;
      if (!this.data || this.demoCalm !== calm || this.demoPhase !== phase) {
        const d = demoData(calm);
        if (phase) for (const k of d.tasks) if (k.id === "t10") k.state = "review";
        this.noteMoves(d, cx);
        this.data = d; this.demo = true; this.demoCalm = calm; this.demoPhase = phase; this.switching = false; this.error = null; cx.notify();
      }
      return;
    }
    if (!p.folder) { this.error = "Open this dashboard with a project folder."; cx.notify(); return; }
    const version = ++this.version;
    const args = ["dashboard", "--repo", p.folder, "--json"];
    if (this.showArchived) args.push("--all");
    if (this.selected) args.push("--mission", this.selected);
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", args, { timeout: 10000 });
        if (r.code !== 0) throw new Error(r.stderr?.trim() || `drover exited ${r.code}`);
        const d = JSON.parse(r.stdout);
        if (!d || !["missions", "agents", "tasks", "impediments", "log"].every((k) => Array.isArray(d[k]))
          || !(d.mission === null || typeof d.mission === "object" && d.mission?.id)) throw new Error("Invalid dashboard response");
        if (version !== this.version) return;
        this.noteMoves(d, cx);
        this.data = d;
        this.switching = false;
        this.error = null;
        this.demo = false;
      } catch (e) {
        if (version !== this.version) return;
        this.error = String(e?.message ?? e);
        this.switching = false;
      }
      if (version === this.version) { this.busy = false; cx.notify(); }
    });
  }

  // A task changed state (so a sheep may move): let moved sheep trot for a moment, then redraw once to settle them.
  noteMoves(d, cx) {
    const old = this.data;
    if (!old || old.mission?.id !== d.mission?.id) return;
    const before = new Map(old.tasks.map((k) => [k.id, k.state]));
    if (!d.tasks.some((k) => before.has(k.id) && before.get(k.id) !== k.state)) return;
    this.trotUntil = Date.now() + TROT;
    cx.timer.after(TROT + 120, (cx) => cx.notify());
  }

  // --- sheep side panel: live terminal tail and actions ---
  missionId() { return this.data?.mission?.id || this.selected; }

  openPanel(id, cx) {
    this.panel = id; this.peekLines = []; this.result = null; this.confirmDrop = false; this.moveOpen = false;
    this.sayInput.set_value?.("");
    this.peek(cx);
    cx.notify();
  }

  closePanel(cx) { this.panel = null; this.confirmDrop = false; cx.notify(); }

  peek(cx) {
    const id = this.panel;
    if (!id) return;
    if (this.demo) {
      this.peekLines = ["$ cargo test", "   Compiling drover v0.3.0", "running 12 tests", "test pasture::walks ... ok", "test pasture::sits ... ok", `[demo] sample tail for ${id}`];
      cx.notify();
      return;
    }
    const mission = this.missionId();
    if (!mission) return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", ["peek", id, "--json", "--mission", mission], { timeout: 10000 });
        if (r.code !== 0) throw new Error(r.stderr?.trim() || `drover exited ${r.code}`);
        if (this.panel !== id) return;
        this.peekLines = (JSON.parse(r.stdout).lines || []).slice(-14);
      } catch (e) { if (this.panel === id) this.peekLines = [`(no terminal output: ${String(e?.message ?? e)})`]; }
      cx.notify();
    });
  }

  // Run a drover command for the selected mission and show its result in the panel.
  act(args, cx, done) {
    const mission = this.missionId();
    if (this.acting || !mission) return;
    const full = [...args, "--mission", mission];
    if (this.demo) { this.result = { ok: true, text: `[demo] drover ${full.join(" ")}` }; cx.notify(); return; }
    this.acting = true; this.result = { ok: true, text: "Running…" }; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", full, { timeout: 60000 });
        const out = (r.stdout?.trim() || r.stderr?.trim() || "").split("\n").slice(-4).join("\n");
        this.result = { ok: r.code === 0, text: out || (r.code === 0 ? "Done" : `drover exited ${r.code}`) };
        if (r.code === 0) { done?.(); this.busy = false; this.load(cx); }
      } catch (e) { this.result = { ok: false, text: String(e?.message ?? e) }; }
      this.acting = false; cx.notify();
    });
  }

  // Agents with capacity for a new coordinator, least used first: from the plan usage readings, minus whoever is out.
  coordCands() {
    const out = (this.data.capacity || []).filter((c) => !c.machine).map((c) => c.agent), by = new Map();
    for (const u of this.usageRows()) {
      const p = Number(u.used_percent ?? u.pct), e = by.get(u.agent);
      if (!e || p > e.used_percent) by.set(u.agent, { agent: u.agent, used_percent: p, resets_at: u.resets_at });
    }
    return [...by.values()].filter((a) => !out.includes(a.agent)).sort((a, b) => a.used_percent - b.used_percent);
  }

  replaceCoordinator(agent, cx) {
    this.moveOpen = false;
    const mission = this.missionId();
    if (this.demo) { this.result = { ok: true, text: `[demo] drover coordinator replace --repo ${props()?.folder || "/demo"} --agent ${agent}` }; cx.notify(); return; }
    if (this.acting) return;
    this.acting = true; this.result = { ok: true, text: "Handing over…" }; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", ["coordinator", "replace", "--repo", props().folder, "--agent", agent], { timeout: 60000 });
        const o = (r.stdout?.trim() || r.stderr?.trim() || "").split("\n").slice(-4).join("\n");
        this.result = { ok: r.code === 0, text: o || (r.code === 0 ? "Done" : `drover exited ${r.code}`) };
        if (r.code === 0) { this.busy = false; this.load(cx); }
      } catch (e) { this.result = { ok: false, text: String(e?.message ?? e) }; }
      this.acting = false; cx.notify();
    });
  }

  // Panel for the drover (coordinator): status, live tail and "Replace coordinator…".
  coordPanelView(t) {
    const co = this.data?.agents.find((a) => a.role === "coordinator");
    const sleep = this.coordAsleep();
    const cands = this.coordCands();
    const btn = (id, label, c, fn, disabled) => div().id(`panel-${id}`).px(10).py(5).rounded(6).text_size(11).font_semibold()
      .bg(`${c}22`).text_color(c).border(1).border_color(`${c}55`)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(`${c}44`)).on_click((_e, cx) => fn(cx)))
      .opacity(disabled ? 0.4 : 1).child(label);
    const row = (k, v) => h_flex().gap(8).text_size(11).child(div().w(60).flex_none().text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).whitespace_normal().child(v));
    const terminal = this.terminal(co);
    const wake = sleep && cands.length ? btn("wake", `wake: hand over to ${cands[0].agent}`, t.done, (cx) => this.replaceCoordinator(cands[0].agent, cx)) : null;
    const picker = this.moveOpen && cands.length ? v_flex().id("panel-move").gap(4).p(6).rounded(6).bg(t.background).border(1).border_color(t.border)
      .child(div().text_size(9).font_semibold().text_color(t.dim).child("HAND OVER TO…"))
      .children(cands.map((a, i) => h_flex().id(`move-${i}`).gap(8).items_center().px(8).py(5).rounded(5).cursor_pointer().text_size(11)
        .hover((s) => s.bg(`${t.accent}22`)).on_click((_e, cx) => this.replaceCoordinator(a.agent, cx))
        .child(div().flex_1().min_w(0).font_semibold().child(a.agent))
        .child(div().flex_none().text_size(10).text_color(t.muted).child(this.altUsage(a))))) : null;
    return div().id("sheep-panel").absolute().top(0).right(0).bottom(0).w(380).flex().flex_col()
      .bg(t.surface).border_l(1).border_color(t.border)
      .on_mouse_down_out((_e, cx) => this.closePanel(cx))
      .on_key_down((e, cx) => { if (e.key === "escape") { this.closePanel(cx); cx.stop_propagation(); } })
      .child(v_flex().id("sheep-panel-body").flex_1().min_h(0).p(14).gap(10).overflow_y_scrollbar()
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(14).font_semibold().child("drover · coordinator"))
        .child(div().id("panel-close").px(6).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.closePanel(cx)).child("✕")))
      .child(v_flex().gap(3)
        .child(row("Agent", co ? `${co.agent || "unassigned"}${co.model ? ` / ${co.model}` : ""}` : "not connected"))
        .child(row("Machine", co?.machine || "—"))
        .child(row("Status", `${co?.status || "—"}${sleep ? " · out of capacity" : ""}`)))
      .child(div().text_size(9).font_semibold().text_color(t.dim).child("TERMINAL · refreshes every 2s"))
      .child(v_flex().id("panel-tail").flex_none().h(210).p(8).rounded(6).bg(t.background).border(1).border_color(t.border)
        .overflow_y_scrollbar().text_size(10)
        .children((this.peekLines.length ? this.peekLines : ["…"]).map((l, i) => div().id(`tail-${i}`).whitespace_normal().text_color(t.muted).child(l || " "))))
      .children(wake ? [wake] : [])
      .child(h_flex().gap(6).flex_wrap()
        .child(btn("terminal", "Open terminal", t.accent, () => { closeOverlay(props().overlay); showTerminal(terminal); }, !terminal))
        .child(btn("move", this.moveOpen ? "Replace coordinator… ▴" : "Replace coordinator… ▾", t.ansi5 || t.accent, (cx) => { this.moveOpen = !this.moveOpen; cx.notify(); }, !cands.length)))
      .children(picker ? [picker] : [])
      .children(this.result ? [div().id("panel-result").p(8).rounded(6).whitespace_normal().text_size(10)
        .bg(t.background).text_color(this.result.ok ? t.muted : t.blocked).child(this.result.text)] : []));
  }

  coordAsleep() {
    const co = this.data?.agents.find((a) => a.role === "coordinator");
    return !!co && (this.data.capacity || []).some((c) => c.agent === co.agent && (!c.machine || c.machine === co.machine));
  }

  // Move a task's worker (or, in review, its reviewer) to another agent.
  move(task, alt, cx) {
    this.moveOpen = false;
    this.act(["task", "reroute", task.id, "--agent", alt.agent, ...(alt.model ? ["--model", alt.model] : []), ...(task.state === "review" ? ["--review"] : [])], cx);
  }

  altLabel(a) { return `${a.agent}${a.model ? ` / ${a.model}` : ""}`; }
  altUsage(a) { return `${a.used_percent == null ? "usage unknown" : `${Math.round(a.used_percent)}% used`}${a.resets_at ? ` · resets ${untilText(a.resets_at).replace("until ", "")}` : ""}`; }

  say(to, cx) {
    const text = (this.sayInput.value() ?? "").trim();
    if (!text) return;
    this.act(["say", to, text], cx, () => this.sayInput.set_value?.(""));
  }

  panelView(t) {
    if (this.panel === "coordinator") return this.coordPanelView(t);
    const task = this.data?.tasks.find((x) => x.id === this.panel);
    if (!task) return null;
    const worker = this.data.agents.find((a) => a.task === task.id && a.role === "worker");
    const st = this.sheepStatus(task, worker);
    const terminal = this.terminal(worker);
    const btn = (id, label, c, fn, disabled) => div().id(`panel-${id}`).px(10).py(5).rounded(6).text_size(11).font_semibold()
      .bg(`${c}22`).text_color(c).border(1).border_color(`${c}55`)
      .when(!disabled, (el) => el.cursor_pointer().hover((s) => s.bg(`${c}44`)).on_click((_e, cx) => fn(cx)))
      .opacity(disabled ? 0.4 : 1).child(label);
    const row = (k, v) => h_flex().gap(8).text_size(11).child(div().w(60).flex_none().text_color(t.dim).child(k))
      .child(div().flex_1().min_w(0).whitespace_normal().child(v));
    const buttons = [btn("terminal", "Open terminal", t.accent, () => { closeOverlay(props().overlay); showTerminal(terminal); }, !terminal)];
    if (task.state === "done") buttons.push(btn("review", "Review", t.ansi5 || t.accent, (cx) => this.act(["task", "review", task.id], cx)));
    if (task.state === "approved") buttons.push(btn("merge", "Merge", t.done, (cx) => this.act(["task", "merge", task.id], cx)));
    if (!["merged", "dropped"].includes(task.state)) buttons.push(this.confirmDrop
      ? btn("drop-confirm", "Confirm drop", t.blocked, (cx) => this.act(["task", "drop", task.id, "dropped from dashboard"], cx, () => { this.confirmDrop = false; }))
      : btn("drop", "Drop", t.blocked, (cx) => { this.confirmDrop = true; cx.notify(); }));
    const alts = task.alternatives || [];
    if (alts.length) buttons.push(btn("move", this.moveOpen ? "Move to… ▴" : "Move to… ▾", t.ansi5 || t.accent, (cx) => { this.moveOpen = !this.moveOpen; cx.notify(); }));
    const wake = st === "sleep" && alts.length ? btn("wake", `wake: move to ${this.altLabel(alts[0])}`, t.done, (cx) => this.move(task, alts[0], cx)) : null;
    const picker = this.moveOpen && alts.length ? v_flex().id("panel-move").gap(4).p(6).rounded(6).bg(t.background).border(1).border_color(t.border)
      .child(div().text_size(9).font_semibold().text_color(t.dim).child(task.state === "review" ? "MOVE REVIEWER TO…" : "MOVE TO…"))
      .children(alts.map((a, i) => h_flex().id(`move-${i}`).gap(8).items_center().px(8).py(5).rounded(5).cursor_pointer().text_size(11)
        .hover((s) => s.bg(`${t.accent}22`)).on_click((_e, cx) => this.move(task, a, cx))
        .child(div().flex_1().min_w(0).font_semibold().child(this.altLabel(a)))
        .child(div().flex_none().text_size(10).text_color(t.muted).child(this.altUsage(a))))) : null;
    return div().id("sheep-panel").absolute().top(0).right(0).bottom(0).w(380).flex().flex_col()
      .bg(t.surface).border_l(1).border_color(t.border)
      .on_mouse_down_out((_e, cx) => this.closePanel(cx))
      .on_key_down((e, cx) => { if (e.key === "escape") { this.closePanel(cx); cx.stop_propagation(); } })
      .child(v_flex().id("sheep-panel-body").flex_1().min_h(0).p(14).gap(10).overflow_y_scrollbar()
      .child(h_flex().gap(8).items_center()
        .child(div().flex_1().min_w(0).text_size(14).font_semibold().whitespace_normal().child(`${task.id} · ${task.title || ""}`))
        .child(div().id("panel-close").px(6).cursor_pointer().text_color(t.muted).on_click((_e, cx) => this.closePanel(cx)).child("✕")))
      .child(v_flex().gap(3)
        .child(row("Agent", `${task.agent || "unassigned"}${task.model ? ` / ${task.model}` : ""}`))
        .child(row("Machine", task.machine || worker?.machine || "—"))
        .child(row("State", `${task.state}${st === "alert" ? " · needs attention" : st === "sleep" ? " · out of capacity" : st === "gone" ? " · gone" : ""}`))
        .child(row("Age", duration(Date.now() / 1000 - seconds(task.created))))
        .child(row("Tokens", compact(task.tokens?.total))))
      .child(div().text_size(9).font_semibold().text_color(t.dim).child("TERMINAL · refreshes every 2s"))
      .child(v_flex().id("panel-tail").flex_none().h(210).p(8).rounded(6).bg(t.background).border(1).border_color(t.border)
        .overflow_y_scrollbar().text_size(10)
        .children((this.peekLines.length ? this.peekLines : ["…"]).map((l, i) => div().id(`tail-${i}`).whitespace_normal().text_color(t.muted).child(l || " "))))
      .children(wake ? [wake] : [])
      .child(h_flex().gap(6).flex_wrap().children(buttons))
      .children(picker ? [picker] : [])
      .child(h_flex().gap(6).items_center()
        .child(Input.new(this.sayInput).flex_1().min_w(0).h(30).px(8).border(1).border_color(t.input).bg(t.background).text_size(11).text_color(t.foreground))
        .child(btn("say", "Say", t.accent, (cx) => this.say(task.id, cx))))
      .children(this.result ? [div().id("panel-result").p(8).rounded(6).whitespace_normal().text_size(10)
        .bg(t.background).text_color(this.result.ok ? t.muted : t.blocked).child(this.result.text)] : []));
  }

  // One-click actions for what only the person can clear.
  needsYou(t) {
    const rows = this.data?.needs_you || [];
    if (!rows.length) return null;
    const c = t.blocked;
    return v_flex().id("needs-you").flex_none().gap(4).px(10).py(6).rounded(8).bg(`${c}12`).border(1).border_color(`${c}66`)
      .child(div().text_size(11).font_semibold().text_color(c).child(`NEEDS YOU · ${rows.length}`))
      .children(rows.map((r, i) => {
        const a = this.data.agents.find((a) => a.who === r.who);
        const merge = r.kind === "merge_failed" && r.task;
        const term = this.terminal(a);
        const go = merge || term;
        return h_flex().id(`needs-${r.who}-${i}`).gap(8).items_center()
          .child(div().w(54).flex_none().text_size(11).font_semibold().child(r.who))
          .child(div().flex_1().min_w(0).text_size(11).text_color(t.muted).truncate().tooltip(r.text || "").child(r.text))
          .children(go ? [div().id(`needs-act-${i}`).flex_none().px(8).py(3).rounded(5).cursor_pointer().bg(`${c}22`)
            .text_size(10).font_semibold().text_color(c).hover((s) => s.bg(`${c}44`))
            .on_click((_e, cx) => merge ? (this.openPanel(r.task, cx), this.act(["task", "merge", r.task], cx))
              : (closeOverlay(props().overlay), showTerminal(term)))
            .tooltip(r.action || "")
            .child(merge ? "Retry merge" : "Open terminal →")] : []);
      }));
  }

  toggleArchived(cx) {
    this.showArchived = !this.showArchived;
    this.selected = null;
    this.version++;
    this.busy = false;
    this.switching = true;
    this.load(cx);
    cx.notify();
  }

  archive(cx) {
    const id = this.data?.mission?.id;
    if (!id || this.demo || this.archiving) return;
    this.archiving = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", ["mission", "archive", id, "--json"]);
        if (r.code !== 0) throw new Error(r.stderr?.trim() || "Could not archive mission");
        this.selected = null;
        this.version++;
        this.busy = false;
        this.load(cx);
      } catch (e) { this.error = String(e?.message ?? e); }
      this.archiving = false;
      cx.notify();
    });
  }

  terminal(a) {
    if (!a?.address || a.status === "gone" || this.demo) return null;
    // Engine addresses are normally already qualified. For bare IDs, only
    // qualify a known remote machine; local machine names still use bare IDs.
    if (a.address.includes("/")) return a.address;
    const local = shared("drover.status")?.local;
    const remote = a.machine && (local ? a.machine !== local : machines().some((m) => m.name === a.machine));
    return remote ? `${a.machine}/${a.address}` : a.address;
  }

  agentTip(a) {
    if (a?.status === "gone") return `Terminal ${a.address || a.who || ""} is gone`;
    const address = this.terminal(a);
    return address ? `Show ${address}'s terminal (${a.agent || "agent"} on ${a.machine || address.split("/").slice(0, -1).join("/") || "this machine"})`
      : this.demo ? "Demo agent · no terminal" : "No terminal assigned";
  }

  agentLink(el, t, a, detail = "") {
    return el.tooltip([this.agentTip(a), detail].filter(Boolean).join("\n")).when(!!this.terminal(a), (el) => el
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => {
        const terminal = this.terminal(a);
        if (!terminal) return;
        closeOverlay(props().overlay);
        showTerminal(terminal);
      }));
  }

  // --- header: one row with logo, project, mission picker, progress, elapsed and est. cost ---
  header(t, p) {
    const d = this.data, m = d?.mission;
    return h_flex().flex_none().h(54).px(16).gap(12).items_center().border_b(1).border_color(t.border)
      .child(div().w(30).h(30).flex_none().rounded(8).bg(t.accent).flex().items_center().justify_center()
        .child(svg("mods/drover-rail/drover.svg").size(20).text_color(t.accent_foreground)))
      .child(div().flex_none().text_size(15).font_semibold().child(p.name || d?.project || "Project"))
      .child(div().flex_none().tooltip(this.demo ? "Sample mission · demo mode" : this.error ? `${this.error}\nRetrying every ${POLL_MS / 1000}s`
        : `Live · refreshes every ${POLL_MS / 1000}s${d ? `\nUpdated ${ago(d.generated)}` : ""}`)
        .child(dot(this.error && !this.demo ? t.ansi3 || t.accent : t.ansi2 || t.done, !!d && this.live())))
      .child(this.pickerButton(t))
      .children(this.demo ? [pill(t, "DEMO", t.ansi3 || t.accent)] : [])
      .children(this.switching ? [div().flex_none().text_size(10).text_color(t.muted).child("Loading…")] : [])
      .child(div().flex_1())
      .children(m ? [this.progress(t)] : [])
      .children(m && ["done", "stopped"].includes(m.state) && !m.archived && !this.demo ? [
        div().id("archive-mission").flex_none().px(9).py(5).rounded(6).cursor_pointer().text_size(11).text_color(t.muted)
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.archive(cx))
          .child(this.archiving ? "Archiving…" : "Archive")] : [])
      .child(div().id("close").w(28).h(28).flex_none().rounded(7).flex().items_center().justify_center().cursor_pointer()
        .tooltip("Close (Esc)").hover((s) => s.bg(t.hover)).on_click(() => closeOverlay(props().overlay))
        .child(svg("mods/workspace-chrome/x.svg").size(15).text_color(t.muted)));
  }

  pickerButton(t) {
    const d = this.data, m = d?.mission;
    if (!d) return div().min_w(0).text_size(12).text_color(t.muted).child(this.error ? "Dashboard unavailable" : "Loading mission…");
    return h_flex().id("mission-picker").flex_1().min_w(0).max_w(420).gap(7).items_center().px(9).py(5).rounded(7)
      .border(1).border_color(this.picker ? t.accent : t.border).bg(t.surface).cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(m ? `${m.id} · ${m.state}\n${m.goal || ""}${m.summary ? `\n${m.summary}` : ""}` : "Pick a mission")
      .on_click((_e, cx) => { if (Date.now() - (this.pickerClosed || 0) > 250) this.picker = !this.picker; cx.notify(); })
      .child(m ? dot(color(t, m.state), m.state === "running") : dot(t.dim))
      .child(div().flex_1().min_w(0).text_size(12).truncate().child(m ? m.goal || m.id : d.missions.length ? "Pick a mission" : "No missions yet"))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(`${d.missions.length} ▾`));
  }

  pickerMenu(t) {
    const d = this.data, current = this.selected || d.mission?.id;
    const close = (cx) => { this.picker = false; this.pickerClosed = Date.now(); cx.notify(); };
    return div().id("mission-menu").absolute().top(48).left(160).w(480).rounded(10)
      .bg(t.surface).border(1).border_color(t.border).shadow_md()
      .on_mouse_down_out((_e, cx) => close(cx))
      .child(v_flex().id("mission-menu-list").max_h(440).p(6).gap(2).overflow_y_scrollbar()
      .child(div().id("show-archived").flex_none().px(8).py(6).rounded(6).cursor_pointer()
        .text_size(11).text_color(this.showArchived ? t.accent : t.dim).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { close(cx); this.toggleArchived(cx); }).child(`${this.showArchived ? "☑" : "☐"} Show archived`))
      .children(d.missions.map((m) => h_flex().id(`mission-${m.id}`).flex_none().gap(8).items_center().px(8).py(6).rounded(6)
        .cursor_pointer().bg(m.id === current ? `${t.accent}1c` : t.surface).hover((s) => s.bg(t.hover))
        .tooltip(`${m.id}\n${m.goal}\n${m.state}${m.archived ? " · archived" : ""} · ${count(m.merged)}/${count(m.tasks)} merged${m.summary ? `\n${m.summary}` : ""}`)
        .on_click((_e, cx) => { close(cx); this.select(m.id, cx); })
        .child(m.state === "done" ? div().w(10).text_size(11).text_color(t.done).child("✓") : dot(color(t, m.state)))
        .child(div().flex_1().min_w(0).text_size(12).truncate().child(m.goal || m.id))
        .child(div().flex_none().text_size(10).text_color(t.dim).child(`${count(m.merged)}/${count(m.tasks)}`)))));
  }

  progress(t) {
    const d = this.data, m = d.mission;
    const tasks = d.tasks.filter((x) => x.state !== "dropped");
    const total = tasks.length;
    const n = (f) => tasks.filter(f).length;
    const segs = [
      [n((x) => x.state === "merged"), t.done, "merged"],
      [n((x) => x.state === "approved"), t.ansi2 || t.done, "approved"],
      [n((x) => ["review", "done"].includes(x.state)), t.ansi5 || t.accent, "in review"],
      [n((x) => ["working", "changes"].includes(x.state)), t.working, "working"],
      [n((x) => x.state === "queued"), t.dim, "queued"],
    ];
    const end = ["done", "stopped"].includes(m.state) ? seconds(m.updated) : Date.now() / 1000;
    const cost = estCost(d);
    return h_flex().flex_none().gap(14).items_center().text_size(11).text_color(t.muted)
      .child(h_flex().id("progress").gap(7).items_center().tooltip(segs.filter(([c]) => c).map(([c, , l]) => `${c} ${l}`).join(" · ") || "No tasks yet")
        .child(h_flex().w(110).h(6).rounded(3).bg(t.border).overflow_hidden()
          .children(segs.filter(([c]) => c).map(([c, col, l]) => div().id(`seg-${l}`).h(6).bg(col)
            .w(`${100 * c / Math.max(1, total)}%`).transition("width", { duration: 700, easing: "ease-out" }))))
        .child(div().font_semibold().text_color(t.foreground).child(`${segs[0][0]}/${total}`)))
      .child(div().id("elapsed").tooltip(`Elapsed · mission ${m.id}\nBase ${m.base || "—"}`).child(duration(end - seconds(m.created))))
      .child(div().id("cost").tooltip(`Estimate only: list prices per model family applied to input, output and cache tokens of live agents. Not a bill.\nTokens ${compact(d.tokens?.total)} · coordinator ${compact(d.tokens?.coordinator)} · workers ${compact(d.tokens?.worker)} · reviewers ${compact(d.tokens?.reviewer)}`)
        .child(cost == null ? "est. —" : `~$${cost.toFixed(2)} est.`));
  }

  copy(text, cx) {
    cx.spawn(async () => {
      try { await exec("sh", ["-c", 'printf %s "$1" | wl-copy', "_", text]); notify?.(`Copied: ${text}`); } catch { /* clipboard unavailable */ }
    });
  }

  live() { return !this.error || this.demo; }

  clearOut(agent, cx) {
    if (this.demo) return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", ["agent", "clear", agent]);
        if (r.code !== 0) throw new Error(r.stderr?.trim() || "Could not clear agent");
        this.busy = false;
        this.load(cx);
      } catch (e) { this.error = String(e?.message ?? e); cx.notify(); }
    });
  }

  // Plan usage readings (top-level data.usage, else the older capacity[].usage).
  usageRows() {
    const d = this.data;
    if (Array.isArray(d.usage)) return d.usage.filter((u) => u && Number.isFinite(Number(u.used_percent ?? u.pct)));
    return (d.capacity || []).flatMap((r) => (Array.isArray(r.usage) ? r.usage : []).map((u) => ({ agent: r.agent, machine: r.machine, ...u })))
      .filter((u) => Number.isFinite(Number(u.used_percent ?? u.pct)));
  }

  // --- in-scene HUD in the sky: tiny pixel usage meters per agent, and who is asleep (out of capacity) ---
  hud() {
    const d = this.data, out = d.capacity || [];
    const outSet = new Set(out.map((r) => r.agent));
    const chip = (id, tip) => h_flex().id(id).flex_none().gap(5).items_center().h(20).px(6).rounded(4)
      .bg("#ffffffd9").text_color("#25303a").text_size(10).tooltip(tip);
    const groups = new Map();
    for (const u of this.usageRows()) {
      const k = `${u.agent}${u.machine ? `@${u.machine}` : ""}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(u);
    }
    const items = [];
    for (const [k, list] of groups) {
      const kids = [div().font_semibold().child(k)];
      for (const u of list) {
        const pct = Math.max(0, Math.min(100, Number(u.used_percent ?? u.pct)));
        const c = pct >= 90 || outSet.has(u.agent) ? "#d64545" : pct >= 70 ? "#c98a12" : "#3f9a4a";
        const lit = Math.round(pct / 10);
        kids.push(div().text_color("#5b6670").child(u.window || ""),
          h_flex().gap(1).items_center().children(Array.from({ length: 10 }, (_, i) => div().w(3).h(8).bg(i < lit ? c : "#25303a2e"))),
          div().font_semibold().text_color(c).child(`${Math.round(pct)}%`));
      }
      const reset = list.map((u) => u.resets_at).filter(Boolean).sort((a, b) => a - b)[0];
      if (reset) kids.push(div().text_color("#5b6670").child(`resets ${untilText(reset).replace("until ", "")}`));
      items.push(chip(`usage-${k}`, list.map((u) => `${k} · ${u.window || "usage"} window · ${Math.round(Number(u.used_percent ?? u.pct))}% used${u.resets_at ? ` · resets ${untilText(u.resets_at).replace("until ", "")}` : ""}${u.source ? ` · ${u.source}` : ""}${u.read_at ? ` · read ${ago(u.read_at)}` : ""}`).join("\n")).children(kids));
    }
    for (const r of out) {
      items.push(chip(`out-${r.agent}-${r.machine || ""}`, `${r.name || r.agent}${r.machine ? ` on ${r.machine}` : ""} is out of capacity\n${r.reason || ""}\nSince ${ago(r.since)}${this.demo ? "" : `\nClick to clear (drover agent clear ${r.agent})`}`)
        .child(div().loop("opacity", { from: 0.35, to: 1, period: 1800 }).child(spr("zzz", 8, 8, 2)))
        .child(div().font_semibold().child(r.name || r.agent))
        .child(div().text_color("#5b6670").child(untilText(r.until)))
        .when(!this.demo, (el) => el.cursor_pointer().on_click((_e, cx) => this.clearOut(r.agent, cx))));
    }
    return items;
  }

  agentTokens(t, a) {
    return div().text_size(10).text_color(t.dim).tooltip(tokenTip(a?.tokens)).child(`${compact(a?.tokens?.total)} tok`);
  }

  // --- task board ---
  stageTrack(t, task, worker, reviewer, blocked) {
    const stage = STAGE[task.state] ?? 1;
    const moving = !blocked && this.live() && (stage === 1 ? worker : stage === 2 ? reviewer : null)?.status === "working";
    const nodes = [];
    STAGES.forEach((label, i) => {
      if (i) nodes.push(div().id(`${task.id}-link-${i}`).relative().h(2).flex_1().min_w(8)
        .bg(i <= stage ? t.accent : t.border)
        .children(moving && i === stage ? [div().absolute().top(-2).left(0).w(6).h(6).rounded(3).bg(t.accent)
          .loop("left", { from: 0, to: 24, period: 1400, easing: "linear" })] : []));
      const complete = i < stage || (task.state === "merged" && i === 4);
      const current = i === stage && !complete;
      const c = current && blocked ? t.blocked : complete || current ? t.accent : t.dim;
      nodes.push(v_flex().id(`${task.id}-stage-${i}`).flex_none().items_center().gap(3).w(54).tooltip(label)
        .child(div().w(18).h(18).rounded(9).flex().items_center().justify_center()
          .bg(complete ? t.accent : current ? `${c}33` : t.background).border(1).border_color(c)
          .when(current, (el) => el.loop("opacity", { from: 0.55, to: 1, period: 1400 }))
          .child(complete ? div().text_size(10).text_color(t.accent_foreground).child("✓") : dot(c)))
        .child(div().text_size(9).text_color(current ? t.foreground : t.dim).font_semibold().child(label)));
    });
    return h_flex().items_center().px(4).children(nodes);
  }

  lane(t, task) {
    if (task.state === "dropped") return card(t).id(`lane-${task.id}`).flex_none().p(12).gap(5).opacity(0.5)
      .tooltip(task.reason || "Dropped")
      .child(h_flex().gap(8).items_center()
        .child(div().text_size(10).text_color(t.dim).child(`${task.id} ✕`))
        .child(div().flex_1().min_w(0).text_size(12).truncate().child(task.title))
        .child(pill(t, "dropped", t.dim)))
      .child(div().text_size(11).text_color(t.muted).truncate().child(task.reason || "Dropped by the coordinator"));
    const worker = this.data.agents.find((a) => a.task === task.id && a.role === "worker");
    const reviewers = this.data.agents.filter((a) => a.task === task.id && a.role === "reviewer");
    const reviewer = reviewers[reviewers.length - 1];
    const blocked = [worker, reviewer].some((a) => a?.status === "blocked")
      || this.data.impediments.some((r) => r.task === task.id && r.severity === "block");
    const fam = famColor(t, { family: worker?.family, agent: task.agent });
    const c = color(t, task.state);
    const waits = (task.depends_on || []).map((id) => this.data.tasks.find((x) => x.id === id) || { id, state: "queued" })
      .filter((x) => x.state !== "merged");
    const started = task.created, since = task.updated || task.created;
    const review = task.review;
    return card(t).id(`lane-${task.id}`).flex_none().p(12).gap(9)
      .border_color(blocked ? t.blocked : t.border)
      .child(h_flex().gap(9).items_center()
        .child(div().id(`avatar-${task.id}`).relative().w(32).h(32).rounded(9).flex_none().flex().items_center().justify_center()
          .bg(`${fam}26`).text_color(fam).text_size(11).font_semibold()
          .when(!!this.terminal(worker), (el) => this.agentLink(el, t, worker, `${worker?.msg || ""}`))
          .child((task.agent || task.id).slice(0, 2).toUpperCase()))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(6).items_center()
            .child(div().text_size(10).text_color(t.dim).child(task.id))
            .child(div().flex_1().min_w(0).text_size(12).font_semibold().truncate().tooltip(task.title || "").child(task.title)))
          .child(div().text_size(10).text_color(t.muted).truncate().tooltip(identity(worker || task))
            .child(`${task.agent || "unassigned"}${task.model ? ` · ${task.model}` : ""}${task.machine ? ` @ ${task.machine}` : ""}`)))
        .child(pill(t, task.state, c)))
      .children(task.state === "queued" || waits.length ? [h_flex().gap(6).items_center().px(8).py(4).rounded(6)
        .bg(t.background).child(div().text_size(11).text_color(t.accent).child("↳"))
        .child(div().text_size(10).text_color(t.muted).whitespace_normal().child(waits.length
          ? `waits for ${waits.map((x) => `${x.id} (${x.state})`).join(", ")}` : "queued · starts when a slot is free"))] : [])
      .child(this.stageTrack(t, task, worker, reviewer, blocked))
      .child(h_flex().gap(10).items_center().text_size(10).text_color(t.dim).flex_wrap()
        .child(div().tooltip(review ? `${review.family || "?"} / ${review.model || "?"} · ${review.verdict || "pending"}` : "No review yet")
          .child(`↻ ${task.rounds || 0} review round${task.rounds === 1 ? "" : "s"}`))
        .children(review?.verdict ? [div().text_color(review.verdict === "approve" ? t.done : t.ansi3).child(review.verdict)] : [])
        .child(div().flex_1())
        .child(this.agentTokens(t, task))
        .child(div().tooltip(`Created ${ago(started)}`).child(task.state === "merged" ? `took ${duration(seconds(since) - seconds(started))}` : `age ${duration(Date.now() / 1000 - seconds(started))}`)))
      .children(blocked ? [div().text_size(10).text_color(t.blocked).child("● blocked, see the panel above")] : []);
  }

  board(t) {
    const d = this.data;
    return v_flex().flex_1().min_w(0).min_h(0).gap(8)
      .child(heading(t, "TASK BOARD", `${d.tasks.filter((x) => x.state === "merged").length}/${d.tasks.length} merged`))
      .child(v_flex().id("mission-flow").flex_1().min_h(0).overflow_y_scrollbar().gap(9)
        .children(d.tasks.length ? d.tasks.map((task) => this.lane(t, task))
          : [card(t).p(22).gap(6).child(div().text_size(13).font_semibold().child("No tasks yet"))
            .child(div().text_size(12).text_color(t.muted).whitespace_normal()
              .child("The coordinator is still planning. Tasks show up here as soon as it splits the goal. Nothing to do, unless the coordinator is blocked above."))]));
  }

  // --- activity timeline ---
  timeline(t) {
    const entries = this.data.log.slice(-40).reverse();
    const group = (e) => { const s = Date.now() / 1000 - seconds(e.at); return s < 600 ? "Just now" : s < 3600 ? "Last hour" : s < 86400 ? "Today" : "Earlier"; };
    const out = [];
    let last = null;
    entries.forEach((e, i) => {
      const g = group(e);
      if (g !== last) { out.push(div().id(`grp-${g}`).flex_none().pt(i ? 6 : 0).text_size(9).font_semibold().text_color(t.dim).child(g.toUpperCase())); last = g; }
      const k = KIND[e.kind] || { icon: "•", label: e.kind || "event" };
      const c = e.failed ? t.blocked : k.tone ? (t[k.tone] || t.accent) : e.kind === "verdict" && e.verdict === "approve" ? t.done : t.accent;
      out.push(h_flex().id(`log-${e.at}-${i}`).flex_none().gap(8).items_start()
        .child(div().w(22).h(22).flex_none().rounded(11).flex().items_center().justify_center().bg(`${c}22`)
          .text_size(11).text_color(c).child(k.icon))
        .child(v_flex().flex_1().min_w(0).gap(1)
          .child(h_flex().gap(5).text_size(10).items_center()
            .child(div().font_semibold().text_color(c).child(k.label))
            .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child([e.task, e.from].filter(Boolean).join(" · ")))
            .child(div().text_color(t.dim).child(ago(e.at))))
          .child(div().text_size(11).text_color(t.muted).whitespace_normal().tooltip(`${e.from || "system"} → ${e.to || "mission"}`).child(e.text || e.kind || "Event"))));
    });
    return v_flex().w(300).flex_none().min_h(0).gap(8)
      .child(heading(t, "ACTIVITY", "newest first"))
      .child(card(t).flex_1().min_h(0).p(12)
        .child(v_flex().id("recent-log").flex_1().min_h(0).overflow_y_scrollbar().gap(9)
          .children(out.length ? out : [div().text_size(11).text_color(t.dim).whitespace_normal()
            .child("Nothing has happened yet. Assignments, reviews and merges will be listed here.")])));
  }

  // --- pasture scene: what is happening right now ---
  clickable(el, a, tip) {
    return el.tooltip(tip).when(!!this.terminal(a), (el) => el.cursor_pointer().on_click(() => {
      const terminal = this.terminal(a);
      if (!terminal) return;
      closeOverlay(props().overlay);
      showTerminal(terminal);
    }));
  }

  famKey(a, agent) {
    const fam = String(a?.family || "").toLowerCase();
    return FAMILIES[fam] || BY_AGENT[String(agent || a?.agent || "").toLowerCase()] || "other";
  }

  // walk / sit / sleep / alert / gone for a task's sheep.
  sheepStatus(task, worker) {
    const d = this.data;
    if (worker?.status === "gone") return "gone";
    if (!["working", "changes", "done", "review"].includes(task.state)) return "sit";
    const agent = worker?.agent || task.agent, machine = worker?.machine || task.machine;
    if (d.impediments.some((r) => (r.task === task.id || r.who === task.id) && r.kind === "gone")) return "gone";
    if (worker?.status === "blocked" || d.impediments.some((r) => (r.task === task.id || r.who === task.id)
      && !["capacity", "changes", "stopped"].includes(r.kind))) return "alert";
    if ((d.capacity || []).some((c) => c.agent === agent && (!c.machine || c.machine === machine))) return "sleep";
    return worker?.status === "working" && task.state !== "done" && task.state !== "review" ? "walk" : "sit";
  }

  // Status text for a sheep's speech bubble ("" for none).
  sheepMsg(task, worker, st) {
    return st === "sleep" ? "zzz… out of capacity" : st === "gone" ? "terminal gone"
      : worker?.msg || (st === "alert" ? "needs you!" : task.state === "review" ? "being reviewed" : task.state === "done" ? "ready for review" : "");
  }

  // One sheep with its top-left at (x, y). Working sheep walk a short path and graze at either end,
  // keyframed natively with `frames`; a sheep that changes spot trots there through `transition`.
  // o: { sc, tag, after, path (art px), trot ("r"/"l") }
  sheep(t, task, x, y, o) {
    const worker = this.data.agents.find((a) => a.task === task.id && a.role === "worker");
    const st = this.sheepStatus(task, worker);
    const fam = this.famKey(worker, task.agent), sc = o.sc, sz = 16 * sc, h = hash(task.id);
    const name = (pose, dir) => `sheep-${fam}-${pose}${dir === "l" ? "-l" : ""}`;
    const face = (h >> 2) % 3 === 0 ? "l" : "r";
    const age = duration(Date.now() / 1000 - seconds(task.updated || task.created));
    const note = st === "sleep" ? "out of capacity" : st === "alert" ? "needs attention" : st === "gone" ? "gone" : "";
    const tip = [`${task.id} · ${task.title || ""}`, `${task.agent || "unassigned"}${task.model ? ` / ${task.model}` : ""}`,
      `machine ${task.machine || worker?.machine || "—"}`, `${task.state}${note ? ` · ${note}` : ""} · ${age}`,
      "Click for details and actions"].filter(Boolean).join("\n");
    const box = () => div().relative().w(sz).h(sz).flex_none();
    let body, spacer = null;
    if (o.trot) body = box().child(flip(name("walk1", o.trot), name("walk2", o.trot), 16, 16, sc, 260));
    else if (st === "walk" && o.path) {
      // Walk right, graze (looking up now and then), walk back left, graze. Rotated per sheep so the flock is out of step.
      const n = o.path, g = 10 + (h >> 4) % 9, seq = [];
      const leg = (i) => Math.floor(i / 2) % 2 ? "walk2" : "walk1";
      const graze = (i) => i >= (g >> 1) && i < (g >> 1) + 3 ? "walk1" : "graze";
      for (let i = 0; i < n; i++) seq.push([i + 1, leg(i), "r"]);
      for (let i = 0; i < g; i++) seq.push([n, graze(i), "r"]);
      for (let i = 0; i < n; i++) seq.push([n - 1 - i, leg(i), "l"]);
      for (let i = 0; i < g; i++) seq.push([0, graze(i), "l"]);
      const r = h % seq.length, frames = [...seq.slice(r), ...seq.slice(0, r)];
      const ts = (sc * 100) / this.cw10; // text size at which one "M" is one art pixel wide
      const text = (list) => div().flex_none().h(sz).overflow_hidden().text_size(ts).text_color("#00000000").whitespace_nowrap().frames(list, STEP_MS);
      spacer = text(frames.map(([px]) => "M".repeat(px)));
      const HID = "M".repeat(24);
      const variants = [...new Set(frames.map(([, pose, dir]) => `${pose}|${dir}`))];
      body = box().children(variants.map((v) => {
        const [pose, dir] = v.split("|");
        return div().absolute().left(0).top(0).w(sz).h(sz).overflow_hidden()
          .child(h_flex().absolute().left(0).top(0).w(sz * 3).h(sz).items_start()
            .child(text(frames.map(([, p, d]) => `${p}|${d}` === v ? "" : HID)))
            .child(spr(name(pose, dir), 16, 16, sc)));
      }));
    } else {
      const pose = st === "gone" || st === "walk" ? "sit" : st;
      body = box().child(div().absolute().left(0).top(0)
        .when(st === "alert", (el) => el.loop("top", { from: 0, to: -3 * sc, period: 560, easing: "ease-out" }))
        .child(spr(name(pose, face), 16, 16, sc))
        .children(st === "alert" ? [div().absolute().left(face === "l" ? 15 * sc : -7 * sc).top(3 * sc)
          .child(spr("bubble-alert", 8, 8, sc))] : []))
        .children(st === "sleep" ? [div().absolute().right(face === "l" ? 15 * sc : -7 * sc).top(-sc)
          .loop("opacity", { from: 0.25, to: 1, period: 1800 }).child(spr("zzz", 8, 8, sc))] : []);
    }
    const col = v_flex().w(sz).flex_none().items_center().gap(1).child(body)
      .children(o.tag === false ? [] : [tag(task.id)])
      .children(o.after ? [tag(o.after)] : [])
      .children(st === "sleep" && task.alternatives?.length ? [div().id(`wake-${task.id}`).flex_none().px(5).py(1).rounded(4).mt(2).cursor_pointer().whitespace_nowrap()
        .bg("#ffffffe6").border(1).border_color("#3f9a4a").text_color("#25303a").text_size(9).font_semibold()
        .hover((s) => s.bg("#d9f2dc")).tooltip(`Move ${task.id} off ${task.agent}: ${this.altUsage(task.alternatives[0])}`)
        .on_click((_e, cx) => { cx.stop_propagation(); this.openPanel(task.id, cx); this.move(task, task.alternatives[0], cx); })
        .child(`wake: move to ${this.altLabel(task.alternatives[0])}`)] : []);
    const motion = { duration: TROT, easing: "ease-in-out" };
    return h_flex().id(`sheep-${task.id}`).absolute().left(x).top(y).items_start()
      .transition("left", motion).transition("top", motion)
      .opacity(st === "gone" ? 0.45 : 1)
      .children(spacer ? [spacer] : []).child(col)
      .tooltip(tip).cursor_pointer()
      .on_hover((on, cx) => { const id = on ? task.id : this.hovered === task.id ? null : this.hovered; if (id !== this.hovered) { this.hovered = id; cx.notify(); } })
      .on_click((_e, cx) => this.openPanel(task.id, cx));
  }

  // Speech bubble with a pixel tail. b: { x, y, w, lines, alert, tail: "down"|"up"|"left", tx|ty, stalk }
  bubble(id, b, sc, top = false) {
    const fill = b.alert ? "#ffe1dc" : "#fffbe8", edge = b.alert ? "#c98d84" : "#b6aa8e";
    const p = Math.max(2, sc), hgt = bubbleH(b.lines);
    const els = [div().id(id).absolute().left(b.x).top(b.y).w(b.w).h(hgt).px(6).py(4).rounded(5).bg(fill)
      .border(1).border_color(edge).text_color("#2b2b2b").text_size(10)
      .when(top, (el) => el.shadow_md())
      .children(b.lines.map((l) => div().h(LINE).whitespace_nowrap().child(l)))];
    const rect = (x, y, w, h, c) => div().absolute().left(Math.round(x)).top(Math.round(y)).w(w).h(h).bg(c);
    // Three pixel rows narrowing away from the bubble, outlined; the first row covers the bubble's border.
    for (let i = 0; i < 3; i++) {
      const w = (5 - 2 * i) * p;
      if (b.tail === "left") {
        const x = b.x + 1 - (i + 1) * p, y = b.ty - w / 2;
        els.push(rect(x, y - 1, p, w + 2, edge), rect(x, y, p, w, fill));
        if (i === 2) els.push(rect(x - 1, y, 1, w, edge));
      } else {
        const down = b.tail === "down", x = b.tx - w / 2;
        const y = down ? b.y + hgt - 1 + i * p : b.y - (i + 1) * p + 1;
        els.push(rect(x - 1, y, w + 2, p, edge), rect(x, y, w, p, fill));
        if (i === 2) els.push(rect(x, down ? y + p : y - 1, w, 1, edge));
      }
    }
    if (b.stalk > 0) {
      const down = b.tail === "down", y = down ? b.y + hgt + 3 * p : b.y - 3 * p - b.stalk;
      els.push(rect(b.tx - p / 2 - 1, y, p + 2, b.stalk, edge), rect(b.tx - p / 2, y, p, b.stalk, fill));
    }
    return els;
  }

  scene(t, fill) {
    const d = this.data, m = d.mission;
    const W = Math.round(this.size?.width || 1080), H = Math.round(fill ? this.size?.height || 520 : AH * 2);
    const sc = Math.max(2, Math.min(4, Math.floor(W / AW), Math.floor(H / AH)));
    const ox = Math.max(0, Math.floor((W - AW * sc) / 2)), oy = Math.min(4 * sc, Math.floor(Math.max(0, H - AH * sc) / 6));
    // The grid is centred horizontally; below the sky, art rows stretch over the full height so the
    // pen, meadow and gate spread out in tall panes (sprites keep their integer scale).
    const ky = Math.max(sc, (H - oy - SKY * sc) / (AH - SKY));
    const X = (ax) => ox + ax * sc, Y = (ay) => Math.round(oy + Math.min(ay, SKY) * sc + Math.max(0, ay - SKY) * ky), skyH = Y(SKY);
    const chW = this.cw10 / 10, sz = 16 * sc;
    const at = (x, y, c) => div().absolute().left(x).top(y).child(c);
    const blocks = []; // laid-out rects that speech bubbles must not cover
    const label = (text, x, y) => {
      blocks.push({ x, y, w: text.length * chW * 1.05 + 8, h: 15 });
      return div().absolute().left(x).top(y).px(3).rounded(3).text_size(10).font_semibold().text_color("#ffffffd0").child(text);
    };
    const zone = { pen: [], meadow: [], gate: [], past: [], barn: [] };
    for (const k of m ? d.tasks : []) if (k.state !== "dropped") zone[ZONE[k.state] || "meadow"].push(k);
    const cloudy = (d.capacity || []).length > 0 || d.impediments.some((r) => r.severity === "block");
    const kids = [
      div().absolute().left(0).right(0).top(0).h(skyH).bg("#9fd8f2"),
      div().absolute().left(0).right(0).top(skyH).bottom(0).bg("#6cbb5a"),
      div().absolute().left(0).right(0).top(skyH).h(sc).bg("#5aa84a"),
      at(W - 16 * sc - 14, Math.max(4, Math.floor((skyH - 16 * sc) / 2) + sc), spr("sun", 16, 16, sc)),
      // Measures the font so text-driven walking steps and bubble widths come out in real pixels.
      div().id("char-probe").absolute().left(0).top(-60).text_size(10).whitespace_nowrap().text_color("#00000000").child("MMMMMMMMMM")
        .on_size_change((s, cx) => { if (s.width > 10 && Math.abs(s.width - this.cw10) > 0.5) { this.cw10 = s.width; cx.notify(); } }),
    ];
    if (cloudy) kids.push(div().absolute().top(Math.max(4, oy + 4 * sc)).loop("left", { from: W - 30 * sc, to: W - 22 * sc, period: 9000 })
      .child(spr("cloud", 16, 16, sc)));
    // Decoration in fixed spots, seeded by mission id so it does not jump between polls.
    let seed = hash(m?.id || d.project) || 1;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const dsc = Math.max(2, sc - 1);
    for (let i = 0; i < Math.round(W / 30); i++) {
      const name = ["grass-1", "grass-2", "flower"][Math.floor(rnd() * 3)];
      kids.push(at(Math.floor(rnd() * (W - 8 * dsc)), skyH + 3 * sc + Math.floor(rnd() * Math.max(1, H - skyH - 8 * dsc - 6 * sc)), spr(name, 8, 8, dsc)));
    }
    // HUD in the sky: plan usage meters and sleeping agents.
    kids.push(h_flex().absolute().left(12).top(Math.max(8, Math.floor(skyH / 2) - 16)).right(16 * sc + 30).gap(6).flex_wrap().children(this.hud()));

    // Drover (coordinator) with a speech bubble.
    const co = d.agents.find((a) => a.role === "coordinator");
    const coTip = co ? `drover · coordinator\n${co.agent || "agent"}${co.model ? ` / ${co.model}` : ""}\nmachine ${co.machine || "—"}\n${co.status}\n${co.msg || ""}`.trim() : "drover (coordinator not connected)";
    const asleep = this.coordAsleep();
    kids.push(this.clickable(v_flex().id("drover").absolute().left(X(8)).top(Y(SKY + 6)).items_center().gap(1).opacity(co?.status === "gone" ? 0.45 : asleep ? 0.6 : 1).id("drover").cursor_pointer().on_click((_e, cx) => this.openPanel("coordinator", cx))
      .child(co?.status === "working" && !asleep ? flip("drover-1", "drover-2", 16, 24, sc, 1100) : spr("drover-1", 16, 24, sc)).child(tag(asleep ? "drover zzz" : "drover")), null, coTip));
    blocks.push({ x: X(8), y: Y(SKY + 6), w: sz, h: 24 * sc + 14 });
    const coLines = wrap(asleep ? "zzz… out of capacity" : co?.msg || (m ? `Mission ${m.state}` : "Resting"), 26, 2);
    const coB = { x: X(8) + sz + 3 * Math.max(2, sc) + 2, y: Y(SKY + 6), w: bubbleW(coLines, chW), lines: coLines, tail: "left" };
    coB.ty = coB.y + Math.min(bubbleH(coLines) / 2, 5 * sc);
    blocks.push({ x: coB.x, y: coB.y, w: coB.w, h: bubbleH(coLines) });
    kids.push(...this.bubble("drover-bubble", coB, sc));

    // Where each sheep stands. Flocks are scattered organically (seeded by task id) inside each zone;
    // working sheep reserve room for their walking path and everyone in the meadow and gate for a bubble.
    const pos = new Map(), sheepOpts = new Map(), talk = [];
    const PATH = 10;
    const rest = Math.max(0, H - Y(AH - 4));
    // Pen (queued).
    kids.push(div().absolute().left(X(4)).top(Y(100)).w(96 * sc).h(Y(AH - 4) - Y(100)).bg("#5aa84a66"));
    for (let i = 0; i < 6; i++) kids.push(at(X(4 + i * 16), Y(92), spr("fence", 16, 16, sc)));
    const penMax = 8;
    kids.push(label(`PEN · queued${zone.pen.length > penMax ? ` · +${zone.pen.length - penMax}` : ""}`, X(6), Y(86) - 8));
    const pen = zone.pen.slice(0, penMax);
    const waitsOf = (task) => (task.depends_on || []).filter((id) => d.tasks.find((x) => x.id === id)?.state !== "merged");
    flock(pen, { x: X(6), y: Y(104), w: X(98) - X(6), h: Y(AH - 6) - Y(104) + rest },
      (task) => ({ w: Math.max(sz, 50), h: sz + (waitsOf(task).length ? 30 : 16), top: 0 }), pos);
    for (const task of pen) {
      const w = waitsOf(task);
      sheepOpts.set(task.id, { sc, after: w.length ? `after ${w[0]}${w.length > 1 ? "+" : ""}` : "" });
    }

    // Meadow (working) and gate (review): sheep that talk get room for a bubble above them.
    const status = (task) => this.sheepStatus(task, d.agents.find((a) => a.task === task.id && a.role === "worker"));
    const room = 2 * LINE + 14 + 3 * Math.max(2, sc);
    const talker = (task) => {
      const worker = d.agents.find((a) => a.task === task.id && a.role === "worker");
      const st = this.sheepStatus(task, worker);
      return { msg: this.sheepMsg(task, worker, st), st };
    };
    const foot = (task, maxW) => {
      const walk = status(task) === "walk", w = sz + (walk ? PATH * sc : 0);
      const lines = wrap(talker(task).msg, 26, 2);
      return { w: Math.max(w, Math.min(maxW, lines.length ? bubbleW(lines, chW) * 0.8 : w)), h: sz + 16 + (lines.length ? room : 0), top: lines.length ? room : 0, inner: w };
    };
    const meadowMax = 9, gateMax = 6;
    kids.push(label(`MEADOW · working${zone.meadow.length > meadowMax ? ` · +${zone.meadow.length - meadowMax}` : ""}`, X(108), skyH + 6));
    const meadow = zone.meadow.slice(0, meadowMax);
    const MR = { x: X(106), y: skyH + 22, w: X(216) - X(106), h: H - 8 - skyH - 22 };
    flock(meadow, MR, (task) => foot(task, MR.w), pos);
    kids.push(label(`GATE · review${zone.gate.length > gateMax ? ` · +${zone.gate.length - gateMax}` : ""}`, X(242), skyH + 6));
    const gate = zone.gate.slice(0, gateMax);
    const GR = { x: X(240), y: skyH + 22, w: X(302) - X(240), h: Y(AH - 4) - skyH - 22 };
    flock(gate, GR, (task) => foot(task, GR.w), pos);
    for (const task of [...meadow, ...gate]) {
      sheepOpts.set(task.id, { sc, path: status(task) === "walk" ? PATH : 0 });
      const { msg, st } = talker(task);
      if (msg) talk.push({ task, msg, alert: st === "alert" });
    }
    if (!ACTIVE.some((s) => d.tasks.some((x) => m && x.state === s))) {
      const line = !d.missions.length ? "No missions yet. Start one from this project's home to send some sheep out."
        : !m ? "Pick a mission above." : "All sheep home. Start a mission to send some out.";
      kids.push(div().absolute().left(X(104)).top(Y(SKY + 30)).w(116 * sc).flex().justify_center()
        .child(div().px(12).py(7).rounded(8).bg("#00000038").text_color("#ffffff").text_size(13).font_semibold().whitespace_normal().text_center().child(line)));
    }

    // Gate with the sheepdog (review).
    const open = zone.gate.length + zone.past.length > 0;
    kids.push(at(X(222), Y(92), spr(open ? "gate-open" : "gate-closed", 16, 16, sc)));
    const rev = d.agents.filter((a) => a.role === "reviewer"), dogA = rev[rev.length - 1];
    kids.push(this.clickable(v_flex().id("dog").absolute().left(X(220)).top(Y(116)).items_center().gap(1).opacity(dogA?.status === "gone" ? 0.45 : 1)
      .child(dogA?.status === "working" ? flip("dog-1", "dog-2", 16, 12, sc, 500) : spr("dog-1", 16, 12, sc)).child(tag(dogA ? dogA.who : "dog")),
      dogA, dogA ? `${dogA.who} · reviewer\n${dogA.agent || "agent"}${dogA.model ? ` / ${dogA.model}` : ""}\nmachine ${dogA.machine || "—"}\n${dogA.status}\n${dogA.msg || ""}`.trim() : "Sheepdog · no reviewer right now"));
    blocks.push({ x: X(220), y: Y(116), w: sz, h: 12 * sc + 14 }, { x: X(222), y: Y(92), w: sz, h: sz });

    // Barn with the merged sheep sitting at its foot; approved sheep wait below them.
    const barnY = Y(SKY + 2);
    kids.push(at(X(306), barnY, spr("barn", 48, 40, sc)));
    blocks.push({ x: X(306), y: barnY, w: 48 * sc, h: 40 * sc });
    const ms = Math.max(2, sc - 1), per = Math.max(1, Math.floor(58 * sc / (16 * ms + 2)));
    const mergedY = barnY + 42 * sc, mergedRows = Math.max(1, Math.ceil(Math.min(zone.barn.length, per * 2) / per));
    zone.barn.slice(0, per * 2).forEach((task, i) => {
      pos.set(task.id, { x: X(300) + (i % per) * (16 * ms + 2), y: mergedY + Math.floor(i / per) * (16 * ms + 2) });
      sheepOpts.set(task.id, { sc: ms, tag: false });
    });
    kids.push(label(zone.barn.length ? `merged ×${zone.barn.length}` : "barn · nothing merged yet", X(302), mergedY + mergedRows * (16 * ms + 2)));
    const pastY = Math.max(Y(96), mergedY + mergedRows * (16 * ms + 2) + 22);
    kids.push(label(`APPROVED${zone.past.length > 2 ? ` · +${zone.past.length - 2}` : ""}`, X(302), pastY));
    zone.past.slice(0, 2).forEach((task, i) => { pos.set(task.id, { x: X(300 + i * 29), y: pastY + 16 }); sheepOpts.set(task.id, { sc }); });

    // Sheep, noting which ones just changed spot so they trot (facing their way) instead of sliding.
    const now = Date.now();
    if (now >= this.trotUntil) this.trot.clear();
    const sheepRects = new Map();
    if (this.size) for (const [id, p] of pos) {
      const task = d.tasks.find((k) => k.id === id), o = sheepOpts.get(id);
      const prev = this.pos.get(id);
      if (prev && now < this.trotUntil && Math.hypot(p.x - prev.x, p.y - prev.y) > 4) this.trot.set(id, p.x < prev.x ? "l" : "r");
      this.pos.set(id, p);
      kids.push(this.sheep(t, task, p.x, p.y, { ...o, trot: this.trot.get(id) }));
      const s = 16 * o.sc;
      sheepRects.set(id, { x: p.x, y: p.y, w: s + (o.path || 0) * o.sc, h: s + (o.tag === false ? 0 : 15) });
    }

    // Speech bubbles: up to two wrapped lines, placed so they never cover each other, labels or other sheep.
    const p = Math.max(2, sc), tailH = 3 * p + 1;
    const placed = [];
    const cost = (r, own) => {
      if (r.x < 4 || r.x + r.w > W - 4 || r.y < skyH + 4 || r.y + r.h > H - 4) return Infinity;
      let c = 0;
      for (const b of [...blocks, ...placed]) c += 1000 * area(r, b, 2);
      for (const [id, s] of sheepRects) if (id !== own) c += 3 * area(r, s, 1);
      return c;
    };
    const fit = (S, bw, bh, own) => {
      const ax = S.x + S.w / 2, cands = [];
      for (const lift of [0, 0.5, 1, 1.6]) for (const side of lift ? ["above"] : ["above", "below"]) for (const dx of [0, -0.3, 0.3, -0.45, 0.45]) {
        const x = Math.round(Math.max(4, Math.min(W - bw - 4, ax - bw / 2 + dx * bw)));
        const stalk = Math.round(lift * bh);
        const y = side === "above" ? S.y - tailH - bh - stalk : S.y + S.h + tailH;
        cands.push({ x, y, w: bw, h: bh, tail: side === "above" ? "down" : "up", stalk,
          tx: Math.max(x + 6 + 3 * p, Math.min(x + bw - 6 - 3 * p, ax)) });
      }
      let best = null, bc = Infinity;
      for (const c of cands) {
        const k = cost(c, own) + c.stalk * 0.01;
        if (k < bc) { bc = k; best = c; }
        if (k === 0) break;
      }
      return best || cands[0];
    };
    const focus = this.panel || this.hovered;
    talk.sort((a, b) => b.alert - a.alert);
    let full = null;
    for (const { task, msg, alert } of talk) {
      const S = sheepRects.get(task.id);
      if (!S || this.trot.has(task.id)) continue; // the bubble waits until the sheep has arrived
      const S2 = { ...S, h: 16 * sc };
      if (task.id === focus) {
        const lines = wrap(msg, 34, 10), bw = bubbleW(lines, chW), bh = bubbleH(lines);
        const above = S2.y - tailH - bh >= skyH + 4;
        const x = Math.round(Math.max(4, Math.min(W - bw - 4, S2.x + S2.w / 2 - bw / 2)));
        full = { x, y: above ? S2.y - tailH - bh : S.y + S.h + tailH, w: bw, lines, alert, tail: above ? "down" : "up",
          tx: Math.max(x + 6 + 3 * p, Math.min(x + bw - 6 - 3 * p, S2.x + S2.w / 2)) };
        continue;
      }
      const lines = wrap(msg, 26, 2), bw = bubbleW(lines, chW), bh = bubbleH(lines);
      const b = fit(S, bw, bh, task.id);
      placed.push({ x: b.x, y: b.y, w: b.w, h: b.h });
      kids.push(...this.bubble(`bubble-${task.id}`, { ...b, lines, alert }, sc));
    }
    if (full) kids.push(...this.bubble("bubble-full", full, sc, true));

    return div().id("pasture").relative().w_full().when(fill, (el) => el.flex_1().min_h(AH * 2)).when(!fill, (el) => el.flex_none().h(H))
      .rounded(12).overflow_hidden().border(1).border_color(t.border)
      .on_size_change((s, cx) => {
        if (fill ? Math.abs(s.width - (this.size?.width || 0)) + Math.abs(s.height - (this.size?.height || 0)) > 2
          : Math.abs(s.width - (this.size?.width || 0)) > 2) { this.size = fill ? s : { width: s.width, height: this.size?.height || s.height }; cx.notify(); }
      })
      .children(kids);
  }

  historySection(t) {
    return v_flex().flex_none().gap(8)
      .child(h_flex().id("history-toggle").flex_none().gap(6).items_center().px(4).py(3).rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip("Task board and activity timeline")
        .on_click((_e, cx) => { this.history = !this.history; cx.notify(); })
        .child(div().text_size(11).text_color(t.muted).child(this.history ? "▾" : "▸"))
        .child(div().text_size(10).font_semibold().text_color(t.dim).child("HISTORY"))
        .child(div().text_size(10).text_color(t.dim).child("task board · activity")))
      .children(this.history ? [h_flex().flex_none().h(440).gap(14).items_stretch().child(this.board(t)).child(this.timeline(t))] : []);
  }

  render() {
    const t = theme(), p = props() ?? {};
    const d = this.data;
    const needs = d?.mission ? this.needsYou(t) : null;
    const body = !d ? [v_flex().flex_1().items_center().justify_center().gap(10)
      .child(svg("mods/drover-rail/horns.svg").size(44).text_color(t.dim))
      .child(div().text_size(16).font_semibold().child(this.error ? "Waiting for mission data" : "Loading mission…"))
      .child(div().max_w(580).whitespace_normal().text_size(12).text_color(t.muted).child(this.error || "Asking drover for the latest snapshot."))]
      : this.history && d.mission ? [v_flex().id("main-scroll").flex_1().min_h(0).overflow_y_scrollbar().gap(8)
        .child(this.scene(t, false)).child(this.historySection(t))]
      : [this.scene(t, true), ...(d.mission ? [this.historySection(t)] : [])];
    return v_flex().id("root").relative().track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground)
      .on_key_down((e, cx) => {
        if (e.key !== "escape") return;
        if (this.picker) { this.picker = false; cx.notify(); } else if (this.panel) this.closePanel(cx); else closeOverlay(props().overlay);
        cx.stop_propagation();
      })
      .child(this.header(t, p))
      .child(v_flex().flex_1().min_h(0).px(14).pt(10).pb(8).gap(8).opacity(this.switching && d ? 0.5 : 1)
        .children(this.error && !this.demo && d ? [h_flex().flex_none().gap(8).px(10).py(5).rounded(7).bg(`${t.ansi3 || t.accent}18`)
          .child(div().flex_1().min_w(0).text_size(11).text_color(t.ansi3 || t.accent).truncate().tooltip(this.error).child("Connection lost · showing last snapshot"))
          .child(div().id("retry").cursor_pointer().text_size(11).text_color(t.accent).tooltip(this.error)
            .on_click((_e, cx) => { this.busy = false; this.load(cx); }).child(this.busy ? "Retrying…" : "Retry"))] : [])
        .children(needs ? [needs] : [])
        .children(body))
      .children(this.picker && d ? [this.pickerMenu(t)] : [])
      .children(this.panel && d?.mission && this.panelView(t) ? [this.panelView(t)] : []);
  }
}
