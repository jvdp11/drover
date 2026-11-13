// Per-project mission flow. Props: { folder, name, space, mission?, showArchived?, demo? }.
// openOverlay({ mod: "drover-dashboard", kind: "dialog", width: 1120, height: 760,
//   props: { folder, name, space, mission } });
import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, theme, props, closeOverlay, run, shared, machines, panes, spaces, notify, playSound } from "herdr";
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
const FAMILIES = { anthropic: "anthropic", openai: "openai", cursor: "cursor", github: "github", copilot: "github", google: "google" };
const BY_AGENT = { claude: "anthropic", codex: "openai", cursor: "cursor", copilot: "github", gemini: "google" };
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
const TROT = 1600, STEP_MS = 110, LINE = 13, OWL_FLY = 4500;

// --- Events and actors ---
// Task size S/M/L draws the same sheep at 0.8x / 1x / 1.2x.
const sizeK = (task) => ({ S: 0.8, M: 1, L: 1.2 })[String(task?.size || "M")[0].toUpperCase()] || 1;
// Older pose names map onto sprite contract v2.
const V2P = { walk2: "walk3", graze: "graze1" };
const POSES = { walk: ["walk1", "walk2"], run: ["run1", "run2"], idle: ["idle1", "idle2"], wag: ["wag1", "wag2"] };
// Three-frame loop a, b, c, b, a, run natively: nested opacity loops of one period keep only the frame
// whose third of the swing is current (opacities multiply, so b shows only between both thresholds).
const flip3 = (a, b, c, w, h, sc, period = 900) => {
  const k = (from, to, el) => div().absolute().left(0).top(0).loop("opacity", { from, to, period, easing: "linear" }).child(el);
  return div().relative().w(w * sc).h(h * sc).flex_none()
    .child(k(5, -11, spr(a, w, h, sc)))
    .child(k(-5, 11, k(11, -5, spr(b, w, h, sc))))
    .child(k(-11, 5, spr(c, w, h, sc)));
};
// Sounds (off by default, header toggle). Synthesized for this mod by sounds/make_sounds.py, CC0 1.0.
const SOUND = { bleat: "mods/drover-dashboard/sounds/bleat.mp3", chime: "mods/drover-dashboard/sounds/chime.mp3" };
// Per-viewer settings (this mod copy's localStorage): time of day "auto" | "day" | "night", sound on/off.
const store = { get(k, d) { try { return localStorage.getItem(`pasture.${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`pasture.${k}`, String(v)); } catch { /* not remembered */ } } };
// Local clock: dawn 6-8, day 8-18, dusk 18-20, night 20-6.
const clockPhase = (h = new Date().getHours()) => (h >= 6 && h < 8 ? "dawn" : h >= 8 && h < 18 ? "day" : h >= 18 && h < 20 ? "dusk" : "night");
const TINT = { dawn: "#ffb46a2e", dusk: "#ff7a2a40", night: "#101a5a8c" };
const SKYC = { day: "#9fd8f2", dawn: "#f4c7a4", dusk: "#f0a070", night: "#24306a" };
// Where scenes happen: ONE place for every named anchor, in art pixels (top-left of the figure standing there).
// A point is [ax, ay] on the pasture grid, or ["barn", dx, dy] relative to the barn's top-left.
// Other layers (scenery, weather, night) should place things through these names too.
function layout() {
  const bw = 64, bh = 56, bx = 296;
  return {
    home: [8, SKY + 6],         // where the drover stands
    edge: [-34, SKY + 6],       // just off the left of the pasture: drovers walk in and out here
    penGate: [52, 92],          // gate tile in the pen's fence
    penIn: [38, 112],           // inside the pen, by the gate
    meadow: [150, 66],          // middle of the meadow
    reviewGate: [222, 92],      // gate between meadow and review area
    reviewZone: [250, 104],     // where a sheep waits in review
    dog: [234, 136],            // the sheepdog's spot, just inside the review side of the fence
    past: [300, 100],           // approved sheep wait here
    barn: [bx, SKY + 2, bw, bh], // x, y, w, h
    barnDoor: ["barn", bw / 2 - 12, bh - 26],
  };
}
// Scene stage: S = { a: { drover, drover2, dog, "s:<task>": { at, dir, pose, msg, fam, hide, lamb } }, gate: { pen, rev }, barn, fx: [{ k, on | at }], move }.
const put = (S, k, p) => { S.a[k] = { ...S.a[k], ...p }; };
// Walk (or run) actor k to a point, turning to face the way it goes.
const go = (S, k, at, p = {}) => {
  const from = S.a[k]?.at || S.home[k] || at, x = (q) => (typeof q[0] === "string" ? S.L.barn[0] + q[1] : q[0]);
  put(S, k, { at, dir: x(at) < x(from) ? "l" : x(at) > x(from) ? "r" : S.a[k]?.dir || "r", ...p });
};
const newStage = (L) => ({ L, a: {}, gate: {}, barn: false, fx: [], move: 300, home: { drover: L.home, drover2: L.edge, dog: L.dog } });
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
function flock(tasks, R, foot, out, avoid = []) {
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
      const v = Math.min(gap, want) - 0.06 * Math.hypot(r.x + f.w / 2 - mx, r.y + f.h / 2 - my) - [...avoid, ...placed].reduce((s, q) => s + area(r, q, 3), 0);
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
    : `until ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hm}`;
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
    { id: "t2", size: "M", title: "Polish the project rail", state: "merged", agent: "cursor", machine: "studio", rounds: 2, created: NOW - 5000, updated: NOW - 2400, review: { model: "gpt-5.4", family: "openai", verdict: "approve" }, tokens: { total: 15000 } },
    { id: "t3", size: "L", title: "Redesign the dashboard overview", state: "working", agent: "codex", model: "gpt-5.4", machine: "workstation", rounds: 0, depends_on: ["t1"], created: NOW - 3000, updated: NOW - 20, review: null, tokens: { total: 200000 },
      alternatives: [{ agent: "claude", model: "sonnet", family: "anthropic", used_percent: 41, resets_at: NOW + 9000 }, { agent: "gemini", model: "gemini-3", family: "google", used_percent: 23, resets_at: NOW + 50000 }, { agent: "cursor", model: null, family: "cursor", used_percent: null, resets_at: null }] },
    { id: "t4", size: "S", title: "Add project entry points", state: "changes", agent: "claude", model: "sonnet", machine: "studio", rounds: 1, depends_on: ["t2"], created: NOW - 2800, updated: NOW - 300, review: { model: "gpt-5.4", family: "openai", verdict: "changes" }, tokens: { total: 60000 } },
    { id: "t5", size: "M", title: "Animate the mission flow", state: "review", agent: "codex", model: "gpt-5.4", machine: "workstation", rounds: 1, created: NOW - 2000, updated: NOW - 100, review: { model: "sonnet", family: "anthropic", verdict: null }, tokens: { total: 60000 },
      alternatives: [{ agent: "gemini", model: "gemini-3", family: "google", used_percent: 23, resets_at: NOW + 50000 }, { agent: "cursor", model: null, family: "cursor", used_percent: 67, resets_at: NOW + 3600 }] },
    { id: "t6", size: "L", title: "Document the dashboard", state: "approved", agent: "claude", model: "opus", machine: "studio", rounds: 1, created: NOW - 1800, updated: NOW - 60, review: { model: "gpt-5.4", family: "openai", verdict: "approve" }, tokens: { total: 30000 } },
    { id: "t7", size: "M", title: "Ship release notes", state: "queued", agent: null, rounds: 0, depends_on: ["t3", "t5"], created: NOW - 1000, updated: NOW - 1000, review: null, tokens: null },
    { id: "t9", size: "S", title: "Localise the dashboard", state: "queued", agent: null, rounds: 0, depends_on: ["t4"], created: NOW - 900, updated: NOW - 900, review: null, tokens: null },
    { id: "t10", size: "S", title: "Animate the barn door", state: "working", agent: "claude", model: "haiku", machine: "studio", rounds: 0, created: NOW - 700, updated: NOW - 10, review: null, tokens: { total: 8000 } },
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
    // Events and actors: queued scenes play one at a time on `stage`.
    this.queue = []; this.playing = false; this.last = null;
    this.pending = new Set(); this.pendingMerge = new Set();
    this.stage = newStage(layout());
    this.replay = !!(props()?.demo && props()?.events);
    // World: time of day and sound are remembered per viewer; the owl flies at night.
    this.timeMode = store.get("time", "auto"); this.sound = store.get("sound", "off") === "on";
    this.phase = this.timeOfDay(); this.owl = null; this.perches = [];
    this.tick(cx);
    cx.timer.every(POLL_MS, (cx) => { this.load(cx); this.tick(cx); });
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
      const phase = calm || p.events ? 0 : Math.floor(Date.now() / 12000) % 2;
      if (!this.data || this.demoCalm !== calm || this.demoPhase !== phase) {
        const d = demoData(calm);
        if (phase) for (const k of d.tasks) if (k.id === "t10") k.state = "review";
        this.noteMoves(d, cx);
        this.data = d; this.demo = true; this.demoCalm = calm; this.demoPhase = phase; this.switching = false; this.error = null; cx.notify();
      }
      if (this.replay) this.pump(cx);
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
        this.events(d, cx);
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

  // --- sprite lookup (contract v2) ---
  art(kind, fam, pose, dir) {
    const l = dir === "l" ? "-l" : "";
    if (kind === "sheep") return { file: `sheep2-${fam}-${V2P[pose] || pose}${l}`, w: 24, h: 24 };
    if (kind === "lamb") return { file: `sheep2-lamb-${pose}${l}`, w: 16, h: 16 };
    if (kind === "drover") return { file: `drover2-${fam}-${pose}${l}`, w: 24, h: 32 };
    return { file: `dog2-${pose}${l}`, w: 24, h: 18 };
  }

  dim(kind) { return this.art(kind, "other", { sheep: "sit", lamb: "walk1", drover: "idle1", dog: "sit" }[kind], "r"); }

  // A figure: one pose, or two poses flipped natively.
  fig(kind, fam, poses, dir, sc, period = 500) {
    const a = poses.map((p) => this.art(kind, fam, p, dir));
    return a.length > 1 && a[0].file !== a[1].file ? flip(a[0].file, a[1].file, a[0].w, a[0].h, sc, period) : spr(a[0].file, a[0].w, a[0].h, sc);
  }

  // --- world: time of day, weather, the owl ---
  // "dawn" | "day" | "dusk" | "night": demo props.time forces it, else the header toggle, else the local clock.
  timeOfDay() {
    const p = props() || {};
    if (p.demo && SKYC[p.time]) return p.time;
    return this.timeMode === "day" ? "day" : this.timeMode === "night" ? "night" : clockPhase();
  }

  setTimeMode(mode, cx) { this.timeMode = mode; store.set("time", mode); this.tick(cx); cx.notify(); }

  toggleSound(cx) { this.sound = !this.sound; store.set("sound", this.sound ? "on" : "off"); if (this.sound) playSound(SOUND.bleat); cx.notify(); }

  // Every poll: redraw when the time of day turns; at night start the owl's round.
  tick(cx) {
    const ph = this.timeOfDay();
    if (ph !== this.phase) { this.phase = ph; cx.notify(); }
    if (ph === "night" && !this.owl) {
      this.owl = { st: props()?.demo && props()?.owl === "perch" ? "perch" : "away", n: 0 };
      if (this.owl.st === "away") cx.timer.after(1200, (cx) => this.owlStep(cx));
    }
  }

  // The owl: waits off the left edge, flies in to a perch (a tree or the barn roof), sits a while, flies off right.
  owlStep(cx) {
    const o = this.owl;
    if (!o) return;
    if (this.timeOfDay() !== "night") { this.owl = null; cx.notify(); return; }
    const next = { away: ["in", OWL_FLY], in: ["perch", 26000], perch: ["out", OWL_FLY], out: ["away", 30000] }[o.st];
    this.owl = { st: next[0], n: o.st === "out" ? o.n + 1 : o.n };
    cx.notify();
    cx.timer.after(next[1], (cx) => this.owlStep(cx));
  }

  // clear | cloudy (an agent this mission uses is at 70%+) | overcast (90%+) | rain (one is out) | rainbow (all merged).
  weather() {
    const d = this.data, m = d.mission, p = props() || {};
    if (p.demo && p.weather) return p.weather;
    if (!m) return "clear";
    const tasks = d.tasks.filter((k) => k.state !== "dropped");
    if (tasks.length && tasks.every((k) => k.state === "merged")) return "rainbow";
    const used = new Set([...d.agents.filter((a) => a.status !== "gone").map((a) => a.agent),
      ...tasks.filter((k) => ACTIVE.includes(k.state)).map((k) => k.agent)].filter(Boolean));
    if ((d.capacity || []).some((c) => used.has(c.agent))) return "rain";
    const pct = Math.max(0, ...this.usageRows().filter((u) => used.has(u.agent)).map((u) => Number(u.used_percent ?? u.pct)));
    return pct >= 90 ? "overcast" : pct >= 70 ? "cloudy" : "clear";
  }

  fxEl(k, sc) { return spr(k, 8, 8, sc); }

  // --- event layer: diff each snapshot against the last, queue short scenes, play them in order ---
  snap(d) {
    const keep = this.data;
    this.data = d;
    try {
      const co = d.agents.find((a) => a.role === "coordinator");
      return { id: d.mission?.id,
        tasks: new Map(d.tasks.map((k) => {
          const w = d.agents.find((a) => a.task === k.id && a.role === "worker");
          return [k.id, { state: k.state, agent: k.agent, verdict: k.review?.verdict || null, alert: this.sheepStatus(k, w) === "alert", fam: this.famKey(w, k.agent) }];
        })),
        co: co ? { agent: co.agent, fam: this.famKey(co), status: co.status, asleep: this.coordAsleep() } : null };
    } finally { this.data = keep; }
  }

  // The first snapshot (and a switch to another mission) plays nothing.
  events(d, cx) {
    const prev = this.last, cur = this.snap(d);
    this.last = cur;
    if (this.replay) return;
    if (!prev || prev.id !== cur.id) { this.queue = []; this.pending.clear(); this.pendingMerge.clear(); return; }
    const STATE = { done: "done", review: "review", changes: "changes", approved: "approve", merged: "merge" };
    const evs = [];
    for (const [id, n] of cur.tasks) {
      const o = prev.tasks.get(id);
      if (!o) { evs.push({ k: "added", id, queued: n.state === "queued" }); continue; }
      if (o.agent && n.agent && o.agent !== n.agent) evs.push({ k: "reroute", id, from: o.fam, to: n.fam });
      if (o.state !== n.state) { if (STATE[n.state]) evs.push({ k: STATE[n.state], id }); }
      else if (n.verdict && o.verdict !== n.verdict) evs.push({ k: n.verdict === "approve" ? "approve" : "changes", id });
      if (!o.alert && n.alert) evs.push({ k: "stuck", id });
    }
    if (prev.co && cur.co) {
      if (prev.co.agent !== cur.co.agent) evs.push({ k: "handover", from: prev.co.fam, to: cur.co.fam });
      else if (prev.co.status !== cur.co.status || prev.co.asleep !== cur.co.asleep)
        evs.push({ k: "status", text: cur.co.asleep ? "zzz… out of capacity" : cur.co.status === "blocked" ? "I'm stuck, need a hand" : cur.co.status === "working" ? "back to work" : "all quiet" });
    }
    for (const e of evs) this.enqueue(e);
    this.pump(cx);
  }

  enqueue(e) {
    const sc = this.build(e);
    if (!sc) return;
    if (e.k === "added") this.pending.add(e.id);
    if (e.k === "merge") this.pendingMerge.add(e.id);
    this.queue.push(sc);
    while (this.queue.length > 12) { const x = this.queue.shift().ev; this.pending.delete(x.id); this.pendingMerge.delete(x.id); }
  }

  // Play the next queued scene: one cx.timer.after per step, no redraw timers.
  pump(cx) {
    if (this.playing) return;
    if (!this.queue.length && this.replay) { this.script().forEach((e) => this.enqueue(e)); this.queue.push({ ev: {}, steps: [[2500, null]] }); }
    const sc = this.queue.shift();
    if (!sc) return;
    this.playing = true;
    if (this.sound && (sc.ev.k === "done" || sc.ev.k === "merge")) playSound(sc.ev.k === "done" ? SOUND.bleat : SOUND.chime);
    const L = layout(), S = this.stage = newStage(L);
    // Sheep scenes end with a trot to the settled place, so the tail waits for it.
    const steps = [...sc.steps, [sc.ev.id ? TROT + 120 : 250, () => {
      this.pending.delete(sc.ev.id); this.pendingMerge.delete(sc.ev.id);
      this.stage = newStage(L); this.trotUntil = Date.now() + TROT;
    }]];
    const run = (i, cx) => {
      const [ms, fn] = steps[i], S = this.stage;
      S.fx = []; S.move = ms;
      for (const a of Object.values(S.a)) delete a.msg;
      fn?.(S);
      cx.notify();
      cx.timer.after(ms, (cx) => { if (i + 1 < steps.length) run(i + 1, cx); else { this.playing = false; cx.notify(); this.pump(cx); } });
    };
    run(0, cx);
  }

  // The demo replay: every scene once, on the demo mission's tasks.
  script() {
    return [{ k: "added", id: "t7", queued: true }, { k: "done", id: "t5" }, { k: "review", id: "t3" }, { k: "changes", id: "t5" },
      { k: "approve", id: "t5" }, { k: "merge", id: "t6" }, { k: "reroute", id: "t10", from: "anthropic", to: "openai" }, { k: "stuck", id: "t4" },
      { k: "status", text: "back to work" }, { k: "handover", from: "anthropic", to: "openai" }];
  }

  // Scene scripts: [ms, fn(stage)] steps. Walking steps last as long as the walk (stage.move drives the native transition).
  build(e) {
    const L = layout(), k = `s:${e.id}`, M = L.meadow, G = L.reviewGate, Z = L.reviewZone;
    const W = { pose: "walk" }, at = (p, dx, dy) => (typeof p[0] === "string" ? [p[0], p[1] + dx, p[2] + dy] : [p[0] + dx, p[1] + dy]);
    const rest = (S, ...ks) => ks.forEach((x) => delete S.a[x]);
    const steps = {
      // a lamb appears in the pen, the drover opens the gate and leads it out
      added: () => [
        [900, (S) => { this.pending.delete(e.id); put(S, k, { at: L.penIn, pose: "walk", lamb: true, dir: "r" }); S.fx.push({ k: "sparkle1", on: k }); }],
        [1500, (S) => go(S, "drover", at(L.penGate, -4, -34), W)],
        [600, (S) => { put(S, "drover", { pose: "idle", dir: "r" }); S.gate.pen = true; }],
        [900, (S) => go(S, k, at(L.penGate, -4, -14), W)],
        [1300, (S) => { go(S, "drover", at(L.penGate, 40, -34), W); go(S, k, at(L.penGate, 16, -14), W); }],
        ...(e.queued ? [[1000, (S) => go(S, k, L.penIn, W)]] : []),
        [900, (S) => { S.gate.pen = false; go(S, "drover", L.home, W); }],
      ],
      done: () => [[2200, (S) => put(S, k, { msg: "baa, done!" })]],
      // the drover whistles, the dog herds the sheep to the gate and sits
      review: () => [
        [1000, (S) => { put(S, k, { at: M, pose: "graze1", dir: "r" }); put(S, "drover", { pose: "whistle" }); S.fx.push({ k: "note", on: "drover" }); }],
        [1300, (S) => { rest(S, "drover"); go(S, "dog", at(M, 28, 6), { pose: "run" }); }],
        [1800, (S) => { S.gate.rev = true; go(S, k, at(G, -8, -6), W); go(S, "dog", at(G, -34, 6), { pose: "run" }); }],
        [800, (S) => { put(S, k, { pose: "sit" }); go(S, "dog", L.dog, { pose: "run" }); }],
        [600, (S) => { put(S, "dog", { pose: "sit" }); S.gate.rev = false; }],
      ],
      // the dog barks, the sheep trots back to the meadow
      changes: () => [
        [1000, (S) => { put(S, k, { at: Z, pose: "sit", dir: "l" }); put(S, "dog", { pose: "bark", dir: "l", msg: "woof!" }); }],
        [1700, (S) => { S.gate.rev = true; put(S, "dog", { pose: "sit" }); go(S, k, M, W); }],
        [400, (S) => { S.gate.rev = false; put(S, k, { pose: "graze1" }); }],
      ],
      // the dog wags, the gate opens, the sheep passes
      approve: () => [
        [1000, (S) => { put(S, k, { at: Z, pose: "sit", dir: "l" }); put(S, "dog", { pose: "wag", dir: "l" }); }],
        [800, (S) => { S.gate.rev = true; go(S, k, at(G, 12, 0), W); }],
        [1500, (S) => go(S, k, L.past, W)],
        [400, (S) => { S.gate.rev = false; put(S, "dog", { pose: "sit" }); put(S, k, { pose: "sit" }); }],
      ],
      // the barn door opens, the sheep walks in: hearts, confetti, a new hay bale
      merge: () => [
        [800, (S) => { S.barn = true; put(S, k, { at: L.past, pose: "sit", dir: "r" }); }],
        [1500, (S) => go(S, k, L.barnDoor, W)],
        [1300, (S) => { put(S, k, { hide: true }); this.pendingMerge.delete(e.id); S.fx.push({ k: "heart", at: at(L.barnDoor, 6, -10) }, { k: "confetti1", at: at(L.barnDoor, -8, -4) }, { k: "confetti2", at: at(L.barnDoor, 18, -6) }); }],
        [700, (S) => { S.barn = false; S.fx.push({ k: "heart", at: at(L.barnDoor, 0, -14) }); }],
      ],
      reroute: () => [
        [700, (S) => { put(S, k, { fam: e.from }); S.fx.push({ k: "sparkle1", on: k }); }],
        [1100, (S) => { put(S, k, { fam: e.to }); S.fx.push({ k: "sparkle2", on: k }); }],
      ],
      stuck: () => [[2800, (S) => { put(S, k, { pose: "stuck" }); S.fx.push({ k: "bubble-alert", on: k }); }]],
      // a new drover in the new family's colours walks in while the old one walks off
      handover: () => [
        [200, (S) => { put(S, "drover", { at: L.home, fam: e.from, pose: "idle", dir: "r" }); put(S, "drover2", { at: L.edge, fam: e.to, pose: "walk", dir: "r" }); }],
        [1900, (S) => { go(S, "drover", at(L.edge, 0, 26), W); go(S, "drover2", L.home, W); }],
        [1200, (S) => put(S, "drover2", { pose: "idle", msg: "I've got it from here" })],
      ],
      status: () => [[2000, (S) => put(S, "drover", { msg: e.text })]],
    }[e.k];
    return steps ? { ev: e, steps: steps() } : null;
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
      .child(this.worldToggles(t))
      .children(m && ["done", "stopped"].includes(m.state) && !m.archived && !this.demo ? [
        div().id("archive-mission").flex_none().px(9).py(5).rounded(6).cursor_pointer().text_size(11).text_color(t.muted)
          .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.archive(cx))
          .child(this.archiving ? "Archiving…" : "Archive")] : [])
      .child(div().id("close").w(28).h(28).flex_none().rounded(7).flex().items_center().justify_center().cursor_pointer()
        .tooltip("Close (Esc)").hover((s) => s.bg(t.hover)).on_click(() => closeOverlay(props().overlay))
        .child(svg("mods/workspace-chrome/x.svg").size(15).text_color(t.muted)));
  }

  // Header: pasture time of day (Auto / Day / Night) and sounds, remembered per viewer.
  worldToggles(t) {
    const seg = (mode, label, tip) => div().id(`time-${mode}`).px(7).py(3).rounded(5).cursor_pointer().text_size(10).font_semibold()
      .bg(this.timeMode === mode ? `${t.accent}2a` : t.surface).text_color(this.timeMode === mode ? t.accent : t.muted)
      .hover((s) => s.bg(t.hover)).tooltip(tip).on_click((_e, cx) => this.setTimeMode(mode, cx)).child(label);
    return h_flex().flex_none().gap(6).items_center()
      .child(h_flex().gap(1).p(1).rounded(6).border(1).border_color(t.border).bg(t.surface)
        .child(seg("auto", "Auto", `Pasture follows the local clock (now ${clockPhase()})`))
        .child(seg("day", "Day", "Always day in the pasture"))
        .child(seg("night", "Night", "Always night in the pasture")))
      .child(div().id("sound-toggle").px(7).py(3).rounded(6).cursor_pointer().text_size(11).border(1).border_color(t.border)
        .text_color(this.sound ? t.accent : t.dim).hover((s) => s.bg(t.hover))
        .tooltip(this.sound ? "Sounds on: a bleat when a worker is done, a chime on a merge. Click to mute." : "Sounds off. Click for a bleat when a worker is done and a chime on a merge.")
        .on_click((_e, cx) => this.toggleSound(cx)).child(this.sound ? "♪ on" : "♪ off"));
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
    if (!["working", "changes", "done", "review"].includes(task.state)) return "sit";
    if (worker?.status === "gone") return "gone";
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
  // o: { sc, tag, after, path (art px), trot ("r"/"l"), act (scene override: pose, dir, fam, lamb, hide, move) }
  sheep(t, task, x, y, o) {
    const worker = this.data.agents.find((a) => a.task === task.id && a.role === "worker");
    const st = this.sheepStatus(task, worker), act = o.act;
    const fam = act?.fam || this.famKey(worker, task.agent), sc = o.sc, W0 = this.dim("sheep").w, sz = W0 * sc, h = hash(task.id);
    const art = (pose, dir) => this.art("sheep", fam, pose, dir);
    const face = (h >> 2) % 3 === 0 ? "l" : "r";
    const age = duration(Date.now() / 1000 - seconds(task.updated || task.created));
    const note = st === "sleep" ? "out of capacity" : st === "alert" ? "needs attention" : st === "gone" ? "gone" : "";
    const tip = [`${task.id} · ${task.title || ""}${task.size ? ` · size ${String(task.size).toUpperCase()}` : ""}`, `${task.agent || "unassigned"}${task.model ? ` / ${task.model}` : ""}`,
      `machine ${task.machine || worker?.machine || "—"}`, `${task.state}${note ? ` · ${note}` : ""} · ${age}`,
      "Click for details and actions"].filter(Boolean).join("\n");
    const box = () => div().relative().w(sz).h(sz).flex_none();
    let body, spacer = null;
    if (act?.pose) {
      // Scene pose: stands on the sheep's feet, lambs are smaller; walking flips two frames natively.
      const kind = act.lamb ? "lamb" : "sheep", d = act.dir || "r", poses = act.pose === "walk" ? ["walk1", "walk2"] : [act.pose];
      const f = this.fig(kind, fam, poses, d, sc, 260), dm = this.art(kind, fam, poses[0], d);
      body = box().child(div().absolute().left(Math.round((sz - dm.w * sc) / 2)).top(sz - dm.h * sc).child(f));
    } else if (o.trot) body = box().child(this.fig("sheep", fam, ["walk1", "walk2"], o.trot, sc, 260));
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
            .child(this.fig("sheep", fam, [pose], dir, sc)));
      }));
    } else {
      const pose = st === "gone" || st === "walk" ? "sit" : st;
      body = box().child(div().absolute().left(0).top(0)
        .when(st === "alert", (el) => el.loop("top", { from: 0, to: -3 * sc, period: 560, easing: "ease-out" }))
        .child(this.fig("sheep", fam, o.poses || [pose], face, sc, o.poses ? 1500 : 500))
        .children(st === "alert" ? [div().absolute().left(face === "l" ? (W0 - 1) * sc : -7 * sc).top(3 * sc)
          .child(spr("bubble-alert", 8, 8, sc))] : []))
        .children(st === "sleep" ? [div().absolute().right(face === "l" ? (W0 - 1) * sc : -7 * sc).top(-sc)
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
    const motion = { duration: act?.at ? this.stage.move : TROT, easing: act?.at ? "linear" : "ease-in-out" };
    return h_flex().id(`sheep-${task.id}`).absolute().left(x).top(y).items_start()
      .transition("left", motion).transition("top", motion)
      .opacity(act?.hide ? 0 : st === "gone" ? 0.45 : 1)
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
    const hs = this.stage, L = layout(), SHP = this.dim("sheep").w;
    const chW = this.cw10 / 10, sz = SHP * sc, szOf = (task) => sz * sizeK(task);
    const at = (x, y, c) => div().absolute().left(x).top(y).child(c);
    const barnX = X(L.barn[0]), barnY = Y(L.barn[1]);
    // Scene points -> screen pixels (see layout()).
    const pt = (q) => (typeof q[0] === "string" ? { x: barnX + q[1] * sc, y: barnY + q[2] * sc } : { x: X(q[0]), y: Y(q[1]) });
    const actors = new Map(); // key -> screen rect of drovers and the dog, for effects and speech bubbles
    const blocks = []; // laid-out rects that speech bubbles must not cover
    const zone = { pen: [], meadow: [], gate: [], past: [], barn: [] };
    for (const k of m ? d.tasks : []) if (k.state !== "dropped") zone[ZONE[k.state] || "meadow"].push(k);
    const ph = this.timeOfDay(), night = ph === "night", wx = this.weather();
    const top = [], glow = []; // above the time-of-day tint: labels, HUD, bubbles, effects / moon, stars, lit window, owl
    const soft = []; // scenery rects bubbles prefer to leave clear
    const empty = !ACTIVE.some((s) => d.tasks.some((x) => m && x.state === s));
    const kids = [
      div().absolute().left(0).right(0).top(0).h(skyH).bg(night ? SKYC.night : wx === "rain" ? "#8b98a4" : wx === "overcast" ? "#aebdc6" : SKYC[ph]),
      div().absolute().left(0).right(0).top(skyH).bottom(0).bg("#6cbb5a"),
      // Measures the font so text-driven walking steps and bubble widths come out in real pixels.
      div().id("char-probe").absolute().left(0).top(-60).text_size(10).whitespace_nowrap().text_color("#00000000").child("MMMMMMMMMM")
        .on_size_change((s, cx) => { if (s.width > 10 && Math.abs(s.width - this.cw10) > 0.5) { this.cw10 = s.width; cx.notify(); } }),
    ];
    // Sky and weather. Hills are far off: drawn one scale smaller, their strip tiles along the horizon.
    const hsc = Math.max(1, Math.min(sc - 1, Math.floor((skyH - 6) / 30)));
    const sunX = W - 16 * sc - 14, sunY = Math.max(3, Math.floor((skyH - 12 * sc - 16 * sc) / 2));
    if (wx === "rainbow" && !night) {
      const rsc = Math.max(1, Math.min(sc, Math.floor((skyH + 6 * hsc) / 32)));
      kids.push(at(Math.round(W * 0.56 - 32 * rsc), skyH - 2 * hsc - 32 * rsc, spr("rainbow", 64, 32, rsc)));
    }
    if (night) glow.push(at(sunX, sunY, spr("moon", 16, 16, sc)));
    for (let x = 0; x < W; x += 256 * hsc) kids.push(at(x, skyH - 40 * hsc, spr("hills", 256, 40, hsc)));
    if (!night && wx !== "rain") kids.push(at(sunX, sunY, spr("sun", 16, 16, sc)));
    kids.push(div().absolute().left(0).right(0).top(skyH).h(sc).bg("#5aa84a"));
    const cloud = (name, x, drift, period) => kids.push(div().absolute().top(Math.max(2, oy + sc)).loop("left", { from: Math.round(x), to: Math.round(x + drift * sc), period, easing: "ease-in-out" })
      .child(spr(name, 16, 16, sc)));
    // Weather keeps to the sky's right corner by the sun, clear of the HUD.
    if (wx === "cloudy") { cloud("cloud", sunX - 12 * sc, 5, 11000); cloud("cloud", sunX - 34 * sc, -4, 14000); }
    if (wx === "overcast") { cloud("cloud", sunX - 3 * sc, -3, 9000); cloud("cloud", sunX - 18 * sc, 4, 12000); cloud("cloud", sunX - 34 * sc, -4, 15000); }
    if (wx === "rain") for (const [f, drift] of [[-2, 3], [-18, -3], [-34, 3]]) {
      const x = Math.round(sunX + f * sc), y = Math.max(2, oy + sc);
      kids.push(div().absolute().top(y).loop("left", { from: x, to: x + drift * sc, period: 10000 })
        .child(spr("cloud-dark", 16, 16, sc))
        .child(div().absolute().left(0).top(8 * sc).child(flip("rain1", "rain2", 16, 16, sc, 300)))
        .child(div().absolute().left(0).top(22 * sc).child(flip("rain2", "rain1", 16, 16, sc, 300))));
    }
    if (night) {
      let ss = hash(`${m?.id || d.project}:stars`) || 1;
      const sr = () => (ss = (ss * 1664525 + 1013904223) >>> 0) / 4294967296;
      for (let i = 0; i < Math.round(W / 60); i++) {
        const x = Math.floor(sr() * (W - 8)), y = 3 + Math.floor(sr() * Math.max(4, skyH - 26 * hsc));
        glow.push(div().absolute().left(x).top(y).loop("opacity", { from: 0.15 + sr() * 0.3, to: 1, period: 1400 + Math.floor(sr() * 2200) }).child(spr("star", 4, 4, Math.max(1, sc - 1))));
      }
    }
    // Decoration in fixed spots, seeded by mission id so it does not jump between polls.
    let seed = hash(m?.id || d.project) || 1;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const dsc = Math.max(2, sc - 1);
    for (let i = 0; i < Math.round(W / 30); i++) {
      const name = ["grass-1", "grass-2", "flower"][Math.floor(rnd() * 3)];
      kids.push(at(Math.floor(rnd() * (W - 8 * dsc)), skyH + 3 * sc + Math.floor(rnd() * Math.max(1, H - skyH - 8 * dsc - 6 * sc)), spr(name, 8, 8, dsc)));
    }
    // HUD in the sky: plan usage meters and sleeping agents.
    const hudY = Math.max(8, Math.floor(skyH / 2) - 16);
    top.push(h_flex().absolute().left(12).top(hudY).right(52 * sc + 20).gap(6).flex_wrap().children(this.hud()));

    // Scenery. A dirt path runs from the pen gate through the meadow and the review gate to the barn door;
    // a fence rings the field and splits off the pen and the review side, with the gates as openings.
    const T = 16 * sc, used = [], dm0 = this.dim("drover"), home0 = pt(L.home), barnBot = barnY + L.barn[3] * sc;
    const tile = (name, x, y) => { kids.push(at(Math.round(x), Math.round(y), spr(name, 16, 16, sc))); used.push({ x, y, w: T, h: T }); };
    const vrun = (name, x, y0, y1) => { for (let y = y0; y < y1 - T; y += T) tile(name, x, y); tile(name, x, y1 - T); };
    const hrun = (name, y, x0, x1) => { for (let x = x0; x < x1 - T; x += T) tile(name, x, y); tile(name, x1 - T, y); };
    const [pgx, pgy] = L.penGate, [rgx, rgy] = L.reviewGate, py = pgy - 16, turn = rgx - 16, door = L.barn[0] + L.barn[2] / 2 - 8;
    vrun("path-v", X(pgx), Y(py) + T, Y(pgy) + T);
    vrun("path-v", X(turn), Y(py) + T, Y(rgy));
    vrun("path-v", X(door), barnBot - 6 * sc, Y(rgy));
    hrun("path-h", Y(py), X(pgx) + T, X(turn));
    hrun("path-h", Y(rgy), X(turn) + T, X(door));
    tile("path-se", X(pgx), Y(py)); tile("path-sw", X(turn), Y(py)); tile("path-ne", X(turn), Y(rgy)); tile("path-nw", X(door), Y(rgy));
    hrun("fence2-h", skyH - 12 * sc, 0, W);
    hrun("fence2-h", H - 12 * sc, 0, W);
    vrun("fence2-v", -6 * sc, home0.y + dm0.h * sc + 18, H - 6 * sc);
    vrun("fence2-v", W - 10 * sc, barnBot, H - 6 * sc);
    vrun("fence2-v", X(92), Y(pgy) + 8 * sc, H - 6 * sc);
    vrun("fence2-v", X(rgx), skyH - 4 * sc, Y(rgy) + 2 * sc);
    vrun("fence2-v", X(rgx), Y(rgy) + 14 * sc, H - 6 * sc);
    // Wooden signposts name the zones (sign-32/48/64 on one post, sign-wide on two; see make_sprites.py).
    // Each picks the narrowest board, then the smallest scale, its label fits on; the text is drawn on the planks.
    const signs = [];
    const sign = (text, x, y, s0 = dsc, xMax = W - 12 * sc) => {
      const ts = s0 >= 3 ? 12 : 10, tw = text.length * chW * ts / 10 * 1.06 + 4;
      let f = { sw: 64, s: s0 + 2 };
      fit: for (let s = s0; s <= s0 + 2; s++) for (const sw of [32, 48, 64]) if ((sw - 4) * s >= tw) { f = { sw, s }; break fit; }
      const r = { text, ts, ...f, w: f.sw * f.s, h: 18 * f.s, y: Math.round(y) };
      r.x = Math.round(Math.min(x, xMax - r.w));
      signs.push(r);
      return r;
    };
    const penMax = 8, meadowMax = 9, gateMax = 6;
    const penSign = sign(`PEN · queued${zone.pen.length > penMax ? ` · +${zone.pen.length - penMax}` : ""}`, X(8), Y(pgy) + 15 * sc);
    const meadowSign = sign(`MEADOW · working${zone.meadow.length > meadowMax ? ` · +${zone.meadow.length - meadowMax}` : ""}`, X(108), skyH + 5 * sc);
    const belowPath = Y(rgy) + T + sc;
    sign(`GATE · review${zone.gate.length > gateMax ? ` · +${zone.gate.length - gateMax}` : ""}`, X(242), belowPath, dsc, X(302));
    const pastSign = sign(`APPROVED${zone.past.length > 2 ? ` · +${zone.past.length - 2}` : ""}`, X(306), belowPath);
    const barnSign = sign(zone.barn.length ? `merged ×${zone.barn.length}` : "barn", X(242), skyH + 5 * sc, dsc, barnX - 2);
    if (empty) {
      const text = !d.missions.length ? "No missions yet. Start one from this project's home to send some sheep out."
        : !m ? "Pick a mission above." : "All sheep home. Start a mission to send some out.";
      const s = Math.max(2, Math.min(sc, Math.floor((X(216) - X(106)) / 96))), w = 96 * s, h = 32 * s;
      const y0 = meadowSign.y + meadowSign.h + sc, y1 = Y(py) + 2 * sc;
      signs.push({ text, wide: true, s, sw: 96, ts: s >= 3 ? 13 : 11, w, h, x: Math.round((X(106) + X(216)) / 2 - w / 2), y: Math.round(Math.max(y0, (y0 + y1) / 2 - h / 2)) });
    }
    // Barnyard, left of the barn above the path: hay bales stacked against the barn wall (one per merge, up to 4)
    // and the merged sheep resting beside them.
    const bh = L.barn[3];
    const hayN = Math.min(4, zone.barn.filter((k) => !this.pendingMerge.has(k.id)).length);
    const hayRects = Array.from({ length: hayN }, (_, i) => ({ x: barnX - (i % 2 + 1) * 13 * sc, y: barnY + (bh - 10) * sc - Math.floor(i / 2) * 9 * sc, w: 12 * sc, h: 10 * sc }));
    // The yard hugs the barn's foot so the merged sheep rest as one small flock, whatever the pane height.
    const yms = Math.max(2, sc - 1) * SHP, barnBot0 = barnY + bh * sc;
    const yard = { x: X(240), y: Math.max(barnSign.y + barnSign.h + sc, barnBot0 - 2 * yms - 4 * sc), w: barnX - 2 * sc - X(240) };
    yard.h = Math.max(SHP, Math.min(Y(rgy) + 2 * sc, barnBot0 + yms) - yard.y);
    // Trees, a pond, bushes and rocks: seeded per mission, kept off the path, fences, signs, anchors, the barnyard and
    // the drover's corner; the flocks below steer clear of them.
    let ds = hash(`${m?.id || d.project}:scenery`) || 1;
    const dr = () => (ds = (ds * 1664525 + 1013904223) >>> 0) / 4294967296;
    const keep = [...used, { x: 0, y: 0, w: W, h: hudY + 26 }, { x: 0, y: home0.y - 6, w: home0.x + dm0.w * sc + 240, h: dm0.h * sc + 24 },
      { x: 0, y: Y(pgy) - 14, w: X(104), h: H }, ...signs, ...hayRects, yard, { x: X(304), y: belowPath, w: W, h: H },
      { x: X(L.barn[0] - 12), y: 0, w: W, h: H },
      { x: X(L.meadow[0]), y: Y(L.meadow[1]), w: X(rgx + 16) - X(L.meadow[0]), h: Y(rgy) - Y(L.meadow[1]) + 30 * sc },
      ...["meadow", "reviewGate", "reviewZone", "dog", "past"].map((k) => { const q = pt(L[k]); return { x: q.x - 4 * sc, y: q.y - 4 * sc, w: 32 * sc, h: 32 * sc }; }),
    ];
    const deco = [];
    const place = (name, w, h, n, y0, y1) => {
      for (let i = 0; i < n; i++) for (let k = 0; k < 40; k++) {
        const r = { x: Math.round(dr() * (W - w * dsc)), y: Math.round(y0 + dr() * Math.max(0, y1 - y0 - h * dsc)), w: w * dsc, h: h * dsc };
        if (keep.some((q) => area(r, q, 2) > 0) || deco.some((q) => area(r, q, 4 * dsc) > 0)) continue;
        deco.push({ ...r, name, sw: w, sh: h });
        break;
      }
    };
    place("tree", 32, 40, 3, skyH + 6, H - 8 * sc);
    place("pond", 48, 24, 1, skyH + 40, H - 8 * sc);
    place("bush", 16, 12, 3, skyH + 10, H - 8 * sc);
    place("rock", 12, 8, 4, skyH + 10, H - 8 * sc);
    deco.sort((a, b) => a.y + a.h - (b.y + b.h));
    for (const r of deco) { kids.push(at(r.x, r.y, spr(r.name, r.sw, r.sh, dsc))); soft.push(r); }
    // Signs stand in the grass behind the sheep; flocks and speech bubbles keep clear of them.
    for (const r of signs) {
      blocks.push(r);
      kids.push(div().absolute().left(r.x).top(r.y).w(r.w).h(r.h)
        .child(spr(r.wide ? "sign-wide" : `sign-${r.sw}`, r.sw, r.wide ? 32 : 18, r.s))
        .child(div().absolute().left(2 * r.s).top(2 * r.s).w((r.sw - 4) * r.s).h((r.wide ? 20 : 9) * r.s).flex().items_center().justify_center()
          .px(r.wide ? 4 * r.s : 0).text_size(r.ts).font_weight(800).text_color("#3b2412")
          .child(div().w_full().text_center().when(r.wide, (el) => el.whitespace_normal()).when(!r.wide, (el) => el.whitespace_nowrap()).child(r.text))));
    }
    const dogP = pt(L.dog), avoid = [...deco, ...signs, { x: dogP.x - 2 * sc, y: dogP.y - 2 * sc, w: 28 * sc, h: 20 * sc + 16 }];
    // Owl perches: tree tops, then the barn roof.
    const perches = [...deco.filter((r) => r.name === "tree").map((r) => ({ x: Math.round(r.x + r.w / 2 - 8 * sc), y: Math.round(r.y + 3 * dsc - 14 * sc) })),
      { x: barnX + 24 * sc, y: barnY - 12 * sc }];

    // Drover (coordinator). Idle behaviour follows its state (working: think / read the scroll, idle: lean on the crook,
    // blocked: alert, out of capacity: doze); a scene can walk it around, or add a second drover (handover).
    const co = d.agents.find((a) => a.role === "coordinator");
    const coTip = co ? `drover · coordinator\n${co.agent || "agent"}${co.model ? ` / ${co.model}` : ""}\nmachine ${co.machine || "—"}\n${co.status}\n${co.msg || ""}`.trim() : "drover (coordinator not connected)";
    const asleep = this.coordAsleep(), dm = this.dim("drover"), coFam = this.famKey(co);
    const droverEl = (key, ao, fam, home) => {
      const idle = co?.status === "gone" ? { poses: ["idle1"] } : asleep ? { poses: ["doze"], zzz: true }
        : co?.status === "blocked" ? { poses: ["idle1", "idle2"], alert: true, period: 700 }
        : co?.status === "working" ? { poses: ["think", "read"], period: 4000 } : { poses: ["lean"] };
      const p = pt(ao?.at || home), w = dm.w * sc, mo = { duration: hs.move, easing: "linear" };
      const poses = ao?.pose ? POSES[ao.pose] || [ao.pose] : idle.poses, calm = !ao?.pose;
      actors.set(key, { x: p.x, y: p.y, w, h: dm.h * sc });
      return this.clickable(v_flex().id(key).absolute().left(p.x).top(p.y).items_center().gap(1).transition("left", mo).transition("top", mo)
        .opacity(co?.status === "gone" ? 0.45 : asleep && calm ? 0.6 : 1).cursor_pointer().on_click((_e, cx) => this.openPanel("coordinator", cx))
        .child(div().relative().child(this.fig("drover", fam, poses, ao?.dir || "r", sc, ao?.pose === "walk" ? 300 : idle.period || 1100))
          .children(calm && idle.alert ? [div().absolute().left(w - 4 * sc).top(0).loop("top", { from: 0, to: -3 * sc, period: 560, easing: "ease-out" }).child(spr("bubble-alert", 8, 8, sc))] : [])
          .children(calm && idle.zzz ? [div().absolute().left(w - 6 * sc).top(-2 * sc).loop("opacity", { from: 0.25, to: 1, period: 1800 }).child(spr("zzz", 8, 8, sc))] : []))
        .child(tag(asleep && calm ? "drover zzz" : "drover")), null, coTip);
    };
    kids.push(droverEl("drover", hs.a.drover, hs.a.drover?.fam || coFam, L.home));
    if (hs.a.drover2) kids.push(droverEl("drover2", hs.a.drover2, hs.a.drover2.fam, L.edge));
    const home = pt(L.home);
    blocks.push({ x: home.x, y: home.y, w: dm.w * sc, h: dm.h * sc + 14 });
    if (!hs.a.drover?.at && !hs.a.drover2) {
      const coLines = wrap(asleep ? "zzz… out of capacity" : co?.msg || (m ? `Mission ${m.state}` : "Resting"), 26, 2);
      const coB = { x: home.x + dm.w * sc + 3 * Math.max(2, sc) + 2, y: home.y, w: bubbleW(coLines, chW), lines: coLines, tail: "left" };
      coB.ty = coB.y + Math.min(bubbleH(coLines) / 2, 5 * sc);
      blocks.push({ x: coB.x, y: coB.y, w: coB.w, h: bubbleH(coLines) });
      top.push(...this.bubble("drover-bubble", coB, sc));
    }

    // Where each sheep stands. Flocks are scattered organically (seeded by task id) inside each zone;
    // working sheep reserve room for their walking path and everyone in the meadow and gate for a bubble.
    const pos = new Map(), sheepOpts = new Map(), talk = [];
    const PATH = 10;
    const rest = Math.max(0, H - Y(AH - 4));
    // Pen (queued).
    kids.push(div().absolute().left(X(4)).top(Y(100)).w(96 * sc).h(Y(AH - 4) - Y(100)).bg("#5aa84a66"));
    for (let i = 0; i < 6; i++) kids.push(at(X(4 + i * 16), Y(pgy), spr(X(4 + i * 16) === X(pgx) ? (hs.gate.pen ? "gate2-open" : "gate2-closed") : "fence2-h", 16, 16, sc)));
    const pen = zone.pen.slice(0, penMax);
    const waitsOf = (task) => (task.depends_on || []).filter((id) => d.tasks.find((x) => x.id === id)?.state !== "merged");
    flock(pen, { x: X(6), y: penSign.y + penSign.h + sc, w: X(98) - X(6), h: Y(AH - 6) - penSign.y - penSign.h - sc + rest },
      (task) => ({ w: Math.max(szOf(task), 50), h: szOf(task) + (waitsOf(task).length ? 30 : 16), top: 0 }), pos, avoid);
    for (const task of pen) {
      const w = waitsOf(task);
      sheepOpts.set(task.id, { sc: sc * sizeK(task), after: w.length ? `after ${w[0]}${w.length > 1 ? "+" : ""}` : "" });
    }

    // Meadow (working) and gate (review): sheep that talk get room for a bubble above them.
    const status = (task) => this.sheepStatus(task, d.agents.find((a) => a.task === task.id && a.role === "worker"));
    const room = 2 * LINE + 14 + 3 * Math.max(2, sc);
    const talker = (task) => {
      const worker = d.agents.find((a) => a.task === task.id && a.role === "worker");
      const st = this.sheepStatus(task, worker);
      return { msg: this.sheepMsg(task, worker, st), st };
    };
    const wakeW = (task) => status(task) === "sleep" && task.alternatives?.length
      ? Math.ceil(`wake: move to ${this.altLabel(task.alternatives[0])}`.length * chW * 0.9) + 14 : 0;
    const foot = (task, maxW) => {
      const walk = status(task) === "walk", w = szOf(task) + (walk ? PATH * sc * sizeK(task) : 0);
      const lines = wrap(talker(task).msg, 26, 2), wk = wakeW(task);
      return { w: Math.max(w, Math.min(maxW, wk + 4), Math.min(maxW, lines.length ? bubbleW(lines, chW) * 0.8 : w)), h: szOf(task) + 16 + (wk ? 20 : 0) + (lines.length ? room : 0), top: lines.length ? room : 0, inner: w, wk };
    };
    const meadow = zone.meadow.slice(0, meadowMax);
    const MR = { x: X(106), y: skyH + 22, w: X(216) - X(106), h: H - 8 - skyH - 22 };
    flock(meadow, MR, (task) => foot(task, MR.w), pos, avoid);
    // Review sheep wait below the path, by the gate and the dog.
    const gate = zone.gate.slice(0, gateMax);
    const GR = { x: X(240), y: belowPath, w: X(302) - X(240), h: Y(AH - 4) - belowPath };
    flock(gate, GR, (task) => foot(task, GR.w), pos, avoid);
    for (const task of [...meadow, ...gate]) {
      sheepOpts.set(task.id, { sc: sc * sizeK(task), path: status(task) === "walk" ? PATH : 0, wake: wakeW(task) });
      const { msg, st } = talker(task);
      if (msg) talk.push({ task, msg, alert: st === "alert" });
    }

    // Gate with the sheepdog (review): the gate opens for the scenes, else while sheep are there.
    const open = hs.gate.rev ?? zone.gate.length + zone.past.length > 0;
    kids.push(at(X(L.reviewGate[0]), Y(L.reviewGate[1]), spr(open ? "gate2-open" : "gate2-closed", 16, 16, sc)));
    // Its reviewer tag (and wag) shows only while a task is in review; otherwise it just sits by the gate.
    const inReview = new Set(d.tasks.filter((k) => k.state === "review").map((k) => k.id));
    const rev = d.agents.filter((a) => a.role === "reviewer" && a.status !== "gone" && inReview.size);
    const dogA = rev.filter((a) => inReview.has(a.task)).pop() || rev.pop() || null;
    const dg = hs.a.dog, dd = this.dim("dog"), dp = pt(dg?.at || L.dog), dmo = { duration: hs.move, easing: "linear" };
    actors.set("dog", { x: dp.x, y: dp.y, w: dd.w * sc, h: dd.h * sc });
    kids.push(this.clickable(v_flex().id("dog").absolute().left(dp.x).top(dp.y).items_center().gap(1).transition("left", dmo).transition("top", dmo)
      .child(this.fig("dog", "other", dg?.pose ? POSES[dg.pose] || [dg.pose] : dogA?.status === "working" ? ["wag1", "wag2"] : ["sit"], dg?.dir || "r", sc, dg?.pose === "run" ? 260 : 600))
      .children(dogA ? [tag(dogA.who)] : []),
      dogA, dogA ? `${dogA.who} · reviewer\n${dogA.agent || "agent"}${dogA.model ? ` / ${dogA.model}` : ""}\nmachine ${dogA.machine || "—"}\n${dogA.status}\n${dogA.msg || ""}`.trim() : "Sheepdog · no reviewer right now"));
    blocks.push({ x: dp.x, y: dp.y, w: dd.w * sc, h: dd.h * sc + 14 }, { x: X(L.reviewGate[0]), y: Y(L.reviewGate[1]), w: 16 * sc, h: 16 * sc });

    // Barn (door opens for the merge scene) with the barnyard beside it; approved sheep wait below the path.
    // The chimney smokes while the mission runs; at night the hayloft window is lit (overlay at 28,14, see make_sprites.py).
    kids.push(div().absolute().left(barnX + 43 * sc).top(barnY + 2 * sc).w(5 * sc).h(8 * sc).bg("#8a3b30").border(1).border_color("#4a1b1c"));
    kids.push(at(barnX, barnY, spr(hs.barn ? "barn2-open" : "barn2-closed", 64, 56, sc)));
    if (m?.state === "running") kids.push(at(barnX + 41 * sc, barnY - 10 * sc, flip3("smoke1", "smoke2", "smoke3", 8, 12, sc, 1800)));
    if (night) glow.push(at(barnX + 28 * sc, barnY + 14 * sc, spr("barn2-window-lit", 8, 8, sc)));
    blocks.push({ x: barnX, y: barnY, w: L.barn[2] * sc, h: bh * sc });
    for (const r of hayRects) kids.push(at(r.x, r.y, spr("hay", 12, 10, sc)));
    // Merged sheep rest in the barnyard, sitting or grazing, in full colour; up to as many as fit.
    const ms = Math.max(2, sc - 1), msz = SHP * ms, fits = Math.max(1, Math.floor(yard.w / (msz + 2)) * Math.max(1, Math.floor(yard.h / (msz + 2))));
    const yardFlock = zone.barn.slice(0, Math.max(3, Math.min(8, fits)));
    flock(yardFlock, yard, () => ({ w: msz, h: msz, top: 0 }), pos, [...hayRects, ...signs]);
    for (const task of yardFlock) sheepOpts.set(task.id, { sc: ms, tag: false, poses: hash(task.id) % 3 ? ["sit"] : ["graze1", "graze2"] });
    // Approved sheep wait under their sign, below the path.
    zone.past.slice(0, 2).forEach((task, i) => {
      const s = SHP * sc * sizeK(task);
      pos.set(task.id, { x: Math.round(Math.min(pastSign.x + i * (s + 4), W - 6 * sc - s)), y: pastSign.y + pastSign.h + 2 });
      sheepOpts.set(task.id, { sc: sc * sizeK(task) });
    });

    // Sheep, noting which ones just changed spot so they trot (facing their way) instead of sliding.
    const now = Date.now();
    if (now >= this.trotUntil) this.trot.clear();
    const sheepRects = new Map();
    if (this.size) for (const [id, p0] of pos) {
      const task = d.tasks.find((k) => k.id === id), o = sheepOpts.get(id), act = hs.a[`s:${id}`];
      if ((this.pending.has(id) || this.pendingMerge.has(id)) && !act) continue; // not arrived yet: its scene brings it
      const p = act?.at ? pt(act.at) : p0, prev = this.pos.get(id);
      if (!act?.at && prev && now < this.trotUntil && Math.hypot(p.x - prev.x, p.y - prev.y) > 4) this.trot.set(id, p.x < prev.x ? "l" : "r");
      this.pos.set(id, p);
      kids.push(this.sheep(t, task, p.x, p.y, { ...o, trot: act?.at ? undefined : this.trot.get(id), act }));
      const s = SHP * o.sc;
      sheepRects.set(id, { x: p.x, y: p.y, w: s + (o.path || 0) * o.sc, h: s + (o.tag === false ? 0 : 15), sp: s });
      // Its wake button blocks bubbles (the sheep's own included) like a label.
      const wk = o.wake && !act?.pose ? o.wake : 0;
      if (wk) blocks.push({ x: p.x + s / 2 - wk / 2, y: p.y + s + 15, w: wk, h: 18 });
    }

    // Speech bubbles: up to two wrapped lines, placed so they never cover each other, labels or other sheep.
    const p = Math.max(2, sc), tailH = 3 * p + 1;
    const placed = [];
    const cost = (r, own) => {
      if (r.x < 4 || r.x + r.w > W - 4 || r.y < skyH + 4 || r.y + r.h > H - 4) return Infinity;
      let c = 0;
      for (const b of [...blocks, ...placed]) c += 1000 * area(r, b, 2);
      for (const [id, s] of sheepRects) if (id !== own) c += 3 * area(r, s, 1);
      for (const q of soft) c += area(r, q, 0);
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
      if (!S || this.trot.has(task.id) || hs.a[`s:${task.id}`]?.at || hs.a[`s:${task.id}`]?.msg) continue; // the bubble waits until the sheep has arrived
      const S2 = { ...S, h: S.sp };
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
      top.push(...this.bubble(`bubble-${task.id}`, { ...b, lines, alert }, sc));
    }
    if (full) top.push(...this.bubble("bubble-full", full, sc, true));

    // Scene effects float up from an actor or a spot; scene speech bubbles sit above their speaker.
    for (const f of hs.fx) {
      const r = f.on ? (f.on.startsWith("s:") ? sheepRects.get(f.on.slice(2)) : actors.get(f.on)) : null;
      const q = f.at ? pt(f.at) : r ? { x: r.x + (r.sp || r.w) / 2 - 4 * sc, y: r.y - 8 * sc } : null;
      if (q) top.push(div().absolute().left(Math.round(q.x)).top(Math.round(q.y))
        .loop("top", { from: Math.round(q.y), to: Math.round(q.y - 8 * sc), period: 900, easing: "ease-out" }).child(this.fxEl(f.k, sc)));
    }
    for (const [key, a] of Object.entries(hs.a)) {
      const r = a.msg ? (key.startsWith("s:") ? sheepRects.get(key.slice(2)) : actors.get(key)) : null;
      if (!r) continue;
      const lines = wrap(a.msg, 22, 2), bw = bubbleW(lines, chW), bh = bubbleH(lines), mid = r.x + (r.sp || r.w) / 2;
      const x = Math.round(Math.max(4, Math.min(W - bw - 4, mid - bw / 2)));
      top.push(...this.bubble(`say-${key}`, { x, y: Math.max(4, r.y - tailH - bh), w: bw, lines, tail: "down", stalk: 0,
        tx: Math.max(x + 6 + 3 * p, Math.min(x + bw - 6 - 3 * p, mid)) }, sc, true));
    }

    return div().id("pasture").relative().w_full().when(fill, (el) => el.flex_1().min_h(AH * 2)).when(!fill, (el) => el.flex_none().h(H))
      .rounded(12).overflow_hidden().border(1).border_color(t.border)
      .on_size_change((s, cx) => {
        if (fill ? Math.abs(s.width - (this.size?.width || 0)) + Math.abs(s.height - (this.size?.height || 0)) > 2
          : Math.abs(s.width - (this.size?.width || 0)) > 2) { this.size = fill ? s : { width: s.width, height: this.size?.height || s.height }; cx.notify(); }
      })
      .children([...kids, ...(TINT[ph] ? [div().absolute().left(0).right(0).top(0).bottom(0).bg(TINT[ph])] : []), ...glow, ...this.owlEl(night, perches, W, skyH, sc), ...top]);
  }

  // The owl at night (see owlStep): off the left edge, flying in, perched, or flying off to the right.
  owlEl(night, perches, W, skyH, sc) {
    const o = this.owl;
    if (!night || !o) return [];
    const tgt = perches[o.n % perches.length], fly = o.st === "in" || o.st === "out";
    const p = o.st === "away" ? { x: -24 * sc, y: Math.round(skyH * 0.3) } : o.st === "out" ? { x: W + 8 * sc, y: Math.round(skyH * 0.1) } : tgt;
    const mo = { duration: fly ? OWL_FLY : 0, easing: "ease-in-out" };
    return [div().id("owl").absolute().left(p.x).top(p.y).transition("left", mo).transition("top", mo).tooltip("Night owl")
      .child(o.st === "perch" ? spr("owl-perch", 16, 16, sc) : flip("owl-fly1", "owl-fly3", 16, 16, sc, 280))];
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
