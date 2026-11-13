// drover strip: one slim line under the terminals. The shown project and
// branch; what the swarm is doing (needs you / working / done, pulsing);
// the whole fleet's load; the clock.

import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, terminals, shared, theme, openOverlay, home, exec, nextCommand, run, panes } from "herdr";
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


const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const pad = (n) => String(n).padStart(2, "0");

export default class Strip extends View {
  init(_props, cx) {
    this.now = new Date();
    this.running = new Set();
    this.blockedSince = new Map();
    this.cycles = {};
    this.loadMissions(cx);
    cx.timer.every(15_000, (cx) => { this.now = new Date(); this.loadMissions(cx); cx.notify(); });
    cx.spawn(async () => {
      for (;;) {
        if (await nextCommand() === "dashboard") this.dashboard(spaces().find((s) => s.active));
      }
    });
  }

  dashboard(s) {
    if (!s?.folder || s.folder === home() || s.machine) return;
    // Herdr exposes no live overlay list; remembering an id would go stale after Esc.
    openOverlay({ mod: "drover-dashboard", kind: "dialog", width: 1120, height: 760,
      props: { space: s.id, folder: s.folder, name: s.name } });
  }

  loadMissions(cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", ["mission", "list", "--json"]);
        this.running = new Set((r.code === 0 ? JSON.parse(r.stdout).missions : [])
          .filter((m) => m.state === "running" || m.state === "starting").map((m) => m.repo));
      } catch (_) { this.running = new Set(); }
      cx.notify();
    });
  }

  blockedAgents(live) {
    const blocked = live.filter((a) => a.status === "blocked" || a.status === "error");
    const addresses = new Set(blocked.map((a) => a.address));
    for (const address of this.blockedSince.keys()) if (!addresses.has(address)) this.blockedSince.delete(address);
    for (const a of blocked) {
      if (!this.blockedSince.has(a.address)) this.blockedSince.set(a.address, Date.now());
    }
    const since = (a) => Number(a.status_ms) || this.blockedSince.get(a.address);
    return blocked.sort((a, b) => since(a) - since(b) || a.address.localeCompare(b.address));
  }

  attention(el, t, list, key) {
    const signature = list.map((a) => a.address).join("|");
    if (this.cycles[key]?.signature !== signature) this.cycles[key] = { signature, index: 0 };
    const cycle = this.cycles[key];
    const a = list[cycle.index % list.length];
    return el.cursor_pointer().hover((s) => s.bg(t.hover))
      .tooltip(`Show ${a.address}'s terminal (${a.program?.name || "agent"})${list.length > 1 ? " · click again for the next blocked agent" : ""}`)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        showTerminal(list[cycle.index % list.length].address);
        cycle.index = (cycle.index + 1) % list.length;
        cx.notify();
      });
  }

  render() {
    const t = theme();
    const s = spaces().find((x) => x.active);
    const live = terminals().filter((x) => x.state !== "finished" && (x.program?.agent || x.labels?.["drover.role"]));
    // Core space labels are machine-local; don't count a remote space with the same id.
    const blockedAgents = this.blockedAgents(live);
    const projectBlocked = blockedAgents.filter((x) => x.labels?.["drover.role"]
      && x.labels?.["herdr.space"] === s?.id && !x.address?.includes("/"));
    const needsYou = projectBlocked.length;
    const n = (st) => live.filter((x) => (x.status || "idle") === st || (st === "blocked" && x.status === "error")).length;
    const blocked = blockedAgents.length, working = n("working"), done = n("done");
    const status = shared("drover.status");
    const load = shared("drover.load") ?? {};
    const cpus = (status?.machines ?? []).filter((m) => m.online && m.settings?.enabled !== false)
      .reduce((sum, m) => sum + (m.cpus ?? 0), 0);
    const used = (status?.machines ?? []).filter((m) => m.online && m.settings?.enabled !== false)
      .reduce((sum, m) => sum + (load[m.name] ?? m.load ?? 0), 0);
    const frac = cpus ? Math.min(1, used / cpus) : 0;
    const chip = (count, color, label, pulse) => count ? [h_flex().gap(5).items_center().rounded(4)
      .when(label === "need you", (el) => this.attention(el.id("need-you"), t, blockedAgents, "fleet"))
      .child(div().w(6).h(6).rounded(3).bg(color).when(pulse, (el) => el.loop("opacity", { from: 0.3, to: 1, period: 1000 })))
      .child(div().text_color(t.foreground).child(`${count} ${label}`))] : [];
    return h_flex().id("root").size_full().px(12).gap(14).items_center().bg(t.chrome).text_size(11).text_color(t.muted)
      .children(s ? [h_flex().gap(6).items_center()
        .child(div().font_semibold().text_color(t.foreground).child(s.name))
        .children(s.branch ? [h_flex().gap(4).items_center()
          .child(svg("mods/workspace-chrome/git-branch.svg").size(11).text_color(t.dim)).child(s.branch)] : [])
        // A project space (in a folder that isn't home) can start a mission.
        .children(s.folder && s.folder !== home() && !s.machine ? [h_flex().id("mission").gap(5).items_center().px(8).py(2).rounded(6)
          .cursor_pointer().bg(`${t.accent}22`).text_color(t.accent).hover((st) => st.bg(`${t.accent}44`))
          .tooltip("Start a mission in this project")
          .on_click(() => openOverlay({ mod: "drover-mission", kind: "dialog", width: 600, height: 380,
            props: { space: s.id, folder: s.folder, name: s.name } }))
          .child(svg("mods/drover-rail/drover.svg").size(12).text_color(t.accent))
          .child(div().font_semibold().child("Mission")),
          h_flex().id("dashboard").gap(5).items_center().px(8).py(2).rounded(6)
            .cursor_pointer().bg(`${t.accent}14`).text_color(t.accent).hover((st) => st.bg(`${t.accent}33`))
            .tooltip(`Open mission dashboard${needsYou ? ` · ${needsYou} need you` : ""} · Esc to close`)
            .on_click(() => this.dashboard(s))
            .child(svg("mods/drover-rail/horns.svg").size(12).text_color(t.accent)
              .when(this.running.has(s.folder), (el) => el.loop("opacity", { from: 0.45, to: 1, period: 1600 })))
            .child(div().font_semibold().child("Dashboard"))
            .children(needsYou ? [div().id("dashboard-blocked").px(4).rounded(6).bg(t.blocked).text_color(t.background)
              .when(true, (el) => this.attention(el, t, projectBlocked, "dashboard"))
              .font_semibold().child(String(needsYou))] : [])] : [])] : [])
      .child(div().flex_1())
      .children(chip(blocked, t.blocked, "need you", true))
      .children(working ? [h_flex().gap(5).items_center()
        .child(div().text_color(t.working).frames(SPIN, 80))
        .child(div().text_color(t.foreground).child(`${working} working`))] : [])
      .children(chip(done, t.done, "done", false))
      .children(live.length ? [] : [div().text_color(t.dim).child("swarm idle")])
      .child(div().w(1).h(12).bg(t.border))
      .child(h_flex().gap(6).items_center().tooltip(`fleet load ${used.toFixed(1)} on ${cpus} cpu`)
        .child(div().text_color(t.dim).child("fleet"))
        .child(div().w(50).h(4).rounded(2).bg(t.border)
          .child(div().h(4).rounded(2).w(Math.max(2, Math.round(50 * frac)))
            .bg(frac > 0.8 ? t.blocked : frac > 0.5 ? (t.ansi3 ?? t.done) : (t.ansi2 ?? t.working))
            .transition("width", { duration: 700, easing: "ease-out" }))))
      .child(div().w(1).h(12).bg(t.border))
      .child(div().font_semibold().text_color(t.foreground).child(`${pad(this.now.getHours())}:${pad(this.now.getMinutes())}`));
  }
}
