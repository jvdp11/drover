// drover project home: the first tab of a project's space. The project (name,
// folder, branch, remote), a big Start a mission, its missions with progress,
// and recent commits. Props: { folder, name }.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, theme, props, openOverlay } from "herdr";

const STATE = { running: "working", starting: "working", stopped: "idle", done: "done" };

function hue(t, name) {
  const pool = [t.ansi4, t.ansi5, t.ansi6, t.ansi2, t.ansi3, t.ansi1, t.ansi12, t.ansi13];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return pool[h % pool.length] ?? t.accent;
}

function ago(ts) {
  if (!ts) return "";
  const m = Math.floor((Date.now() / 1000 - ts) / 60);
  if (m < 60) return `${Math.max(m, 1)}m ago`;
  if (m < 1440) return `${Math.floor(m / 60)}h ago`;
  return `${Math.floor(m / 1440)}d ago`;
}

export default class ProjectHome extends View {
  init(_props, cx) {
    this.missions = null;
    this.commits = [];
    this.remote = null;
    this.load(cx);
    cx.timer.every(20_000, (cx) => this.load(cx));
  }

  folder() { return props()?.folder; }

  load(cx) {
    const folder = this.folder();
    if (!folder) return;
    cx.spawn(async (cx) => {
      const [m, log, rem] = await Promise.all([
        exec("drover", ["mission", "list", "--repo", folder, "--all", "--json"]).catch(() => null),
        exec("git", ["-C", folder, "log", "-8", "--format=%h%x09%s%x09%ct%x09%an"]).catch(() => null),
        exec("git", ["-C", folder, "remote", "get-url", "origin"]).catch(() => null),
      ]);
      try { this.missions = JSON.parse(m?.stdout ?? "").missions; } catch (_) { this.missions = []; }
      this.commits = (log?.stdout ?? "").trim().split("\n").filter(Boolean).map((l) => {
        const [hash, subject, ct, author] = l.split("\t");
        return { hash, subject, at: parseInt(ct, 10), author };
      });
      this.remote = rem?.code === 0 ? rem.stdout.trim() : null;
      cx.notify();
    });
  }

  archive(id, cx) {
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", ["mission", "archive", id, "--json"]);
        if (r.code !== 0) throw new Error(r.stderr?.trim() || "Could not archive mission");
        this.error = null;
        this.load(cx);
      } catch (e) { this.error = String(e?.message ?? e); }
      cx.notify();
    });
  }

  space() {
    return spaces().find((s) => s.folder === this.folder() && !s.machine);
  }

  card(t, title, body, right) {
    return v_flex().rounded(10).bg(t.surface).border(1).border_color(t.border).overflow_hidden()
      .child(h_flex().px(14).py(10).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().text_size(10).font_semibold().text_color(t.dim).child(title))
        .children(right ? [right] : []))
      .child(body);
  }

  render() {
    const t = theme();
    const p = props() ?? {};
    const s = this.space();
    const name = p.name ?? s?.name ?? "project";
    const c = hue(t, name);
    const gh = this.remote?.match(/github\.com[:/](.+?)(\.git)?$/)?.[1];
    const missions = (this.missions ?? []).filter((m) => !m.archived);
    const archived = (this.missions ?? []).filter((m) => m.archived).length;
    const running = missions.filter((m) => m.state === "running");
    const start = () => openOverlay({ mod: "drover-mission", kind: "dialog", width: 600, height: 380,
      props: { space: s?.id, folder: this.folder(), name } });
    const dashboard = (mission, showArchived = false) => openOverlay({ mod: "drover-dashboard", kind: "dialog", width: 1120, height: 760,
      props: { space: s?.id, folder: s?.folder ?? this.folder(), name: s?.name ?? name, showArchived, ...(mission ? { mission } : {}) } });

    return v_flex().id("root").size_full().bg(t.background).overflow_y_scrollbar()
      .child(v_flex().w_full().max_w(980).mx_auto().p(28).gap(18)
        // The project.
        .child(h_flex().gap(16).items_center()
          .child(div().relative().w(56).h(56).flex().items_center().justify_center().rounded(14).bg(c).shadow_md()
            .child(div().text_size(20).font_semibold().text_color(t.background).child(name.slice(0, 2).toUpperCase()))
            .child(div().absolute().bottom(-5).left(-5).w(22).h(22).rounded(11).flex().items_center().justify_center()
              .bg(t.accent).border(2).border_color(t.background)
              .child(svg("mods/drover-rail/horns.svg").size(13).text_color(t.accent_foreground))))
          .child(v_flex().flex_1().gap(4)
            .child(div().text_size(24).font_semibold().text_color(t.foreground).child(name))
            .child(h_flex().gap(12).items_center().text_size(12).text_color(t.dim)
              .child(div().child((this.folder() ?? "").replace(/^\/home\/[^/]+/, "~")))
              .children(s?.branch ? [h_flex().gap(4).items_center()
                .child(svg("mods/workspace-chrome/git-branch.svg").size(12).text_color(t.dim)).child(s.branch)] : [])
              .children(gh ? [div().px(6).rounded(4).border(1).border_color(t.border).child(`GitHub · ${gh}`)] : [])))
          .child(h_flex().id("dashboard").gap(6).items_center().px(12).py(8).rounded(8)
            .cursor_pointer().bg(`${t.accent}22`).text_color(t.accent).hover((st) => st.bg(`${t.accent}44`))
            .tooltip("Open mission dashboard · Esc to close").on_click(() => dashboard())
            .child(svg("mods/drover-rail/horns.svg").size(14).text_color(t.accent))
            .child(div().text_size(12).font_semibold().child("Open dashboard"))))
        // Start a mission.
        .child(h_flex().id("start").gap(16).items_center().p(18).rounded(12).cursor_pointer()
          .bg(`${t.accent}1a`).border(1).border_color(`${t.accent}66`).hover((st) => st.bg(`${t.accent}2e`))
          .on_click(start)
          .child(div().w(44).h(44).flex().items_center().justify_center().rounded(12).bg(t.accent).shadow_md()
            .child(svg("mods/drover-rail/drover.svg").size(28).text_color(t.accent_foreground)))
          .child(v_flex().flex_1().min_w(0).overflow_hidden().gap(3)
            .child(div().text_size(16).font_semibold().text_color(t.foreground).child("Start a mission"))
            .child(div().w_full().whitespace_normal().text_size(12).text_color(t.muted)
              .child("Describe a goal. A coordinator plans it, workers build it on their own branches across your machines, another model family reviews, then it's merged.")))
          .child(div().text_size(20).text_color(t.accent).child("→")))
        .children(this.error ? [div().text_size(12).text_color(t.blocked).child(this.error)] : [])
        // Missions and commits side by side.
        .child(h_flex().gap(18).items_start()
          .child(div().flex_1().min_w(0).child(this.card(t, `MISSIONS${running.length ? ` · ${running.length} RUNNING` : ""}`,
            missions.length ? v_flex().children(missions.slice(0, 8).map((m, i) => {
              const color = t[STATE[m.state] ?? "idle"] ?? t.dim;
              const frac = m.tasks ? m.merged / m.tasks : 0;
              return v_flex().id(`mission-${m.id}`).px(14).py(10).gap(6).cursor_pointer()
                .hover((st) => st.bg(t.hover)).tooltip("Open this mission's dashboard").on_click(() => dashboard(m.id))
                .when(i > 0, (el) => el.border_t(1).border_color(t.border))
                .child(h_flex().gap(8).items_center()
                  .child(div().w(8).h(8).rounded(4).bg(color)
                    .when(m.state === "running", (el) => el.loop("opacity", { from: 0.35, to: 1, period: 1200 })))
                  .child(div().flex_1().text_size(13).text_color(t.foreground).truncate().child(m.goal))
                  .child(div().text_size(11).text_color(t.dim).child(ago(m.updated)))
                  .children(["done", "stopped"].includes(m.state) ? [div().id(`archive-${m.id}`)
                    .px(6).py(3).rounded(4).text_size(11).text_color(t.muted).hover((st) => st.bg(t.border))
                    .on_click((_e, cx) => { cx.stop_propagation(); this.archive(m.id, cx); }).child("Archive")] : []))
                .children(m.state === "done" && m.summary ? [div().text_size(11).text_color(t.muted)
                  .whitespace_normal().child(m.summary)] : [])
                .child(h_flex().gap(8).items_center()
                  .child(div().w(120).h(4).rounded(2).bg(t.border)
                    .child(div().h(4).rounded(2).bg(t.accent).w(Math.max(2, Math.round(120 * frac))).transition("width", { duration: 600 })))
                  .child(div().text_size(11).text_color(t.muted).child(`${m.merged}/${m.tasks} merged · ${m.state}`)));
            }))
              : v_flex().p(18).gap(6).items_center()
                  .child(div().text_size(22).text_color(t.dim).child("◇"))
                  .child(div().text_size(12).text_color(t.dim).child(this.missions ? "No missions yet" : "Loading…")),
            archived ? div().id("archived-missions").cursor_pointer().text_size(11).text_color(t.dim)
              .hover((st) => st.text_color(t.accent)).on_click(() => dashboard(null, true)).child(`${archived} archived`) : null)))
          .child(div().w(380).flex_none().child(this.card(t, "RECENT COMMITS",
            v_flex().children(this.commits.map((cm, i) =>
              h_flex().px(14).py(7).gap(10).items_center().when(i > 0, (el) => el.border_t(1).border_color(t.border))
                .child(div().text_size(11).text_color(t.accent).font_family("JetBrainsMono Nerd Font").child(cm.hash))
                .child(div().flex_1().min_w(0).text_size(12).text_color(t.foreground).truncate().child(cm.subject))
                .child(div().text_size(10).text_color(t.dim).child(ago(cm.at)))))))))
        // Coming next.
        .child(h_flex().gap(10).items_center().px(14).py(10).rounded(10).border(1).border_color(t.border)
          .child(svg("mods/workspace-chrome/git-compare.svg").size(14).text_color(t.dim))
          .child(div().text_size(12).text_color(t.dim)
            .child(gh ? "Issues and pull requests from GitHub appear here next: pick an issue to start a mission on it."
              : "Push this project to GitHub to see its issues and pull requests here."))));
  }
}
