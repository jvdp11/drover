// drover mission: start a mission in the shown project. You type the goal;
// drover starts a coordinator on a durable host, shown as a tab in this
// project's space, and it plans and hands out tasks from there.
// Props: { space, folder, name } (the project's space).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { exec, theme, props, closeOverlay, notify, home } from "herdr";

// Drafts live per project folder: ~/.local/state/drover/drafts/<key>.json
// ({goal, images, unattended}); pasted clipboard images are saved under drafts/images/.
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i;
const key = (folder) => (folder ?? "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(-80) || "none";
const base = (p) => p.split("/").pop();
const sh = (script, ...args) => exec("sh", ["-c", script, "sh", ...args], { timeout: 15_000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));

export default class MissionStart extends View {
  init(_props, cx) {
    this.busy = false;
    this.error = null;
    this.parallel = 3;
    this.unattended = true;
    this.images = [];
    this.dir = home() + "/.local/state/drover/drafts";
    this.file = `${this.dir}/${key((props() ?? {}).folder)}.json`;
    this.goal = TextareaState.new({ placeholder: "What should the swarm get done?", rows: 5 });
    this.goal.set_soft_wrap(true);
    this.goal.on("change", (_e, cx) => { this.scanPaths(cx); this.saveSoon(cx); cx.notify(); });
    // A paste with no text in it: an image on the clipboard, if there is one.
    this.goal.on("paste_other", (_e, cx) => this.pasteClipboardImage(cx));
    this.goal.focus();
    cx.timer.after(300, () => this.goal.focus());
    this.handle = cx.focus_handle();
    this.cx0 = cx;
    this.loadedP = new Promise((res) => { this.resolveLoaded = res; });
    this.loadDraft(cx);
  }

  loadDraft(cx) {
    cx.spawn(async (cx) => {
      const r = await sh('cat "$1"', this.file);
      if (r.code !== 0) { this.loaded = true; this.resolveLoaded(); return; }
      try {
        const d = JSON.parse(r.stdout);
        if (typeof d.unattended === "boolean") this.unattended = d.unattended;
        if (d.goal && !(this.goal.value() ?? "")) this.goal.set_value(d.goal);
        if (Array.isArray(d.images)) {
          for (const p of d.images) { if ((await sh('test -f "$1"', p)).code === 0 && !this.images.includes(p)) this.images.push(p); }
        }
      } catch (_) { /* unreadable draft: start empty */ }
      this.loaded = true;
      this.resolveLoaded();
      cx.notify();
    });
  }

  saveDraft(clear) {
    if (!this.loaded && !clear) return Promise.resolve();
    const d = { goal: clear ? "" : (this.goal.value() ?? ""), images: clear ? [] : this.images, unattended: this.unattended };
    return sh('mkdir -p "$(dirname "$1")" && printf %s "$2" > "$1"', this.file, JSON.stringify(d));
  }

  saveSoon(cx) {
    this.saveGen = (this.saveGen ?? 0) + 1;
    const g = this.saveGen;
    cx.timer.after(600, () => { if (g === this.saveGen) this.saveDraft(false); });
  }

  async close() {
    this.saveGen = (this.saveGen ?? 0) + 1; // cancel the pending debounced save
    if (!this.loaded) { // let a restore in flight finish so its images/choice merge in; don't wait forever
      await Promise.race([this.loadedP, new Promise((res) => this.cx0.timer.after(1500, res))]);
      this.loaded = true; // still loading: write what's typed anyway
    }
    await this.saveDraft(false); // Esc, Cancel and the x keep the draft; flush it first
    closeOverlay(props().overlay);
  }

  addImage(path, cx) {
    if (!this.images.includes(path)) this.images.push(path);
    this.saveSoon(cx);
    cx.notify();
  }

  // The clipboard's image, through wl-paste (Herdr's own clipboard-image call is for its feedback form only).
  pasteClipboardImage(cx) {
    cx.spawn(async (cx) => {
      const stem = `${this.dir}/images/${Date.now()}`;
      const r = await sh('command -v wl-paste >/dev/null || exit 3; t=$(wl-paste --list-types 2>/dev/null | grep -m1 "^image/"); [ -n "$t" ] || exit 2; mkdir -p "$(dirname "$1")" && e=${t#image/} && e=${e%%[+;]*} && case "$e" in jpeg) e=jpg;; svg) exit 1;; esac && wl-paste --type "$t" > "$1.$e" && test -s "$1.$e" && printf %s "$1.$e" || { rm -f "$1".*; exit 1; }', stem);
      if (r.code === 0 && r.stdout.trim()) this.addImage(r.stdout.trim(), cx);
      else if (r.code === 3) { this.error = "Pasting screenshots needs wl-paste (wl-clipboard); attach an image file instead"; cx.notify(); }
      else if (r.code !== 2) { this.error = "Could not read the image from the clipboard"; cx.notify(); }
    });
  }

  // A pasted file path to an image (own line, or file:// URL) becomes an attachment.
  scanPaths(cx) {
    const v = this.goal.value() ?? "";
    const lines = v.split("\n");
    const hits = lines.map((l) => l.trim().replace(/^file:\/\//, "").replace(/^'(.*)'$/, "$1")).map((l, i) => (l.startsWith("/") && IMG_RE.test(l) ? [i, l] : null)).filter(Boolean);
    if (!hits.length) return;
    cx.spawn(async (cx) => {
      let cur = (this.goal.value() ?? "").split("\n");
      for (const [, p] of hits) {
        if ((await sh('test -f "$1"', p)).code !== 0) continue;
        const at = cur.findIndex((l) => l.trim().replace(/^file:\/\//, "").replace(/^'(.*)'$/, "$1") === p);
        if (at >= 0) cur.splice(at, 1);
        if (!this.images.includes(p)) this.images.push(p);
      }
      this.goal.set_value(cur.join("\n"));
      cx.notify();
    });
  }

  dropFiles(paths, cx) {
    cx.spawn(async (cx) => {
      for (const p of paths ?? []) if (IMG_RE.test(p) && (await sh('test -f "$1"', p)).code === 0) this.addImage(p, cx);
    });
  }

  start(cx) {
    const goal = (this.goal.value() ?? "").trim();
    const p = props() ?? {};
    if (!goal) { this.error = "Write the goal first"; cx.notify(); return; }
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const kept = [];
      for (const img of this.images) if ((await sh('test -f "$1"', img)).code === 0) kept.push(img);
      if (kept.length !== this.images.length) this.images = kept; // files that vanished: drop their chips
      const args = ["mission", "start", goal, "--repo", p.folder, "--parallel", String(this.parallel), "--json"];
      if (this.unattended) args.push("--auto");
      for (const img of this.images) args.push("--image", img);
      if (p.space && !p.space.includes("/")) args.push("--space", p.space);
      const r = await exec("drover", args, { timeout: 180_000 }).catch((e) => ({ code: 1, stderr: String(e) }));
      this.busy = false;
      if (r.code !== 0) {
        let why = r.stderr.trim();
        try { const d = JSON.parse(r.stdout); if (d.rejected) why = "Nowhere to run the coordinator: " + d.rejected.map((x) => `${x.machine ?? x.agent}: ${x.why}`).join("; "); } catch (_) { /* plain error */ }
        this.error = why || "could not start";
        cx.notify();
        return;
      }
      let d = null;
      try { d = JSON.parse(r.stdout); } catch (_) { /* started, but no JSON */ }
      await this.saveDraft(true); // started: clear the draft, keep the Unattended choice
      notify({ title: "Mission started", body: d?.route ? `${d.route.agent} coordinates on ${d.route.machine}` : "Coordinator starting", level: "info", timeout: 4000 });
      closeOverlay(props().overlay);
    });
  }

  render(cx) {
    const t = theme();
    const p = props() ?? {};
    const step = (id, label, d) => div().id(id).w(24).h(24).flex().items_center().justify_center().rounded(6).cursor_pointer()
      .border(1).border_color(t.input).text_color(t.muted).hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.parallel = Math.max(1, Math.min(8, this.parallel + d)); cx.notify(); }).child(label);
    return v_flex().id("root").track_focus(this.handle)
      .on_key_down((e, cx) => { if (e.key === "escape") { this.close(); cx.stop_propagation(); } })
      .on_drop((e, cx) => this.dropFiles(e.paths, cx))
      .size_full().bg(t.popover).text_color(t.foreground).p(18).gap(12)
      .child(h_flex().gap(10).items_center()
        .child(div().w(30).h(30).flex().items_center().justify_center().rounded(8).bg(t.accent)
          .child(svg("mods/drover-rail/drover.svg").size(20).text_color(t.accent_foreground)))
        .child(div().flex_1()
          .child(div().text_size(15).font_semibold().child("Start a mission"))
          .child(div().text_size(11).text_color(t.dim).child(p.folder ?? "")))
        .child(div().id("close").w(26).h(26).flex().items_center().justify_center().rounded(6).cursor_pointer()
          .hover((s) => s.bg(t.hover)).on_click(() => this.close())
          .child(svg("mods/workspace-chrome/x.svg").size(14).text_color(t.muted))))
      .child(Textarea.new(this.goal).h(130).px(10).py(8).rounded(8).border(1).border_color(t.accent).bg(t.background).text_size(13))
      .children(this.images.length ? [h_flex().gap(6).flex_wrap().children(this.images.map((p, i) =>
        h_flex().id("img" + i).gap(6).items_center().pl(4).pr(6).py(4).rounded(6).border(1).border_color(t.input).text_size(11).text_color(t.muted)
          .tooltip(p)
          .child(div().w(28).h(28).rounded(4).overflow_hidden().bg(t.background).child(image(p).w(28).h(28)))
          .child(div().max_w(120).overflow_hidden().child(base(p)))
          .child(div().id("rm" + i).w(18).h(18).flex().items_center().justify_center().rounded(4).cursor_pointer()
            .hover((s) => s.bg(t.hover)).on_click((_e, cx) => { this.images.splice(i, 1); this.saveSoon(cx); cx.notify(); })
            .child(svg("mods/workspace-chrome/x.svg").size(10).text_color(t.muted))))) ] : [])
      .child(div().text_size(11).text_color(t.dim).child("Paste a screenshot or drop an image file to attach it."))
      .child(h_flex().gap(10).items_center().text_size(12).text_color(t.muted)
        .child(div().id("unattended").flex().items_center().gap(6).cursor_pointer()
          .tooltip("Unattended: this mission's agents don't stop to ask for approvals (drover mission start --auto). Turn it off to approve each step yourself.")
          .on_click((_e, cx) => { this.unattended = !this.unattended; this.saveSoon(cx); cx.notify(); })
          .child(div().w(30).h(16).rounded(8).bg(this.unattended ? t.accent : t.input).flex().items_center()
            .justify_start().pl(this.unattended ? 16 : 2)
            .child(div().w(12).h(12).rounded(6).bg(t.popover)))
          .child(div().text_color(this.unattended ? t.foreground : t.muted).child("Unattended")))
        .child(div().w(12))
        .child(div().child("Tasks at once"))
        .child(step("dn", "−", -1)).child(div().w(18).text_color(t.foreground).child(String(this.parallel))).child(step("up", "+", 1))
        .child(div().flex_1())
        .child(div().text_size(11).text_color(t.dim).child("coordinator → workers → cross-family review → merge")))
      .children(this.error ? [div().text_size(12).text_color(t.blocked).child(this.error)] : [])
      .child(div().flex_1())
      .child(h_flex().justify_end().gap(8)
        .child(div().id("cancel").px(14).py(7).rounded(7).cursor_pointer().border(1).border_color(t.input).text_size(13)
          .hover((s) => s.bg(t.hover)).on_click(() => this.close()).child("Cancel"))
        .child(div().id("go").px(14).py(7).rounded(7).cursor_pointer().bg(t.solid).text_color(t.solid_foreground).text_size(13)
          .font_semibold().opacity(this.busy ? 0.5 : 1).hover((s) => s.opacity(0.85)).on_click((_e, cx) => this.start(cx))
          .child(this.busy ? "Starting…" : "Start mission")));
  }
}
