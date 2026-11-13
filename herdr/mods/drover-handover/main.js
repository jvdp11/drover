// Hand over a coordinator / move a task or review to another agent.
// Opened as a dialog with props { kind: "coordinator"|"task"|"review", title, repo, mission, task, name }.
// Lists agents with capacity (drover agent list --json); Enter hands over, Esc cancels.
// props.agents (demo) replaces the live list.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, closeOverlay, theme, exec, notify } from "herdr";

// Short times: "15:20" today, "tomorrow 03:06", else "Mon 01:00".
function at(sec) {
  const d = new Date(sec * 1000), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${hm}`;
  return `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hm}`;
}

// Every installed agent (config agents whose binary is on PATH), merged with
// `drover agent list --json` capacity: headroom first, then unknown, then out.
function merge(cfg, list, have) {
  const out = list.out ?? {};
  const rows = Object.entries(cfg.agents ?? {})
    .filter(([id, a]) => have.has(id) || out[id] || (list.usage ?? []).some((u) => u.agent === id))
    .map(([id, a]) => {
      const u = (list.usage ?? []).find((x) => x.agent === id);
      return { agent: id, label: a.name ?? id, used: u?.used_percent, resets: u?.resets_at, until: out[id]?.until };
    });
  const rank = (r) => (r.until != null ? 2 : r.used == null ? 1 : 0);
  return rows.sort((x, y) => rank(x) - rank(y) || (x.used ?? 0) - (y.used ?? 0));
}

export default class Handover extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    this.agents = null;
    this.pick = null;
    this.error = null;
    this.busy = false;
    this.reason = InputState.new({ placeholder: "Reason (optional)" });
    const demo = props()?.agents;
    if (demo) { this.agents = demo; return; }
    cx.spawn(async (cx) => {
      try {
        const run = async (args) => {
          const r = await exec("drover", args);
          if (r.code !== 0) throw new Error(r.stderr.trim() || r.stdout.trim() || `drover ${args[0]} exited ${r.code}`);
          return JSON.parse(r.stdout);
        };
        const [list, cfg] = await Promise.all([run(["agent", "list", "--json"]), run(["config", "--json"]).then((j) => j.config ?? j)]);
        const have = new Set();
        await Promise.all(Object.entries(cfg.agents ?? {}).map(async ([id, a]) => {
          const r = await exec("sh", ["-c", `command -v ${JSON.stringify(a.bin ?? id)}`]).catch(() => null);
          if (r?.code === 0) have.add(id);
        }));
        this.agents = merge(cfg, list, have);
      } catch (e) {
        this.agents = [];
        this.error = `Could not list agents: ${e.message ?? e}`;
      }
      cx.notify();
    });
  }

  go(cx) {
    const p = props() ?? {};
    if (!this.pick || this.busy) return;
    const reason = (this.reason.value() ?? "").trim();
    const args = p.kind === "coordinator"
      ? ["coordinator", "replace", "--repo", p.repo, "--agent", this.pick, ...(reason ? ["--reason", reason] : [])]
      : ["task", "reroute", p.task, ...(p.kind === "review" ? ["--review"] : []), "--agent", this.pick, "--mission", p.mission, ...(reason ? ["--reason", reason] : [])];
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      let ok = false, msg = "";
      try {
        const r = await exec("drover", args, { timeout: 120000 });
        ok = r.code === 0;
        msg = (ok ? r.stdout : r.stderr || r.stdout).trim() || (ok ? "Done" : `drover exited ${r.code}`);
      } catch (e) {
        msg = String(e.message ?? e);
      }
      this.busy = false;
      if (ok) closeOverlay(props().overlay);
      else this.error = msg;
      notify({ title: ok ? `${p.title}: done` : `${p.title}: failed`, body: msg.slice(0, 400), level: ok ? "success" : "error" });
      cx.notify();
    });
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const button = (id, label, bg, fg, on, off) =>
      h_flex().id(id).h(32).px(14).items_center().rounded(8).border_1().border_color(id === "no" ? t.input : bg).bg(bg).text_color(fg)
        .when(off, (el) => el.opacity(0.45)).when(!off, (el) => el.cursor_pointer().hover((s) => s.opacity(0.88)).on_click(on)).child(label);
    const rows = this.agents ?? [];
    return v_flex()
      .id("handover")
      .track_focus(this.handle)
      .on_key_down((e, cx) => {
        if (e.key === "enter") this.go(cx);
        else if (e.key === "escape") closeOverlay(props().overlay);
        else return;
        cx.stop_propagation();
      })
      .size_full().min_h(0).p(18).gap(12).rounded(8).bg(t.popover).text_size(13)
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(p.title ?? "Hand over"))
        .child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(div().text_color(t.muted).child(p.kind === "coordinator" ? "Pick the agent that takes over as coordinator." : `${p.name ?? ""} — pick the agent to continue it.`.trim()))
      .child(v_flex().flex_1().min_h(0).gap(4).overflow_y_scrollbar()
        .when(this.agents === null, (el) => el.child(div().text_color(t.dim).child("Loading agents…")))
        .children(rows.map((a, i) => {
          const out = a.until != null;
          const sel = this.pick === a.agent;
          const detail = out ? `out until ${at(a.until)}` : a.used != null ? `${Math.round(a.used)}% used${a.resets ? ` · resets ${at(a.resets)}` : ""}` : "usage unknown";
          return h_flex().id(`ag-${i}`).h(36).px(10).gap(10).items_center().rounded(7).border_1().border_color(sel ? t.accent : t.input)
            .when(sel, (el) => el.bg(t.selected))
            .when(out, (el) => el.opacity(0.45))
            .when(!out, (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.pick = a.agent; cx.notify(); }))
            .child(div().flex_1().text_color(t.foreground).child(a.label))
            .child(div().text_size(11).text_color(out ? t.dim : t.muted).child(detail));
        })))
      .child(Input.new(this.reason).h(32).px(8).border(1).border_color(t.input).bg(t.background).text_size(12).text_color(t.foreground))
      .when(this.error, (el) => el.child(div().text_size(12).text_color(t.error ?? "#e06c75").child(this.error)))
      .child(h_flex().justify_end().gap(8).text_size(12)
        .child(button("no", "Cancel", t.raised, t.foreground, () => closeOverlay(props().overlay)))
        .child(button("yes", this.busy ? "Handing over…" : "Hand over", t.solid, t.solid_foreground, (_e, cx) => this.go(cx), !this.pick || this.busy)));
  }
}
