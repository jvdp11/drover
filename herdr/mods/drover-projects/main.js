// drover projects: open a project (known ones first, then git repos found
// under ~/Work), start a new one (git init, optionally a GitHub repo) or
// clone one. Opening selects its Herdr space, or makes one in its folder.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, spaces, run, theme, props, closeOverlay, notify } from "herdr";

const TABS = ["Open", "New", "Clone"];
const GITHUB = [["none", "No GitHub"], ["private", "Private repo"], ["public", "Public repo"]];

function ago(ts) {
  if (!ts) return "";
  const m = Math.floor((Date.now() / 1000 - ts) / 60);
  if (m < 60) return `${Math.max(m, 1)}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

export default class Projects extends View {
  init(_props, cx) {
    this.tab = "Open";
    this.rows = null;
    this.error = null;
    this.busy = false;
    this.sel = 0;
    this.github = "private";
    this.dir = "~/Work";
    this.query = InputState.new({ placeholder: "Search projects" });
    this.query.on("change", (_e, cx) => { this.sel = 0; cx.notify(); });
    this.query.on("submit", (_e, cx) => { const r = this.filtered()[this.sel]; if (r) this.open(r, cx); });
    this.name = InputState.new({ placeholder: "my-new-project" });
    this.url = InputState.new({ placeholder: "https://github.com/owner/repo or git@github.com:owner/repo" });
    this.query.focus();
    cx.timer.after(300, () => this.query.focus());
    this.handle = cx.focus_handle();
    cx.spawn(async (cx) => {
      const r = await exec("drover", ["project", "list", "--json"]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code === 0) this.rows = JSON.parse(r.stdout).projects;
      else this.error = r.stderr.trim();
      cx.notify();
    });
  }

  filtered() {
    const q = (this.query.value() ?? "").toLowerCase().trim();
    return (this.rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q));
  }

  // Folders new projects can go in: ~/Work and the parents of known repos.
  dirs() {
    const set = new Set(["~/Work"]);
    for (const r of this.rows ?? []) set.add(r.path.replace(/\/[^/]+$/, ""));
    return [...set].slice(0, 6);
  }

  // Select the space already in that folder, else make one there.
  show(name, abs) {
    const existing = spaces().find((s) => s.folder === abs && !s.machine);
    if (existing) run("space.select", { id: existing.id });
    else {
      // A new project space opens on its drover home, with a shell beside it.
      run("space.new", { name, folder: abs, tab: "shell" });
      run("tab.new", { name: "home", mod: "drover-project", props: { folder: abs, name } });
    }
    closeOverlay(props().overlay);
  }

  open(r, cx) {
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    cx.spawn(async (cx) => {
      const args = r.known ? ["project", "open", r.name, "--json"] : ["project", "add", r.path, "--json"];
      const res = await exec("drover", args).catch((e) => ({ code: 1, stderr: String(e) }));
      this.busy = false;
      if (res.code !== 0) { this.error = res.stderr.trim(); cx.notify(); return; }
      const p = JSON.parse(res.stdout);
      this.show(p.name, p.abs);
    });
  }

  create(cx, clone) {
    const name = clone ? (this.url.value() ?? "").trim().replace(/\.git$/, "").split(/[/:]/).pop() : (this.name.value() ?? "").trim();
    if (!name || this.busy) { this.error = clone ? "Paste a repository URL" : "Give it a name"; cx.notify(); return; }
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const args = ["project", "new", name, "--dir", this.dir, "--json"];
      if (clone) args.push("--clone", this.url.value().trim());
      else args.push("--github", this.github);
      const res = await exec("drover", args, { timeout: 180_000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      this.busy = false;
      if (res.code !== 0) { this.error = res.stderr.trim(); cx.notify(); return; }
      const p = JSON.parse(res.stdout);
      if (res.stderr.trim()) notify({ title: "drover", body: res.stderr.trim(), level: "warning" });
      this.show(p.name, p.abs);
    });
  }

  key(e, cx) {
    if (e.key === "escape") { closeOverlay(props().overlay); cx.stop_propagation(); return; }
    if (this.tab !== "Open") return;
    const n = this.filtered().length;
    if (e.key === "down") { this.sel = Math.min(n - 1, this.sel + 1); cx.notify(); cx.stop_propagation(); }
    if (e.key === "up") { this.sel = Math.max(0, this.sel - 1); cx.notify(); cx.stop_propagation(); }
  }

  input(t, state) {
    return Input.new(state).h(36).px(10).border(1).border_color(t.input).bg(t.background).text_size(13).text_color(t.foreground);
  }

  chips(t, id, options, value, set) {
    return h_flex().gap(6).flex_wrap().children(options.map(([v, label]) =>
      div().id(`${id}-${v}`).px(10).py(4).cursor_pointer().text_size(12).border(1)
        .border_color(v === value ? t.accent : t.border).text_color(v === value ? t.foreground : t.muted)
        .bg(v === value ? t.selected : t.popover).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { set(v); cx.notify(); }).child(label)));
  }

  label(t, text) {
    return div().pt(14).pb(6).text_size(11).font_semibold().text_color(t.muted).child(text);
  }

  button(t, id, text, fn) {
    return div().id(id).px(14).py(7).cursor_pointer().text_size(13).font_semibold().bg(t.solid).text_color(t.solid_foreground)
      .opacity(this.busy ? 0.5 : 1).hover((s) => s.opacity(0.85)).on_click((_e, cx) => fn(cx))
      .child(this.busy ? "Working…" : text);
  }

  openTab(t) {
    const rows = this.filtered();
    return v_flex().flex_1().min_h(0).gap(8)
      .child(this.input(t, this.query))
      .child(!this.rows ? div().p(8).text_size(12).text_color(t.dim).child("Looking for projects…")
        : v_flex().flex_1().min_h(0).overflow_y_scrollbar().children(rows.map((r, i) =>
          h_flex().id(`p-${r.path}`).gap(10).items_center().px(10).py(7).cursor_pointer()
            .bg(i === this.sel ? t.selected : t.popover)
            .when(i === this.sel, (el) => el.border_l(2).border_color(t.accent))
            .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.open(r, cx))
            .child(svg(`mods/workspace-chrome/${r.remote ? "git-branch" : "folder"}.svg`).size(14).flex_none()
              .text_color(r.known ? t.accent : t.dim))
            .child(div().w(190).flex_none().text_size(13).font_semibold().text_color(t.foreground).truncate().child(r.name))
            .child(div().flex_1().text_size(11).text_color(t.dim).truncate().child(r.path))
            .children(r.remote?.includes("github.com") ? [div().text_size(10).text_color(t.muted).border(1).border_color(t.border).px(4).child("GitHub")] : [])
            .child(div().w(34).text_size(11).text_color(t.dim).child(ago(r.last_commit))))));
  }

  newTab(t, clone) {
    const dirs = this.dirs().map((d) => [d, d]);
    return v_flex()
      .child(this.label(t, clone ? "REPOSITORY URL" : "NAME"))
      .child(this.input(t, clone ? this.url : this.name))
      .child(this.label(t, "IN"))
      .child(this.chips(t, "dir", dirs, this.dir, (v) => { this.dir = v; }))
      .children(clone ? [] : [this.label(t, "GITHUB"), this.chips(t, "gh", GITHUB, this.github, (v) => { this.github = v; })])
      .child(h_flex().pt(20).justify_end().child(this.button(t, "create", clone ? "Clone and open" : "Create and open", (cx) => this.create(cx, clone))));
  }

  render(cx) {
    const t = theme();
    return v_flex().id("root").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .size_full().bg(t.popover).text_color(t.foreground)
      .child(h_flex().px(16).pt(14).pb(10).gap(14).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(15).font_semibold().child("Projects"))
        .child(h_flex().gap(0).children(TABS.map((tab) =>
          div().id(`tab-${tab}`).px(12).py(4).cursor_pointer().text_size(12).font_semibold()
            .text_color(tab === this.tab ? t.accent_foreground : t.muted).bg(tab === this.tab ? t.accent : t.popover)
            .border(1).border_color(tab === this.tab ? t.accent : t.border)
            .on_click((_e, cx) => {
              this.tab = tab; this.error = null;
              (tab === "Open" ? this.query : tab === "New" ? this.name : this.url).focus();
              cx.notify();
            }).child(tab))))
        .child(div().flex_1())
        .child(div().id("close").w(26).h(26).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .tooltip("Close (Esc)").hover((s) => s.bg(t.hover)).on_click(() => closeOverlay(props().overlay))
          .child(svg("mods/workspace-chrome/x.svg").size(14).text_color(t.muted))))
      .child(v_flex().flex_1().min_h(0).p(16)
        .child(this.tab === "Open" ? this.openTab(t) : this.newTab(t, this.tab === "Clone")))
      .children(this.error ? [div().px(16).pb(12).text_size(12).text_color(t.blocked).child(this.error)] : []);
  }
}
