// drover rail: the narrow left column. Projects (Herdr spaces) as coloured
// avatars with a status dot that glows while agents work and turns red when
// one needs you; + opens the project picker; the gear opens settings.

import { View, div, svg } from "gpui-kit";
import { v_flex } from "gpui-base";
import { spaces, agents, theme, run, openOverlay, shared, setShared, home, panes } from "herdr";
// The project's pasture as its own tab: one per space, found again by its name (only that tab is ever selected).
// A reused tab gets the asked-for mission through shared "drover.pasture.pick".
function openPasture(s, folder, name, extra = {}) {
  const tab = s.tabs?.find((tb) => tb.name === "pasture" && tb.named);
  if (tab) {
    if (!s.active) run("space.select", { id: s.id });
    if (!tab.active) run("tab.select", { id: tab.id });
    if (extra.mission || extra.showArchived) setShared("drover.pasture.pick", { folder, ...extra, at: Date.now() });
    return;
  }
  run("tab.new", { name: "pasture", space: s.id, mod: "drover-dashboard", props: { space: s.id, folder, name, ...extra } });
}
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


// A stable colour per project from the theme's ANSI colours.
function hue(t, name) {
  const pool = [t.ansi4, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi1, t.ansi12, t.ansi13];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length] ?? t.accent;
}

const initials = (name) => {
  const parts = name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "~") + (parts[1]?.[0] ?? parts[0]?.[1] ?? "")).toUpperCase();
};

export default class Rail extends View {
  icon(t, id, path, tip, fn) {
    return div().id(id).w(36).h(36).flex().items_center().justify_center().rounded(8).cursor_pointer()
      .tooltip(tip).hover((s) => s.bg(t.hover)).on_click(fn)
      .child(svg(path).size(16).text_color(t.muted));
  }

  // Folders drover knows as projects (from `drover status`, shared by the radar).
  known() {
    const projects = shared("drover.status")?.config?.projects ?? {};
    return new Set(Object.values(projects).map((p) => p.path.replace(/^~(?=\/|$)/, home())));
  }

  avatar(t, s, known) {
    const c = hue(t, s.name);
    const blocked = agents().find((a) => a.space === s.id && a.status === "blocked");
    const drover = !s.machine && known.has(s.folder);
    const project = s.folder && s.folder !== home() && !s.machine;
    const dot = s.status === "blocked" ? t.blocked : s.status === "working" ? t.working : s.status === "done" ? t.done : null;
    return div().id(`sp-${s.id}`).w(52).h(44).flex().items_center().justify_center().cursor_pointer()
      .tooltip(`${s.name}${s.machine ? " · " + s.machine : ""}${s.branch ? " · " + s.branch : ""}${drover ? "\ndrover project" : ""}${project ? "\nRight-click to open dashboard" : ""}`)
      .on_click(() => run("space.select", { id: s.id }))
      .when(project, (el) => el.on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        openPasture(s, s.folder, s.name);
      }))
      // The active project gets a bar on the rail's edge, like a selected tab.
      .child(div().w(3).h(s.active ? 22 : 0).rounded(2).bg(t.accent).spring("height", { response: 260, damping: 0.8 }))
      .child(div().w(6))
      .child(div().relative().w(36).h(36).flex().items_center().justify_center().rounded(10)
        .bg(s.active ? c : `${c}2e`).border(1).border_color(s.active ? c : `${c}55`)
        .hover((st) => st.bg(`${c}55`))
        .child(div().text_size(12).font_semibold().text_color(s.active ? t.background : c).child(initials(s.name)))
        .children(dot ? [div().id(`attention-${s.id}`).absolute().top(-2).right(-2).w(10).h(10).rounded(5).bg(dot).border(2).border_color(t.chrome)
          .when(s.status === "blocked" && !!blocked, (el) => el.cursor_pointer()
            .tooltip(`Show ${blocked.address}'s terminal (${blocked.program?.name || "agent"})`)
            .hover((st) => st.border_color(t.foreground))
            .on_click((_e, cx) => { cx.stop_propagation(); showTerminal(blocked.address); }))
          .when(s.status === "working" || s.status === "blocked", (el) => el.loop("opacity", { from: 0.35, to: 1, period: s.status === "blocked" ? 700 : 1200 }))] : [])
        // drover's horns on projects it knows.
        .children(drover ? [div().absolute().bottom(-4).left(-4).w(16).h(16).rounded(8).flex().items_center().justify_center()
          .bg(t.accent).border(2).border_color(t.chrome)
          .child(svg("mods/drover-rail/horns.svg").size(10).text_color(t.accent_foreground))] : []))
      .child(div().w(7));
  }

  render() {
    const t = theme();
    return v_flex().id("root").size_full().bg(t.chrome).items_center().py(10).gap(4)
      .child(div().id("brand").w(38).h(38).mb(8).flex().items_center().justify_center().rounded(11)
        .bg(t.accent).shadow_md().tooltip("drover")
        .child(svg("mods/drover-rail/drover.svg").size(24).text_color(t.accent_foreground)))
      .children((() => { const known = this.known(); return spaces().map((s) => this.avatar(t, s, known)); })())
      .child(this.icon(t, "new", "mods/workspace-chrome/plus.svg", "Open or create a project",
        () => openOverlay({ mod: "drover-projects", kind: "dialog", width: 640, height: 560 })))
      .child(div().flex_1())
      .child(this.icon(t, "settings", "mods/workspace-chrome/settings.svg", "drover settings",
        () => openOverlay({ mod: "drover-settings", kind: "dialog", width: 720, height: 640 })));
  }
}
