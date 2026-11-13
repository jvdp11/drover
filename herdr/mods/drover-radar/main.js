// drover radar: the right-hand column. Top: every machine as a compact tile
// (ring gauge for load, sparkline, role, agent slots). Below: every agent
// on every machine as a live card (tool, role, task, machine, how long),
// glowing while it works and red when it needs you, then a short log of
// what just happened. Polls `drover status` gently and samples load with a
// cheap `uptime` per machine; agents come live from Herdr.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, terminals, theme, run, setShared, openOverlay, panes, spaces } from "herdr";
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


const POLL_MS = 60_000;
const SAMPLE_MS = 15_000;
const SPARK = 20;
const LOG = 6;
const RING = ["○", "◔", "◑", "◕", "●"];
const OS_GLYPH = { Linux: "", Darwin: "" };
const RANK = { blocked: 4, error: 4, working: 3, done: 2, idle: 1 };
const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

function loadColor(t, frac) {
  return frac > 0.8 ? t.blocked : frac > 0.5 ? (t.ansi3 ?? t.done) : (t.ansi2 ?? t.working);
}

function statusColor(t, s) {
  return { working: t.working, blocked: t.blocked, error: t.blocked, done: t.done, idle: t.idle }[s] ?? t.dim;
}

function section(t, title, right) {
  return h_flex().px(14).pt(14).pb(8).items_center()
    .child(div().flex_1().text_size(10).font_semibold().text_color(t.dim).child(title))
    .children(right ? [right] : []);
}

export default class Radar extends View {
  init(_props, cx) {
    this.data = null;
    this.error = null;
    this.hist = {};
    this.live = {};
    this.prev = new Map();   // address -> last status, for the log
    this.since = new Map();  // address -> when its status last changed
    this.log = [];
    this.refresh(cx, false);
    cx.timer.every(POLL_MS, (cx) => this.refresh(cx, false));
    cx.timer.every(SAMPLE_MS, (cx) => this.sample(cx));
  }

  refresh(cx, probe) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", probe ? ["status", "--json", "--max-age", "0"] : ["status", "--json"], { timeout: 120_000 });
        if (r.code !== 0) throw new Error(r.stderr.trim() || `drover exited ${r.code}`);
        const first = !this.data;
        this.data = JSON.parse(r.stdout);
        this.error = null;
        setShared("drover.status", this.data);
        if (first) this.sample(cx);
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  sample(cx) {
    const local = this.data?.local;
    for (const m of this.data?.machines ?? []) {
      if (!m.online) continue;
      cx.spawn(async (cx) => {
        const r = await exec("uptime", [], { on: m.name === local ? null : m.name, timeout: 10_000 }).catch(() => null);
        const hit = r?.stdout?.match(/load averages?:\s*([\d.]+)/);
        if (!hit) return;
        const v = parseFloat(hit[1]);
        this.live[m.name] = v;
        (this.hist[m.name] ??= []).push(v);
        if (this.hist[m.name].length > SPARK) this.hist[m.name].shift();
        setShared("drover.load", this.live);
        cx.notify();
      });
    }
  }

  // Every live agent on every machine: Herdr's agents plus drover's labelled ones.
  agentList() {
    const local = this.data?.local;
    const out = [];
    for (const term of terminals()) {
      if (term.state === "finished") continue;
      const lb = term.labels ?? {};
      if (!term.program?.agent && !lb["drover.role"]) continue;
      const status = term.status || "idle";
      const was = this.prev.get(term.address);
      if (was !== status) {
        this.since.set(term.address, Date.now());
        // Log meaningful changes, not the first sighting.
        if (was && (status === "blocked" || status === "done" || status === "error" || (was === "idle" && status === "working"))) {
          const verb = { blocked: "needs you", error: "hit an error", done: "finished", working: "started" }[status];
          this.log.unshift({ at: Date.now(), status, text: `${term.program?.name ?? "agent"} ${verb}`, task: lb["drover.task"] ?? term.title ?? "" });
          this.log.length = Math.min(this.log.length, LOG);
        }
        this.prev.set(term.address, status);
      }
      out.push({
        address: term.address, machine: machineOf(term.address) ?? local, status, program: term.program,
        role: lb["drover.role"] ?? null, task: lb["drover.task"] ?? term.title ?? "", model: lb["drover.model"] || null,
        since: this.since.get(term.address) ?? Date.now(),
      });
    }
    out.sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0) || a.since - b.since);
    return out;
  }

  spark(t, m) {
    const h = this.hist[m.name] ?? [];
    const cpus = Math.max(m.cpus ?? 1, 1);
    const scale = Math.max(cpus / 2, ...h, 0.5);
    const bars = Array.from({ length: SPARK }, (_, i) => h[i - (SPARK - h.length)]);
    return h_flex().h(16).gap(1).items_end().children(bars.map((v, i) => v == null
      ? div().w(2).h(1).bg(t.border)
      : div().w(2).h(Math.max(2, Math.round(16 * Math.min(1, v / scale)))).rounded(1)
          .bg(loadColor(t, v / cpus)).opacity(0.35 + 0.65 * (i / SPARK)).transition("height", { duration: 500, easing: "ease-out" })));
  }

  machine(t, m, count) {
    const s = m.settings ?? {};
    const load = this.live[m.name] ?? m.load ?? 0;
    const frac = Math.min(1, load / Math.max(m.cpus ?? 1, 1));
    const cockpit = s.enabled === false;
    const max = s.max_agents ?? 0;
    return h_flex().id(`m-${m.name}`).mx(10).mb(6).px(10).py(8).gap(10).items_center().rounded(8)
      .bg(t.surface).border(1).border_color(count ? `${t.accent}66` : t.border)
      .tooltip(m.online ? `${m.name} · ${cockpit ? "cockpit" : s.durable ? "durable host" : "worker"}\n${m.cpus} cpu · ${Math.round(m.mem_gb ?? 0)} GB · ${m.disk_free_gb} GB free · ${m.power}\n${(m.tools ?? []).join(" ")}`
        : `${m.name}: ${m.error ?? "offline"}`)
      .opacity(m.online ? 1 : 0.5)
      // Ring gauge: load per CPU in quarters.
      .child(div().w(22).text_size(20).text_color(m.online ? loadColor(t, frac) : t.dim).child(m.online ? RING[Math.round(frac * 4)] : "○"))
      .child(v_flex().flex_1().min_w(0).gap(3)
        .child(h_flex().gap(6).items_center()
          .child(div().text_size(11).text_color(t.dim).child(OS_GLYPH[m.os] ?? ""))
          .child(div().text_size(12).font_semibold().text_color(t.foreground).truncate().child(m.name))
          .child(div().flex_1())
          .child(div().text_size(9).font_semibold().text_color(cockpit ? t.dim : s.durable ? t.accent : t.muted)
            .child(cockpit ? "COCKPIT" : s.durable ? "DURABLE" : "WORKER")))
        .child(h_flex().gap(8).items_center()
          .child(m.online ? this.spark(t, m) : div().text_size(10).text_color(t.dim).child(m.error ?? "offline"))
          .children(m.online ? [div().text_size(10).text_color(t.muted).child(load.toFixed(1))] : [])
          .child(div().flex_1())
          .children(m.online && !cockpit ? [h_flex().gap(2).children(Array.from({ length: Math.min(max, 8) }, (_, i) =>
            div().w(4).h(8).rounded(1).bg(i < count ? t.accent : t.border)))] : [])));
  }

  agent(t, a) {
    const c = statusColor(t, a.status);
    const hot = a.status === "working" || a.status === "blocked" || a.status === "error";
    const icon = a.program?.icon ? (a.program.tint ? svg(a.program.icon).text_color(a.program.color ?? t.foreground) : image(a.program.icon)) : null;
    return h_flex().id(`a-${a.address}`).mx(10).mb(6).gap(10).items_start().px(10).py(8).rounded(8).cursor_pointer()
      .bg(t.surface).border(1).border_color(hot ? `${c}88` : t.border)
      .when(hot, (el) => el.shadow_sm())
      .hover((s) => s.bg(t.hover))
      .tooltip(`Show ${a.address}'s terminal\n${a.address}${a.model ? " · " + a.model : ""}\n${a.task}`)
      .on_click(() => showTerminal(a.address))
      .child(div().relative().w(26).h(26).flex_none().flex().items_center().justify_center().rounded(7)
        .bg(a.program?.tile ?? t.raised)
        .children(icon ? [icon.w(16).h(16)] : [div().text_size(11).text_color(t.foreground).child("•")])
        .child(div().absolute().bottom(-3).right(-3).w(10).h(10).rounded(5).bg(c).border(2).border_color(t.surface)
          .when(hot, (el) => el.loop("opacity", { from: 0.35, to: 1, period: a.status === "working" ? 1200 : 700 }))))
      .child(v_flex().flex_1().min_w(0).gap(2)
        .child(h_flex().gap(6).items_center()
          .child(div().text_size(12).font_semibold().text_color(t.foreground).truncate().child(a.program?.name ?? "agent"))
          .children(a.role ? [div().px(5).rounded(4).bg(`${t.accent}22`).text_size(9).font_semibold().text_color(t.accent).child(a.role.toUpperCase())] : [])
          .child(div().flex_1())
          .child(div().text_size(10).text_color(t.dim).child(ago(a.since))))
        .child(div().text_size(11).text_color(t.muted).truncate().child(a.task || "—"))
        .child(div().text_size(10).text_color(t.dim).child(`${a.machine ?? ""}${a.status === "blocked" ? " · needs you" : ""}`)));
  }

  render() {
    const t = theme();
    const agents = this.agentList();
    const per = {};
    for (const a of agents) if (a.role) per[a.machine] = (per[a.machine] ?? 0) + 1;
    const refresh = div().id("probe").px(6).py(2).rounded(4).cursor_pointer().text_size(10).text_color(t.dim)
      .hover((s) => s.bg(t.hover)).tooltip("Probe every machine now").on_click((_e, cx) => this.refresh(cx, true)).child("↻");
    return v_flex().id("root").size_full().bg(t.chrome).overflow_y_scrollbar()
      .child(section(t, "RADAR", refresh))
      .children(this.error ? [div().mx(14).text_size(11).text_color(t.blocked).child(this.error)] : [])
      .children(!this.data && !this.error ? [div().mx(14).text_size(11).text_color(t.dim).child("Asking the machines…")] : [])
      .children((this.data?.machines ?? []).map((m) => this.machine(t, m, per[m.name] ?? 0)))
      .child(section(t, "ACTIVITY", div().text_size(10).text_color(t.dim).child(agents.length ? String(agents.length) : "")))
      .children(agents.length ? agents.map((a) => this.agent(t, a))
        : [v_flex().mx(10).px(12).py(14).gap(6).rounded(8).border(1).border_color(t.border).items_center()
            .child(div().text_size(18).text_color(t.dim).child("◇"))
            .child(div().text_size(11).text_color(t.dim).child("No agents running"))
            .child(div().id("start").px(10).py(4).rounded(6).cursor_pointer().bg(`${t.accent}22`).text_size(11).text_color(t.accent)
              .hover((s) => s.bg(`${t.accent}44`))
              .on_click(() => openOverlay({ mod: "drover-projects", kind: "dialog", width: 640, height: 560 }))
              .child("Open a project"))])
      .children(this.log.length ? [section(t, "JUST NOW", null)] : [])
      .children(this.log.map((e, i) => h_flex().id(`log-${i}`).mx(14).mb(5).gap(8).items_center().text_size(11)
        .child(div().w(6).h(6).rounded(3).bg(statusColor(t, e.status)))
        .child(div().text_color(t.muted).flex_none().child(e.text))
        .child(div().flex_1().text_color(t.dim).truncate().child(e.task))
        .child(div().text_color(t.dim).child(ago(e.at)))))
      .child(div().h(10));
  }
}
