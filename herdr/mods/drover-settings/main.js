// drover settings: machines (may run agents, durable host, how many agents),
// roles (an ordered chain of agent + model, preferred machines, durable),
// placement rules, handoff and branch cleanup. Opened as a dialog from the
// fleet panel. Reads and saves through `drover config`, which owns the file.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, props, closeOverlay, shared, notify } from "herdr";

const AGENT_ICON = { claude: "icons/claude.svg", codex: "icons/codex.svg", cursor: "icons/cursor.svg", copilot: "icons/copilot.svg" };
const SECTIONS = ["Machines", "Roles", "Placement", "Handoff"];
const HANDOFF = { github: "GitHub: push task branches to the repo's remote", nas: "NAS: a bare repo remote on your network", direct: "Direct: copy work between machines with hc" };
const clone = (x) => JSON.parse(JSON.stringify(x));

export default class Settings extends View {
  init(_props, cx) {
    this.section = "Machines";
    this.cfg = null;
    this.saved = null;
    this.error = null;
    this.role = null;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("drover", ["config", "--json"]);
        if (r.code !== 0) throw new Error(r.stderr.trim());
        this.cfg = JSON.parse(r.stdout).config;
        this.saved = JSON.stringify(this.cfg);
        this.role = Object.keys(this.cfg.roles)[0];
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  // The machines to show: every probed one plus any only in the settings.
  machineNames() {
    const status = shared("drover.status");
    const names = (status?.machines ?? []).map((m) => m.name);
    for (const n of Object.keys(this.cfg.machines)) if (!names.includes(n)) names.push(n);
    return names;
  }

  mc(name) {
    return { ...this.cfg.machine_defaults, ...(this.cfg.machines[name] ?? {}) };
  }

  setMc(name, key, value) {
    this.cfg.machines[name] = { ...(this.cfg.machines[name] ?? {}), [key]: value };
  }

  // ---------------------------------------------------------------- controls

  toggle(t, id, on, fn) {
    return div().id(id).w(30).h(16).p(2).flex_none().cursor_pointer().border(1)
      .border_color(on ? t.accent : t.input).bg(on ? t.accent : t.background)
      .on_click((_e, cx) => { fn(!on); cx.notify(); })
      .child(div().w(10).h(10).bg(on ? t.accent_foreground : t.muted).when(on, (el) => el.ml(14)));
  }

  stepper(t, id, value, min, max, fn) {
    const b = (sid, label, d) => div().id(`${id}-${sid}`).w(20).h(20).flex().items_center().justify_center()
      .cursor_pointer().border(1).border_color(t.input).text_color(t.muted).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { fn(Math.max(min, Math.min(max, value + d))); cx.notify(); }).child(label);
    return h_flex().gap(0).items_center().text_size(12)
      .child(b("dn", "−", -1)).child(div().w(32).text_color(t.foreground).flex().justify_center().child(String(value))).child(b("up", "+", 1));
  }

  button(t, id, label, fn, primary) {
    return div().id(id).px(12).py(5).cursor_pointer().text_size(12).font_semibold()
      .bg(primary ? t.solid : t.background).text_color(primary ? t.solid_foreground : t.foreground)
      .border(1).border_color(primary ? t.solid : t.input).hover((s) => s.opacity(0.85))
      .on_click((_e, cx) => fn(cx)).child(label);
  }

  row(t, label, hint, control) {
    return h_flex().gap(12).items_center().py(8).border_b(1).border_color(t.border)
      .child(v_flex().flex_1().gap(2)
        .child(div().text_size(13).text_color(t.foreground).child(label))
        .children(hint ? [div().text_size(11).text_color(t.dim).child(hint)] : []))
      .child(control);
  }

  // ---------------------------------------------------------------- sections

  machines(t) {
    const status = shared("drover.status");
    return v_flex().children(this.machineNames().map((name) => {
      const m = this.mc(name);
      const probe = status?.machines?.find((x) => x.name === name);
      const facts = probe?.online ? `${probe.os} · ${probe.cpus} cpu · ${probe.mem_gb} GB · ${probe.disk_free_gb} GB free` : "offline";
      return v_flex().py(10).gap(6).border_b(1).border_color(t.border)
        .child(h_flex().gap(8).items_center()
          .child(div().text_size(14).font_semibold().text_color(t.foreground).child(name))
          .child(div().text_size(11).text_color(t.dim).child(facts)))
        .child(h_flex().gap(18).items_center().text_size(12).text_color(t.muted)
          .child(h_flex().gap(6).items_center().child(this.toggle(t, `en-${name}`, m.enabled, (v) => this.setMc(name, "enabled", v))).child("Runs agents"))
          .child(h_flex().gap(6).items_center().opacity(m.enabled ? 1 : 0.4)
            .child(this.toggle(t, `du-${name}`, m.durable, (v) => this.setMc(name, "durable", v))).child("Durable host"))
          .child(h_flex().gap(6).items_center().opacity(m.enabled ? 1 : 0.4)
            .child(this.stepper(t, `mx-${name}`, m.max_agents, 1, 32, (v) => this.setMc(name, "max_agents", v))).child("agents at once")));
    }))
      .child(div().pt(10).text_size(11).text_color(t.dim).child(
        "Off: a cockpit that only drives (your laptop). Durable: may host long runs that must keep going when you leave, like the coordinator."));
  }

  roles(t) {
    const names = Object.keys(this.cfg.roles);
    const r = this.cfg.roles[this.role];
    const agents = this.cfg.agents;
    const machines = this.machineNames();
    const chain = r.chain;
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= chain.length) return; [chain[i], chain[j]] = [chain[j], chain[i]]; };
    const cycleModel = (c) => {
      const opts = [null, ...(agents[c.agent]?.models ?? [])];
      c.model = opts[(opts.indexOf(c.model ?? null) + 1) % opts.length];
    };
    const small = (id, label, fn, tip) => div().id(id).w(20).h(20).flex().items_center().justify_center().cursor_pointer()
      .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover)).tooltip(tip).on_click((_e, cx) => { fn(); cx.notify(); }).child(label);

    return v_flex().gap(10)
      .child(h_flex().gap(0).children(names.map((n) =>
        div().id(`role-${n}`).px(12).py(5).cursor_pointer().text_size(12).font_semibold()
          .text_color(n === this.role ? t.accent_foreground : t.muted).bg(n === this.role ? t.accent : t.background)
          .border(1).border_color(n === this.role ? t.accent : t.border)
          .on_click((_e, cx) => { this.role = n; cx.notify(); }).child(n))))
      .child(div().text_size(11).font_semibold().text_color(t.muted).pt(6).child("TRY IN THIS ORDER"))
      .child(v_flex().border(1).border_color(t.border).children(chain.map((c, i) =>
        h_flex().gap(8).items_center().px(8).py(5).when(i > 0, (el) => el.border_t(1).border_color(t.border))
          .child(div().w(16).text_size(11).text_color(t.dim).child(`${i + 1}`))
          .children(AGENT_ICON[c.agent] ? [image(AGENT_ICON[c.agent]).w(14).h(14).flex_none()] : [])
          .child(div().w(90).text_size(13).text_color(t.foreground).child(agents[c.agent]?.name ?? c.agent))
          .child(div().id(`model-${i}`).px(8).py(2).cursor_pointer().border(1).border_color(t.input).text_size(12)
            .text_color(c.model ? t.foreground : t.dim).tooltip("Click for the next model")
            .on_click((_e, cx) => { cycleModel(c); cx.notify(); }).child(c.model ?? "default model"))
          .child(div().flex_1())
          .child(small(`up-${i}`, "↑", () => move(i, -1), "Try earlier"))
          .child(small(`dn-${i}`, "↓", () => move(i, 1), "Try later"))
          .child(small(`rm-${i}`, "×", () => chain.splice(i, 1), "Remove")))))
      .child(h_flex().gap(6).items_center().flex_wrap()
        .child(div().text_size(11).text_color(t.dim).child("Add:"))
        .children(Object.keys(agents).map((key) =>
          div().id(`add-${key}`).px(8).py(2).cursor_pointer().border(1).border_color(t.border).text_size(12).text_color(t.muted)
            .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { chain.push({ agent: key, model: null }); cx.notify(); })
            .child(`+ ${agents[key].name}`))))
      .child(div().text_size(11).font_semibold().text_color(t.muted).pt(8).child("PREFERRED MACHINES"))
      .child(h_flex().gap(6).flex_wrap().children(machines.map((m) => {
        const i = (r.prefer ?? []).indexOf(m);
        return div().id(`pref-${m}`).px(8).py(3).cursor_pointer().text_size(12).border(1)
          .border_color(i >= 0 ? t.accent : t.border).text_color(i >= 0 ? t.foreground : t.dim)
          .tooltip(i >= 0 ? "Preferred, in this order. Click to drop." : "Click to prefer")
          .on_click((_e, cx) => { r.prefer = i >= 0 ? r.prefer.filter((x) => x !== m) : [...(r.prefer ?? []), m]; cx.notify(); })
          .child(i >= 0 ? `${i + 1}. ${m}` : m);
      })))
      .child(this.row(t, "Durable only", "Only on durable hosts, so it survives you closing the laptop",
        this.toggle(t, "role-durable", !!r.durable, (v) => { r.durable = v; })))
      .child(this.row(t, "Different model family", "Skip agents from the same family as the author (for reviews)",
        this.toggle(t, "role-family", !!r.other_family, (v) => { r.other_family = v; })));
  }

  placement(t) {
    const p = this.cfg.placement;
    return v_flex()
      .child(this.row(t, "Skip machines on battery", "A laptop running on battery never gets agents",
        this.toggle(t, "pl-bat", !!p.avoid_battery, (v) => { p.avoid_battery = v; })))
      .child(this.row(t, "Minimum free disk", "GB a machine needs free before it gets agents",
        this.stepper(t, "pl-disk", p.min_disk_gb ?? 10, 0, 500, (v) => { p.min_disk_gb = v; })))
      .child(this.row(t, "Default agents per machine", "For machines without their own number",
        this.stepper(t, "pl-max", this.cfg.machine_defaults.max_agents, 1, 32, (v) => { this.cfg.machine_defaults.max_agents = v; })));
  }

  handoff(t) {
    const h = this.cfg.handoff;
    return v_flex().gap(4)
      .child(div().text_size(11).font_semibold().text_color(t.muted).child("WHERE TASK BRANCHES MEET"))
      .children(Object.entries(HANDOFF).map(([mode, label]) =>
        h_flex().id(`ho-${mode}`).gap(8).items_center().py(6).cursor_pointer()
          .on_click((_e, cx) => { h.mode = mode; cx.notify(); })
          .child(div().w(12).h(12).border(1).border_color(h.mode === mode ? t.accent : t.input).p(2)
            .children(h.mode === mode ? [div().size_full().bg(t.accent)] : []))
          .child(div().text_size(13).text_color(h.mode === mode ? t.foreground : t.muted).child(label))))
      .child(div().text_size(11).font_semibold().text_color(t.muted).pt(12).child("CLEANUP"))
      .child(this.row(t, "Delete merged branches on the remote too",
        "drover cleanup removes drover/* branches and worktrees once their work is in the base branch",
        this.toggle(t, "cl-remote", !!this.cfg.cleanup.delete_remote, (v) => { this.cfg.cleanup.delete_remote = v; })));
  }

  // ---------------------------------------------------------------- save

  save(cx) {
    const keep = ["version", "machines", "machine_defaults", "roles", "placement", "handoff", "cleanup"];
    const out = Object.fromEntries(keep.map((k) => [k, this.cfg[k]]));
    cx.spawn(async (cx) => {
      const r = await exec("drover", ["config", "--json", "--set-json", JSON.stringify(out)]).catch((e) => ({ code: 1, stderr: String(e) }));
      if (r.code === 0) {
        this.saved = JSON.stringify(this.cfg);
        notify({ title: "drover", body: "Settings saved", level: "info", timeout: 2500 });
        closeOverlay(props().overlay);
      } else {
        this.error = r.stderr.trim() || "could not save";
        cx.notify();
      }
    });
  }

  render(cx) {
    const t = theme();
    const dirty = this.cfg && JSON.stringify(this.cfg) !== this.saved;
    const body = !this.cfg ? div().p(16).text_size(12).text_color(this.error ? t.blocked : t.dim).child(this.error ?? "Loading…")
      : { Machines: () => this.machines(t), Roles: () => this.roles(t), Placement: () => this.placement(t), Handoff: () => this.handoff(t) }[this.section]();
    return v_flex().id("root").size_full().bg(t.popover)
      .child(h_flex().px(16).py(12).gap(10).items_center().border_b(1).border_color(t.border)
        .child(div().text_size(15).font_semibold().text_color(t.foreground).child("drover"))
        .child(div().text_size(12).text_color(t.dim).child("fleet settings")))
      .child(h_flex().flex_1().min_h(0).items_start()
        .child(v_flex().w(140).h_full().flex_none().py(8).border_r(1).border_color(t.border).children(SECTIONS.map((s) =>
          div().id(`sec-${s}`).px(16).py(6).cursor_pointer().text_size(13)
            .text_color(s === this.section ? t.foreground : t.muted).bg(s === this.section ? t.selected : t.popover)
            .when(s === this.section, (el) => el.border_l(2).border_color(t.accent))
            .hover((st) => st.bg(t.hover)).on_click((_e, cx) => { this.section = s; cx.notify(); }).child(s))))
        .child(v_flex().flex_1().min_w(0).h_full().p(16).overflow_y_scrollbar().child(body)))
      .child(h_flex().px(16).py(10).gap(8).items_center().border_t(1).border_color(t.border)
        .child(div().flex_1().text_size(11).text_color(this.error && this.cfg ? t.blocked : t.dim)
          .child(this.error && this.cfg ? this.error : dirty ? "Unsaved changes" : "~/.config/drover/config.json"))
        .child(this.button(t, "cancel", "Cancel", () => closeOverlay(props().overlay)))
        .child(this.button(t, "save", "Save", (cx) => this.save(cx), true)));
  }
}
