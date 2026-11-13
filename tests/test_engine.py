"""CLI regression tests. All state, Git repos and hc terminals are disposable.

Run with: python3 -m unittest discover tests
"""
import contextlib
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest


ENGINE = Path(__file__).resolve().parents[1] / "engine" / "drover"
FAKE_HC = '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
root = Path(os.environ["FAKE_HC_HOME"])
with (root / "calls.jsonl").open("a") as f:
    f.write(json.dumps(args) + "\\n")
terminals = json.loads((root / "terminals.json").read_text())
if args[0] == "ls":
    print(json.dumps({"terminals": terminals}))
elif args[0] == "get":
    found = next((t for t in terminals if t["address"] == args[1]), None)
    if found is None:
        print("terminal not found", file=sys.stderr)
        sys.exit(1)
    print(json.dumps({"terminal": found}))
elif args[0] == "run":
    n = len(list((root).glob("run-*.json")))
    (root / f"run-{n}.json").write_text(json.dumps(args))
    print(json.dumps({"address": f"fake-{n}"}))
elif args[0] == "send":
    print("{}")
elif args[0] == "read":
    screen = root / "screen.txt"
    print(screen.read_text() if screen.exists() else "", end="")
elif args[0] == "machine":
    print(json.dumps({"machines": []}))
elif args[0] == "exec":
    i = args.index("sh")
    sys.exit(__import__("subprocess").run(args[i:]).returncode)
elif args[0] == "kill":
    terminals = [t for t in terminals if t["address"] != args[1]]
    (root / "terminals.json").write_text(json.dumps(terminals))
    print("{}")
else:
    print("unexpected fake hc command: " + repr(args), file=sys.stderr)
    sys.exit(2)
'''


class EngineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="drover-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.repo.mkdir()
        self.bin = self.root / "bin"
        self.bin.mkdir()
        fake = self.bin / "hc"
        fake.write_text(FAKE_HC)
        fake.chmod(0o755)
        self.env = {**os.environ, "HOME": str(self.root / "home"),
                    "XDG_STATE_HOME": str(self.root / "state"),
                    "XDG_CONFIG_HOME": str(self.root / "config"),
                    "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                    "FAKE_HC_HOME": str(self.root), "GIT_CONFIG_NOSYSTEM": "1",
                    "GIT_CONFIG_GLOBAL": os.devnull, "SHELL": "/bin/bash"}
        self.env.pop("HC_TERMINAL_ID", None)
        self.terminals([])
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Drover Test")
        self.git("config", "user.email", "drover-test@example.invalid")
        (self.repo / "initial").write_text("base\n")
        self.git("add", "initial")
        self.git("commit", "-m", "initial")
        self.now = int(time.time())
        self.local = socket.gethostname().split(".")[0]

    def git(self, *args, cwd=None, check=True):
        return subprocess.run(["git", "-C", str(cwd or self.repo), *args], env=self.env,
                              capture_output=True, text=True, check=check)

    def cli(self, *args, ok=True):
        r = subprocess.run([sys.executable, str(ENGINE), *args], env=self.env, cwd=self.repo,
                           capture_output=True, text=True)
        if ok:
            self.assertEqual(r.returncode, 0, r.stderr)
        else:
            self.assertNotEqual(r.returncode, 0, r.stdout)
        return r

    def output(self, *args):
        return json.loads(self.cli(*args, "--json").stdout)

    def path(self, mid):
        return self.root / "state" / "drover" / "missions" / mid / "mission.json"

    def mission(self, mid="m1", state="running", age=0, **extra):
        data = {"id": mid, "repo": str(self.repo), "project": "test", "goal": "Test goal",
                "state": state, "base": "main", "created": self.now - age,
                "created_ns": (self.now - age) * 10**9, "updated": self.now - age,
                "coordinator": {"address": "coord", "machine": self.local, "agent": "fake"},
                "tasks": {}, "next_task": 2, **extra}
        self.save(data)
        return data

    def save(self, data):
        path = self.path(data["id"])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data))

    def read(self, mid="m1"):
        return json.loads(self.path(mid).read_text())

    def entries(self, mid="m1"):
        return [json.loads(line) for line in self.path(mid).with_name("log.jsonl").read_text().splitlines()]

    def task(self, state="working", **extra):
        return {"id": "t1", "title": "Test task", "state": state, "agent": "fake",
                "machine": self.local, "address": "worker", "branch": "drover/test",
                "worktree": str(self.root / "worktree"), "created": self.now - 4000,
                "updated": self.now - 4000, **extra}

    def terminals(self, addresses):
        (self.root / "terminals.json").write_text(json.dumps([
            {"address": a, "labels": {"drover.role": "worker"},
             "status": {"state": "blocked", "msg": "needs input"}} for a in addresses]))

    def config(self, days):
        path = self.root / "config" / "drover" / "config.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"missions": {"archive_after_days": days}}))

    def test_drop_removes_worktree_branch_and_all_review_terminals(self):
        task = self.task(review={"address": "reviewer"}, review_history=[{"address": "old-reviewer"}])
        self.mission(tasks={"t1": task})
        self.git("worktree", "add", "-b", task["branch"], task["worktree"])
        (Path(task["worktree"]) / "new-work").write_text("abandoned work\n")
        self.git("add", "new-work", cwd=task["worktree"])
        self.git("commit", "-m", "abandoned", cwd=task["worktree"])
        original_head = self.git("rev-parse", "HEAD").stdout
        self.terminals(["coord", "worker", "reviewer", "old-reviewer"])
        r = self.cli("task", "drop", "t1", "redone elsewhere", "--mission", "m1", "--json")
        out = json.loads(r.stdout)
        self.assertEqual(out["unmerged_commits"], 1)
        self.assertIn("commits not in main", r.stderr)
        self.assertEqual(self.read()["tasks"]["t1"]["state"], "dropped")
        self.assertEqual(self.read()["tasks"]["t1"]["reason"], "redone elsewhere")
        self.assertFalse(Path(task["worktree"]).exists())
        self.assertNotEqual(self.git("show-ref", "--verify", "refs/heads/" + task["branch"], check=False).returncode, 0)
        self.assertEqual(self.git("rev-parse", "HEAD").stdout, original_head)
        self.assertEqual(self.entries()[-1]["kind"], "drop")
        remaining = json.loads((self.root / "terminals.json").read_text())
        self.assertEqual([t["address"] for t in remaining], ["coord"])
        self.cli("task", "done", "t1", "late callback", "--mission", "m1", ok=False)
        self.assertEqual(self.read()["tasks"]["t1"]["state"], "dropped")

    def test_drop_clean_branch_and_required_reason(self):
        task = self.task()
        self.mission(tasks={"t1": task})
        self.git("worktree", "add", "-b", task["branch"], task["worktree"])
        self.cli("task", "drop", "t1", "--mission", "m1", ok=False)
        self.assertTrue(Path(task["worktree"]).exists())
        out = self.output("task", "drop", "t1", "not needed", "--mission", "m1")
        self.assertEqual(out["unmerged_commits"], 0)
        self.assertEqual(out["warnings"], [])

    def test_drop_missing_resources_warns_but_records_reason(self):
        self.mission(tasks={"t1": self.task()})
        out = self.output("task", "drop", "t1", "already cleaned up", "--mission", "m1")
        self.assertEqual(out["state"], "dropped")
        self.assertTrue(out["warnings"])
        self.assertEqual(self.entries()[-1]["text"], "already cleaned up")

    def test_done_rejects_active_tasks_unless_forced(self):
        for state in ("working", "review", "changes", "approved"):
            with self.subTest(state=state):
                self.mission(tasks={"t1": self.task(state)})
                r = self.cli("mission", "done", "--mission", "m1", "Delivered", ok=False)
                self.assertIn("t1", r.stderr)
                self.assertEqual(self.read()["state"], "running")
        out = self.output("mission", "done", "--mission", "m1", "Delivered", "--force")
        self.assertEqual(out["summary"], "Delivered")
        self.assertEqual(self.read()["state"], "done")
        self.assertGreaterEqual(self.read()["done_at"], self.now)
        self.assertEqual(self.entries()[-1]["kind"], "done")
        self.assertEqual(self.entries()[-1]["text"], "Delivered")

    def test_done_allows_finished_tasks_and_requires_summary(self):
        self.mission(tasks={"t1": self.task("merged"), "t2": self.task("dropped"), "t3": self.task("done")})
        self.cli("mission", "done", "--mission", "m1", ok=False)
        self.output("mission", "done", "Everything delivered", "--mission", "m1")
        rows = self.output("mission", "list")["missions"]
        self.assertEqual(rows[0]["summary"], "Everything delivered")
        self.assertFalse(rows[0]["archived"])

    def test_archive_unarchive_and_running_refusal(self):
        self.mission()
        for action in ("archive", "unarchive"):
            self.cli("mission", action, "m1", ok=False)
        for state in ("done", "stopped"):
            with self.subTest(state=state):
                self.mission(state=state)
                self.assertTrue(self.output("mission", "archive", "m1")["archived"])
                self.assertTrue(self.read()["archived"])
                self.assertEqual(self.output("mission", "list")["missions"], [])
                self.assertTrue(self.output("mission", "list", "--all")["missions"][0]["archived"])
                self.assertFalse(self.output("mission", "unarchive", "m1")["archived"])
                self.assertFalse(self.output("mission", "list")["missions"][0]["archived"])
                self.assertEqual(self.entries()[-1]["kind"], "unarchive")

    def test_auto_archive_uses_completion_time_config_and_unarchive(self):
        self.mission("old", "done", age=8 * 86400, summary="Old result")
        self.mission("stopped", "stopped", age=20 * 86400)
        self.mission("recent", "done", age=30 * 86400, done_at=self.now)
        rows = self.output("mission", "list")["missions"]
        self.assertEqual({r["id"] for r in rows}, {"stopped", "recent"})
        all_rows = self.output("mission", "list", "--all")["missions"]
        self.assertTrue(next(r for r in all_rows if r["id"] == "old")["archived"])
        self.config(10)
        self.assertIn("old", {r["id"] for r in self.output("mission", "list")["missions"]})
        self.config(7)
        self.output("mission", "unarchive", "old")
        self.assertIn("old", {r["id"] for r in self.output("mission", "list")["missions"]})
        # Unrelated state writes must not postpone automatic archiving.
        self.mission("finished", "done", done_at=self.now - 8 * 86400)
        self.assertNotIn("finished", {r["id"] for r in self.output("mission", "list")["missions"]})

    def test_dashboard_selection_filters_and_json_fields(self):
        self.mission("running-older", age=100)
        self.mission("running-newer", age=50)
        self.mission("done-newest", "done", summary="Shipped", age=10)
        self.mission("archived", "stopped", archived=True)
        d = self.output("dashboard", "--repo", str(self.repo))
        self.assertEqual(d["mission"]["id"], "running-newer")
        self.assertNotIn("archived", {r["id"] for r in d["missions"]})
        d = self.output("dashboard", "--all", "--mission", "archived")
        self.assertTrue(d["mission"]["archived"])
        self.assertEqual(len(d["missions"]), 4)
        self.assertEqual(d["impediments"], [])
        self.cli("dashboard", "--mission", "archived", "--json", ok=False)
        for mid in ("running-older", "running-newer"):
            data = self.read(mid)
            data["state"] = "stopped"
            self.save(data)
        for flags in ((), ("--all",)):
            d = self.output("dashboard", *flags)
            self.assertEqual(d["mission"]["id"], "done-newest")
            self.assertEqual(d["mission"]["summary"], "Shipped")
            self.assertFalse(d["mission"]["archived"])
        self.assertEqual(self.output("dashboard", "--repo", str(self.root))["missions"], [])

    def test_peek_strips_ansi_and_trailing_blanks(self):
        self.mission(tasks={"t1": {"id": "t1", "title": "T", "state": "working", "address": "w1", "created": self.now,
                                   "updated": self.now, "agent": "fake"}})
        self.terminals(["coord", "w1"])
        (self.root / "screen.txt").write_text("\x1b[1;32mhello\x1b[0m world\r\n\x1b]0;title\x07second\n\n   \n")
        d = self.output("peek", "t1", "--lines", "5", "--mission", "m1")
        self.assertEqual(d, {"who": "t1", "address": "w1", "lines": ["hello world", "second"],
                             "status": "blocked", "msg": "needs input"})
        calls = [json.loads(x) for x in (self.root / "calls.jsonl").read_text().splitlines()]
        self.assertIn(["read", "w1", "--lines", "5"], calls)
        self.cli("peek", "t9", "--mission", "m1", ok=True)  # an unknown name is taken as an hc address
        self.cli("peek", "review:t1", "--mission", "m1", ok=False)

    def test_activity_text(self):
        d = EngineTests.engine_module()
        self.assertEqual(d.activity_text("blocked", "needs input"), "waiting for you")
        self.assertEqual(d.activity_text("working", "  editing   foo.py "), "editing foo.py")
        self.assertEqual(d.activity_text("idle", None), "idle")
        until = time.time() + 600
        self.assertEqual(d.activity_text("working", "x", until), f"sleeping until {d.fmt_until(until)}")

    def test_dashboard_since_activity_and_needs_you(self):
        task = {"id": "t1", "title": "T", "state": "working", "address": "w1", "created": self.now - 100,
                "updated": self.now, "agent": "fake", "worktree": str(self.root)}
        self.mission(tasks={"t1": task, "t2": {**task, "id": "t2", "state": "approved", "address": None}})
        self.terminals(["w1"])
        terms = json.loads((self.root / "terminals.json").read_text())
        terms[0]["status_ms"] = (self.now - 30) * 1000
        (self.root / "terminals.json").write_text(json.dumps(terms))
        log = self.path("m1").parent / "log.jsonl"
        log.write_text(json.dumps({"at": self.now, "kind": "merge", "from": "x", "to": "x", "task": "t2",
                                   "failed": True, "text": "conflict"}) + "\n")
        d = self.output("dashboard", "--repo", str(self.repo))
        w = next(a for a in d["agents"] if a["who"] == "t1")
        self.assertEqual((w["since"], w["activity"]), (self.now - 30, "waiting for you"))
        c = next(a for a in d["agents"] if a["who"] == "coordinator")
        self.assertEqual(c["activity"], "terminal closed")
        actions = {n["who"]: n["action"] for n in d["needs_you"]}
        self.assertEqual(actions["t1"], "hc attach w1")
        self.assertEqual(actions["t2"], "drover task merge t2 --mission m1")
        self.assertFalse(any(n["kind"] == "gone" for n in d["needs_you"]))

    def test_token_scan_is_cached_for_30_seconds(self):
        d = EngineTests.engine_module()
        os.environ["XDG_STATE_HOME"] = str(self.root / "state")
        d.STATE_DIR = str(self.root / "state" / "drover")
        os.makedirs(d.STATE_DIR, exist_ok=True)
        scans = []
        d.TokenUsage._scan = lambda self, *a: scans.append(a) or {"total": len(scans)}
        u = d.TokenUsage()
        self.assertEqual(u.get("claude", "/x", 5, None), {"total": 1})
        u.save()
        u2 = d.TokenUsage()
        self.assertEqual(u2.get("claude", "/x", 5, None), {"total": 1})
        self.assertEqual(len(scans), 1)
        u2.results = {k: [t - 31, v] for k, (t, v) in u2.results.items()}
        self.assertEqual(u2.get("claude", "/x", 5, None), {"total": 2})

    @staticmethod
    def engine_module():
        import importlib.machinery, importlib.util
        loader = importlib.machinery.SourceFileLoader("drover_engine", str(ENGINE))
        mod = importlib.util.module_from_spec(importlib.util.spec_from_loader("drover_engine", loader))
        loader.exec_module(mod)
        return mod

    def test_dashboard_capacity_field_and_text(self):
        now = int(time.time())
        state = self.root / "state" / "drover"
        state.mkdir(parents=True, exist_ok=True)
        (state / "capacity.json").write_text(json.dumps({
            "codex": {"until": now + 7200, "reason": "usage limit reached", "since": now},
            "claude": {"until": now + 600, "reason": "limit", "since": now, "machine": "box"},
            "cursor": {"until": now - 5, "reason": "stale", "since": now - 100}}))
        d = self.output("dashboard", "--repo", str(self.repo))
        self.assertIsNone(d["mission"])
        self.assertEqual([c["agent"] for c in d["capacity"]], ["claude", "codex"])
        self.assertEqual(d["capacity"][1]["name"], "Codex")
        self.assertEqual(d["capacity"][0]["machine"], "box")
        self.assertIsNone(d["capacity"][1]["machine"])
        self.assertEqual(d["capacity"][1]["reason"], "usage limit reached")
        text = self.cli("dashboard", "--repo", str(self.repo)).stdout
        self.assertIn("Out: Codex until ", text)
        self.assertIn("(usage limit reached)", text)
        (state / "capacity.json").unlink()
        self.assertEqual(self.output("dashboard", "--repo", str(self.repo))["capacity"], [])
        self.assertIsInstance(d["usage"], list)

    def test_dashboard_only_archived_has_no_default_selection(self):
        self.mission(state="done", age=8 * 86400)
        self.assertEqual(self.output("dashboard")["missions"], [])
        self.assertIsNone(self.output("dashboard", "--all")["mission"])
        self.assertTrue(self.output("dashboard", "--all", "--mission", "m1")["mission"]["archived"])

    def test_dashboard_dropped_done_and_archived_have_no_impediments(self):
        data = self.mission(tasks={"t1": self.task("dropped", reason="Replaced", review={"address": "reviewer"})})
        self.terminals(["worker", "reviewer"])
        self.path("m1").with_name("log.jsonl").write_text(json.dumps(
            {"kind": "merge", "failed": True, "task": "t1", "text": "merge conflict", "at": self.now}) + "\n")
        d = self.output("dashboard")
        self.assertEqual(d["tasks"][0]["reason"], "Replaced")
        self.assertFalse(any(i["task"] == "t1" for i in d["impediments"]))
        self.assertTrue(any(i["kind"] == "gone" for i in d["impediments"]))
        self.terminals([])
        self.assertFalse(any(i["task"] == "t1" for i in self.output("dashboard")["impediments"]))
        for state, archived in (("done", False), ("stopped", True)):
            data.update(state=state, archived=archived, tasks={"t1": self.task("changes")})
            self.save(data)
            self.terminals(["coord", "worker"])
            d = self.output("dashboard", "--all", "--mission", "m1")
            self.assertEqual(d["impediments"], [])

    # ---- unattended missions and images

    def fleet(self):
        path = self.root / "state" / "drover" / "fleet.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"updated": int(time.time()) + 3600, "machines": [{
            "name": self.local, "local": True, "online": True, "home": str(self.root), "disk_free_gb": 500,
            "tools": ["claude", "codex", "cursor-agent", "copilot", "git", "hc"]}]}))

    def runs(self):
        """argv after `--` of every hc run, oldest first."""
        files = sorted(self.root.glob("run-*.json"), key=lambda p: int(p.stem.split("-")[1]))
        runs = [json.loads(f.read_text())[json.loads(f.read_text()).index("--") + 1:] for f in files]
        return [r for r in runs if r[-1] != "watch"]  # the watcher is not an agent

    def watcher_runs(self):
        files = sorted(self.root.glob("run-*.json"), key=lambda p: int(p.stem.split("-")[1]))
        return [json.loads(f.read_text()) for f in files if json.loads(f.read_text())[-1] == "watch"]

    def write_config(self, **extra):
        path = self.root / "config" / "drover" / "config.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({"machines": {self.local: {"durable": True}}, **extra}))

    def start(self, *flags, goal="Do it"):
        self.fleet()
        if not (self.root / "config" / "drover" / "config.json").exists():
            self.write_config()
        return self.output("mission", "start", goal, "--repo", str(self.repo), *flags)

    def mission_id(self, out):
        return out["mission"]["id"]

    def test_auto_flags_reach_coordinator_worker_and_reviewer(self):
        mid = self.mission_id(self.start("--auto"))
        self.assertTrue(self.read(mid)["auto"])
        self.assertEqual(self.runs()[0][:3], ["claude", "--permission-mode", "auto"])
        d = self.read(mid)
        d["tasks"] = {"t1": self.task("done", family="openai")}
        self.save(d)
        self.output("task", "add", "Build", "--mission", mid)
        self.assertEqual(self.runs()[1][:2], ["codex", "--dangerously-bypass-approvals-and-sandbox"])
        self.output("task", "review", "t1", "--mission", mid)
        self.assertEqual(self.runs()[2][:3], ["claude", "--permission-mode", "auto"])

    def test_config_auto_args_override_defaults(self):
        self.write_config(agents={"claude": {"auto_args": ["--my-flag"]}})
        self.start("--auto")
        argv = self.runs()[0]
        self.assertEqual(argv[:2], ["claude", "--my-flag"])
        self.assertNotIn("--permission-mode", argv)
        # An empty list switches the defaults off.
        self.write_config(agents={"claude": {"auto_args": []}})
        self.start("--auto", goal="Another")
        self.assertEqual(self.runs()[1][0:2], ["claude", "--model"])

    def test_without_auto_nothing_changes(self):
        mid = self.mission_id(self.start())
        d = self.read(mid)
        self.assertFalse(d["auto"])
        self.assertEqual(d["images"], [])
        self.assertEqual(self.runs()[0][:2], ["claude", "--model"])
        self.assertNotIn("--permission-mode", self.runs()[0])
        self.output("task", "add", "Build", "--mission", mid)
        self.assertNotIn("--dangerously-bypass-approvals-and-sandbox", self.runs()[1])
        brief = self.runs()[0][-1]
        self.assertNotIn("AUTO", brief)
        self.assertNotIn("Attached images", brief)

    def test_images_are_copied_listed_and_briefed(self):
        one, two = self.root / "a.png", self.root / "b"
        one.write_bytes(b"png")
        two.write_bytes(b"raw")
        out = self.start("--image", str(one), "--image", str(two))
        mid = self.mission_id(out)
        images = self.read(mid)["images"]
        mdir = self.path(mid).parent / "images"
        self.assertEqual(images, [str(mdir / "1.png"), str(mdir / "2.img")])
        self.assertEqual((mdir / "1.png").read_bytes(), b"png")
        brief = self.runs()[0][-1]
        self.assertIn(images[0], brief)
        self.assertIn("Read them", brief)
        shown = self.output("mission", "show", "--mission", mid)
        self.assertEqual(shown["images"], images)
        self.assertFalse(shown["auto"])
        dash = self.output("dashboard", "--repo", str(self.repo), "--mission", mid)
        self.assertEqual(dash["mission"]["images"], images)
        self.assertFalse(dash["mission"]["auto"])

    def test_missing_image_dies_before_anything_starts(self):
        self.fleet()
        self.write_config()
        r = self.cli("mission", "start", "Do it", "--repo", str(self.repo), "--image", str(self.root / "nope.png"), ok=False)
        self.assertIn("nope.png", r.stderr)
        self.assertEqual(self.runs(), [])
        self.assertFalse((self.root / "state" / "drover" / "missions").exists())

    def test_existing_coordinator_is_told_about_auto_and_images(self):
        self.fleet()
        self.write_config()
        self.terminals([])
        (self.root / "terminals.json").write_text(json.dumps([{
            "address": "coord", "cwd": str(self.repo),
            "labels": {"drover.role": "coordinator", "drover.repo": str(self.repo), "drover.agent": "claude"}}]))
        img = self.root / "x.jpg"
        img.write_bytes(b"jpg")
        out = self.output("mission", "start", "Second", "--repo", str(self.repo), "--auto", "--image", str(img))
        self.assertTrue(out["reused"])
        self.assertEqual(self.runs(), [])
        sent = [c for c in map(json.loads, (self.root / "calls.jsonl").read_text().splitlines()) if c[0] == "send"]
        self.assertIn("AUTO", sent[-1][2])
        self.assertIn(self.read(self.mission_id(out))["images"][0], sent[-1][2])
        # Workers of that mission still start with the flags.
        mid = self.mission_id(out)
        self.output("task", "add", "Build", "--mission", mid)
        self.assertIn("--dangerously-bypass-approvals-and-sandbox", self.runs()[0])

    def test_map_outline(self):
        r = self.root / "maprepo"
        (r / "node_modules" / "x").mkdir(parents=True)
        (r / ".git").mkdir()
        (r / "node_modules" / "x" / "i.js").write_text("function skipped() {}\n")
        (r / ".git" / "c").write_text("x\n")
        (r / "a.py").write_text("import os\n\ndef foo():\n    pass\n\nclass Bar:\n    def inner(self): pass\n")
        (r / "b.js").write_text("export function baz() {}\nconst qux = async () => 1\nclass K {}\n")
        (r / "bin.dat").write_bytes(b"\0\1\2")
        out = self.cli("map", "--repo", str(r)).stdout
        self.assertIn("a.py  7", out)
        self.assertIn("foo:3", out)
        self.assertIn("class Bar:6", out)
        self.assertNotIn("inner", out)
        self.assertIn("baz:1", out)
        self.assertIn("qux:2", out)
        self.assertIn("class K:3", out)
        for hidden in ("skipped", "node_modules", ".git", "bin.dat"):
            self.assertNotIn(hidden, out)
        data = json.loads(self.cli("map", "--repo", str(r), "--json").stdout)
        self.assertEqual({f["path"] for f in data["files"]}, {"a.py", "b.js"})


class CursorPretrustTests(unittest.TestCase):
    def setUp(self):
        import importlib.machinery, importlib.util
        loader = importlib.machinery.SourceFileLoader("drover_engine", str(ENGINE))
        self.engine = importlib.util.module_from_spec(importlib.util.spec_from_loader("drover_engine", loader))
        loader.exec_module(self.engine)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name).resolve()
        self.home = home
        saved = {k: os.environ.get(k) for k in ("HOME", "XDG_STATE_HOME")}
        os.environ["HOME"] = str(home)
        os.environ["XDG_STATE_HOME"] = str(home / "state")
        self.addCleanup(lambda: [os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
                                 for k, v in saved.items()])
        self.repo = home / "my.repo_x"
        self.repo.mkdir()
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        self.sub = self.repo / "sub"
        self.sub.mkdir()

    def marker(self, root):
        slug = "".join(c if c.isalnum() else "-" for c in str(root))
        import re
        slug = re.sub(r"-+", "-", slug).strip("-")
        return self.home / ".cursor" / "projects" / slug / ".workspace-trusted"

    def trust(self, *paths):
        self.engine.pretrust_config("cursor", list(map(str, paths)), *self.engine.PRETRUST_CONFIGS["cursor"][0:2])

    def test_missing_creates_marker_for_git_toplevel(self):
        self.trust(self.repo, self.sub)
        data = json.loads(self.marker(self.repo).read_text())
        self.assertEqual(data["workspacePath"], str(self.repo))
        self.assertTrue(data["trustedAt"].endswith("Z"))
        self.assertEqual(len(list((self.home / ".cursor" / "projects").iterdir())), 1)

    def test_empty_file_and_existing_entries_preserved(self):
        marker = self.marker(self.repo)
        marker.parent.mkdir(parents=True)
        marker.write_text("")
        other = self.marker(self.home / "other")
        other.parent.mkdir(parents=True)
        other.write_text('{"trustedAt": "x", "workspacePath": "/other"}')
        self.trust(self.repo)
        self.assertEqual(json.loads(marker.read_text())["workspacePath"], str(self.repo))
        self.assertEqual(json.loads(other.read_text())["trustedAt"], "x")

    def test_idempotent_keeps_original_timestamp(self):
        self.trust(self.repo)
        first = self.marker(self.repo).read_text()
        time.sleep(1.1)
        self.trust(self.repo)
        self.assertEqual(self.marker(self.repo).read_text(), first)


def load_engine(state):
    import importlib.machinery, importlib.util
    os.environ["XDG_STATE_HOME"] = state
    loader = importlib.machinery.SourceFileLoader("drover_engine", str(ENGINE))
    spec = importlib.util.spec_from_loader("drover_engine", loader)
    mod = importlib.util.module_from_spec(spec)
    loader.exec_module(mod)
    return mod


class CapacityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="drover-cap-")
        self.addCleanup(self.temp.cleanup)
        old = os.environ.get("XDG_STATE_HOME")
        self.addCleanup(lambda: os.environ.__setitem__("XDG_STATE_HOME", old) if old else os.environ.pop("XDG_STATE_HOME", None))
        self.d = load_engine(self.temp.name)
        self.real_probe = self.d.usage_probe
        self.d.usage_probe = lambda *a, **k: None  # no real usage files or hc in routing tests
        import datetime
        self.dt = datetime
        # A fixed local "now": 2026-11-13 10:00.
        self.now = datetime.datetime(2026, 11, 13, 10, 0).timestamp()

    def at(self, day, h, m=0):
        return int(self.dt.datetime(2026, 11, day, h, m).timestamp())

    def test_detect_relative(self):
        for agent, text, secs in [
            ("codex", "■ You've hit your usage limit. Upgrade to Pro or try again in 2 hours 14 minutes.", 2 * 3600 + 14 * 60),
            ("claude", "Claude usage limit reached. Try again in 2h 14m", 2 * 3600 + 14 * 60),
            ("copilot", "Error: rate limit exceeded. Retry in 45 minutes", 45 * 60),
            ("cursor-agent", "You've hit your usage limit. Try again in 3 days", 3 * 86400),
        ]:
            until, reason = self.d.detect_capacity(agent, text, now=self.now)
            self.assertEqual(until, int(self.now) + secs, (agent, text))
            self.assertIn("limit", reason)

    def test_detect_clock(self):
        d = self.d
        self.assertEqual(d.detect_capacity("claude", "5-hour limit reached ∙ resets 3pm", self.now)[0], self.at(13, 15))
        self.assertEqual(d.detect_capacity("claude", "5-hour limit reached ∙ resets 9am", self.now)[0], self.at(14, 9))
        self.assertEqual(d.detect_capacity("codex", "You've hit your usage limit. try again at 4:15 PM.", self.now)[0], self.at(13, 16, 15))
        self.assertEqual(d.detect_capacity("codex", "usage limit reached, try again at 17:30", self.now)[0], self.at(13, 17, 30))
        self.assertEqual(d.detect_capacity("codex", "You've hit your usage limit. try again at Nov 20th, 2026 3:05 AM", self.now)[0], self.at(20, 3, 5))
        self.assertEqual(d.detect_capacity("copilot", "You've reached your premium usage limit. Resets tomorrow at 8:00 AM", self.now)[0], self.at(14, 8))

    def test_detect_default_and_none(self):
        until, reason = self.d.detect_capacity("cursor", "You've hit your usage limit", self.now)
        self.assertEqual((until, reason), (int(self.now) + 3600, "usage limit"))
        self.assertIsNone(self.d.detect_capacity("claude", "All tests passed. Working on the parser.", self.now))
        self.assertIsNone(self.d.detect_capacity("claude", "", self.now))

    def test_store_expiry(self):
        d = self.d
        now = int(time.time())
        d.mark_out("claude", now + 100, "usage limit")
        d.mark_out("codex", now - 5, "stale", machine="box")
        self.assertEqual(set(d.agents_out()), {"claude"})
        self.assertEqual(d.agents_out(now + 200), {})
        self.assertTrue(d.clear_out("claude"))
        self.assertFalse(d.clear_out("claude"))

    def test_route_skips_out_agent(self):
        d = self.d
        now = int(time.time())
        d.fleet = lambda cfg, max_age=0: {"machines": [{
            "name": "m1", "online": True, "tools": ["claude", "codex", "cursor-agent"], "disk_free_gb": 500}]}
        d.drover_terminals = lambda strict=False: []
        cfg = d.merged(d.DEFAULT_CONFIG, {})
        self.assertEqual(d.route(cfg, "worker")["agent"], "codex")
        d.mark_out("codex", now + 3600, "usage limit")
        dec = d.route(cfg, "worker")
        self.assertEqual(dec["agent"], "claude")
        self.assertTrue(any(r.get("agent") == "codex" and r["why"].startswith("out of capacity until ")
                            and "(usage limit)" in r["why"] for r in dec["rejected"]))
        # Out on another machine only: still usable here.
        d.clear_out("codex")
        d.mark_out("codex", now + 3600, "usage limit", machine="elsewhere")
        self.assertEqual(d.route(cfg, "worker")["agent"], "codex")
        # Everything out: no decision.
        for a in ("codex", "claude", "cursor"):
            d.mark_out(a, now + 3600, "usage limit")
        dec = d.route(cfg, "worker")
        self.assertIsNone(dec["agent"])

    def test_route_alias(self):
        d = self.d
        d.fleet = lambda cfg, max_age=0: {"machines": [{
            "name": "m1", "online": True, "tools": ["cursor-agent"], "disk_free_gb": 500}]}
        d.drover_terminals = lambda strict=False: []
        cfg = d.merged(d.DEFAULT_CONFIG, {})
        self.assertEqual(d.route(cfg, "worker")["agent"], "cursor")
        d.mark_out("cursor-agent", time.time() + 3600, "usage limit")
        self.assertIn("cursor", d.agents_out())
        self.assertIsNone(d.route(cfg, "worker")["agent"])
        self.assertTrue(d.clear_out("cursor-agent"))
        self.assertEqual(d.route(cfg, "worker")["agent"], "cursor")

    def test_cli(self):
        env = {**os.environ, "XDG_STATE_HOME": self.temp.name}
        def run(*a):
            r = subprocess.run([sys.executable, str(ENGINE), "agent", *a, "--json"], env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            return json.loads(r.stdout)
        env["DROVER_CLAUDE_LIMITS"] = env["CODEX_HOME"] = os.path.join(self.temp.name, "none")
        self.assertEqual(run("list"), {"out": {}, "usage": []})
        out = run("out", "claude", "--until", "2h", "--reason", "weekly")
        self.assertEqual(out["reason"], "weekly")
        self.assertIn("claude", run("list")["out"])
        self.assertTrue(run("clear", "claude")["cleared"])
        self.assertEqual(run("list")["out"], {})

    def test_cli_list_shows_usage(self):
        now = int(time.time())
        limits = Path(self.temp.name) / "limits.json"
        limits.write_text(json.dumps({"ts": now, "rate_limits": {"seven_day": {"used_percentage": 78, "resets_at": now + 86400}}}))
        env = {**os.environ, "XDG_STATE_HOME": self.temp.name, "DROVER_CLAUDE_LIMITS": str(limits),
               "CODEX_HOME": os.path.join(self.temp.name, "none")}
        r = subprocess.run([sys.executable, str(ENGINE), "agent", "list", "--text"], env=env, capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("Claude Code: used 78% of 7d window, resets ", r.stdout)

    def write_codex(self, root, events):
        day = Path(root) / "sessions" / "2026" / "11" / "13"
        day.mkdir(parents=True, exist_ok=True)
        lines = [json.dumps({"timestamp": ts, "type": "event_msg", "payload": {"type": "token_count", "rate_limits": rl}})
                 for ts, rl in events]
        (day / "rollout-x.jsonl").write_text("\n".join(['{"type":"session_meta"}'] + lines) + "\n")

    def test_usage_codex_fixture(self):
        now = int(time.time())
        home = Path(self.temp.name) / "codex"
        stamp = lambda t: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(t))
        self.write_codex(home, [
            (stamp(now - 600), {"primary": {"used_percent": 5.0, "window_minutes": 300, "resets_at": now + 100},
                                "secondary": {"used_percent": 9.0, "window_minutes": 10080, "resets_at": now + 5000}}),
            # latest: relative resets_in_seconds on the 5h window, absolute on the weekly one
            (stamp(now - 60), {"primary": {"used_percent": 93.0, "window_minutes": 300, "resets_in_seconds": 1800},
                               "secondary": {"used_percent": 19.0, "window_minutes": 10080, "resets_at": now + 400000}})])
        os.environ["CODEX_HOME"] = str(home)
        self.addCleanup(os.environ.pop, "CODEX_HOME", None)
        u = self.real_probe("codex", None, now=now)
        self.assertEqual((u["used_percent"], u["window"]), (93.0, "5h"))
        self.assertAlmostEqual(u["resets_at"], now - 60 + 1800, delta=2)
        self.assertTrue(u["source"].endswith("rollout-x.jsonl"))
        # cached in the capacity store under its own key, and not mistaken for an outage
        self.assertIn("codex@local", json.loads(Path(self.d.CAPACITY).read_text())["usage"])
        self.assertEqual(self.d.agents_out(), {})
        self.d.mark_out("claude", now + 100, "x")
        self.assertIn("usage", json.loads(Path(self.d.CAPACITY).read_text()))
        # a window that already reset is no information
        self.write_codex(home, [(stamp(now - 9000), {"primary": {"used_percent": 99, "window_minutes": 300, "resets_at": now - 100}})])
        self.assertIsNone(self.real_probe("codex", None, now=now, max_age=0))

    def test_usage_claude_fixture_and_none_sources(self):
        now = int(time.time())
        limits = Path(self.temp.name) / "limits.json"
        limits.write_text(json.dumps({"ts": now - 30, "rate_limits": {
            "five_hour": {"used_percentage": 40, "resets_at": now + 3000},
            "seven_day": {"used_percentage": 79, "resets_at": now + 90000}}}))
        os.environ["DROVER_CLAUDE_LIMITS"] = str(limits)
        self.addCleanup(os.environ.pop, "DROVER_CLAUDE_LIMITS", None)
        u = self.real_probe("claude", None, now=now)
        self.assertEqual((u["used_percent"], u["window"], u["resets_at"]), (79, "7d", now + 90000))
        self.assertEqual(u["read_at"], now - 30)
        limits.unlink()
        self.assertIsNone(self.real_probe("claude", None, now=now, max_age=0))
        for agent in ("cursor-agent", "copilot"):  # no local source exists
            self.assertIsNone(self.real_probe(agent, None, now=now))

    def test_route_quota(self):
        d = self.d
        now = int(time.time())
        d.fleet = lambda cfg, max_age=0: {"machines": [{
            "name": "m1", "online": True, "tools": ["claude", "codex", "cursor-agent"], "disk_free_gb": 500}]}
        d.drover_terminals = lambda strict=False: []
        d.hc_target = lambda name: name
        cfg = d.merged(d.DEFAULT_CONFIG, {})
        usage = {}
        d.usage_probe = lambda agent, machine=None, *a, **k: usage.get(agent)
        row = lambda pct, win="5h": {"used_percent": pct, "window": win, "resets_at": now + 7200, "source": "t", "read_at": now}
        # over the threshold: out until the reset, with the reason, and remembered
        usage["codex"] = row(93)
        dec = d.route(cfg, "worker")
        self.assertEqual(dec["agent"], "claude")
        self.assertTrue(any(r["agent"] == "codex" and "used 93% of 5h window" in r["why"] for r in dec["rejected"]))
        out = d.agents_out()["codex"]
        self.assertEqual((out["until"], out["reason"], out["machine"]), (now + 7200, "used 93% of 5h window", "m1"))
        d.clear_out("codex")
        # headroom: first choice at 80%, a later one known to be at 20%: the later one wins and says why
        usage.update(codex=row(80), claude=row(20, "7d"))
        dec = d.route(cfg, "worker")
        self.assertEqual(dec["agent"], "claude")
        self.assertTrue(any(r["agent"] == "codex" and "headroom" in r["why"] for r in dec["rejected"]))
        # unknown usage on the later choice is not headroom; the first choice stays
        usage.pop("claude")
        self.assertEqual(d.route(cfg, "worker")["agent"], "codex")
        # everything is tight: chain order decides
        usage.update(claude=row(85))
        self.assertEqual(d.route(cfg, "worker")["agent"], "codex")
        # prefer_headroom off: chain order, even at 80%
        usage.update(claude=row(20))
        off = d.merged(d.DEFAULT_CONFIG, {"quota": {"prefer_headroom": False}})
        self.assertEqual(d.route(off, "worker")["agent"], "codex")
        # an explicit agent beats the headroom preference (81% > 75%) but not avoid_above_percent (95% > 90%)
        cfg = d.merged(d.DEFAULT_CONFIG, {"quota": {"prefer_headroom": True, "headroom_percent": 75}})
        usage.update(codex=row(10), claude=row(81, "7d"))
        dec = d.route(cfg, "worker", prefer_agent="claude")
        self.assertEqual(dec["agent"], "claude")
        self.assertIn("headroom", dec["note"])
        self.assertNotIn("fallback", dec)
        usage.update(claude=row(95, "7d"))
        dec = d.route(cfg, "worker", prefer_agent="claude")
        self.assertEqual(dec["agent"], "codex")
        self.assertIn("fallback", dec)
        d.clear_out("claude")
        self.assertEqual(d.route(cfg, "worker", prefer_agent="claude", prefer_force=True)["agent"], "claude")


class TaskQueueTests(unittest.TestCase):
    """--agent, --after and dependent starts, in process with start_agent/hc replaced."""

    def setUp(self):
        import argparse
        self.argparse = argparse
        self.temp = tempfile.TemporaryDirectory(prefix="drover-queue-")
        self.addCleanup(self.temp.cleanup)
        old = os.environ.get("XDG_STATE_HOME")
        self.addCleanup(lambda: os.environ.__setitem__("XDG_STATE_HOME", old) if old else os.environ.pop("XDG_STATE_HOME", None))
        self.d = d = load_engine(self.temp.name)
        self.cfg = d.merged(d.DEFAULT_CONFIG, {})
        d.usage_probe = lambda *a, **k: None  # never read this machine's real usage in routing tests
        self.repo = Path(self.temp.name) / "repo"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "t")
        self.git("config", "user.email", "t@example.invalid")
        (self.repo / "f").write_text("x\n")
        self.git("add", "f")
        self.git("commit", "-m", "init")
        os.makedirs(os.path.join(d.MISSIONS, "m1"))
        self.sent, self.started = [], []
        d.hc_send = lambda addr, text: self.sent.append((addr, text)) or (True, "")
        d.hc = lambda args, timeout=0: (0, "", "")
        self.fleet = {"machines": [{"name": d.local_name(), "online": True,
                                    "tools": ["claude", "codex", "cursor-agent"], "disk_free_gb": 500}]}
        d.fleet = lambda cfg, max_age=0: self.fleet
        d.drover_terminals = lambda strict=False: []
        d.start_agent = self.fake_start

    def git(self, *args):
        subprocess.run(["git", "-C", str(self.repo), *args], check=True, capture_output=True,
                       env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1"})

    def fake_start(self, cfg, role, repo, message, title, **kw):
        d = self.d
        dec = d.route(cfg, role, families_to_avoid=kw.get("avoid", ()), prefer_agent=kw.get("prefer_agent"),
                      prefer_model=kw.get("prefer_model"))
        if dec["agent"]:
            dec.update(address=f"addr{len(self.started)}", cwd="/wt/" + kw.get("name", ""), branch=kw.get("branch", ""))
            self.started.append({"role": role, "title": title, **dec})
        return dec

    def mission(self, tasks=None, parallel=3):
        data = {"id": "m1", "repo": str(self.repo), "project": "p", "goal": "g", "state": "running", "base": "main",
                "parallel": parallel, "created": 1, "updated": 1,
                "coordinator": {"address": "coord", "machine": self.d.local_name(), "agent": "fake"},
                "tasks": tasks or {}, "next_task": len(tasks or {}) + 1}
        self.d.write_json(os.path.join(self.d.MISSIONS, "m1", "mission.json"), data)

    def read(self):
        return self.d.Mission("m1").read()

    def args(self, action, id="", **kw):
        ns = dict(mission="m1", json=True, action=action, id=id, rest=[], brief=None, role="worker",
                  agent=None, model=None, after=None, title=id, text="", files=None, done=None, size=None, test_command=None)
        ns.update(kw)
        return self.argparse.Namespace(**ns)

    def run_task(self, *a, **kw):
        with contextlib.redirect_stdout(io.StringIO()) as out:
            self.d.cmd_task(self.args(*a, **kw), self.cfg)
        return json.loads(out.getvalue()) if out.getvalue().strip() else None

    def wtask(self, tid, state="working", **kw):
        return {"id": tid, "title": f"task {tid}", "brief": "b", "role": "worker", "state": state, "agent": "claude",
                "family": "anthropic", "machine": self.d.local_name(), "address": f"a-{tid}", "branch": f"drover/{tid}",
                "worktree": str(self.repo.parent / f"wt-{tid}"), "created": 1, "updated": 1, **kw}

    def test_parse_files(self):
        got = self.d.parse_files("engine/drover:1234-1300, tests/test_engine.py ,a.py:7,")
        self.assertEqual(got, [{"path": "engine/drover", "start": 1234, "end": 1300},
                               {"path": "tests/test_engine.py", "start": None, "end": None},
                               {"path": "a.py", "start": 7, "end": 7}])
        self.assertEqual(self.d.parse_files(""), [])

    def test_check_files_warns(self):
        (self.repo / "f.py").write_text("a\nb\nc\n")
        files = self.d.parse_files("f.py:1-3,f.py:2-9,gone.py")
        warns = self.d.check_files(str(self.repo), files)
        self.assertEqual(len(warns), 2)
        self.assertIn("past the end", warns[0])
        self.assertIn("gone.py does not exist", warns[1])

    def test_task_add_context_pack_brief(self):
        self.mission()
        (self.repo / "f.py").write_text("a\nb\n")
        out = self.run_task("add", title="pack", brief="Do the thing", files="f.py:1-2,nope.py",
                            done=["tests pass", "docs updated"], size="S")
        self.assertEqual(out["done"], ["tests pass", "docs updated"])
        self.assertEqual(out["size"], "S")
        self.assertEqual(out["files"][0], {"path": "f.py", "start": 1, "end": 2})
        t = self.read()["tasks"][out["id"]]
        msg = self.d.worker_msg("m1", t, "drover/x")
        self.assertIn("Read first", msg)
        self.assertIn("- f.py (lines 1-2)", msg)
        self.assertIn("- nope.py", msg)
        self.assertIn("Done when:\n- tests pass\n- docs updated", msg)
        self.assertIn("Brief:\nDo the thing", msg)
        rev = self.d.reviewer_msg(self.read(), {**t, "branch": "drover/x"})
        self.assertIn("Done when (check each one):\n- tests pass", rev)

    def test_old_brief_without_pack(self):
        t = {"id": "t1", "title": "T", "brief": "just text"}
        msg = self.d.worker_msg("m1", t, "drover/x")
        self.assertNotIn("Read first", msg)
        self.assertNotIn("Done when", msg)
        self.assertIn("just text", msg)
        rev = self.d.reviewer_msg({"id": "m1", "base": "main"}, {**t, "branch": "b"})
        self.assertNotIn("Done when (check", rev)

    def test_herdr_mod_tasks_get_screenshot_steps(self):
        plain = {"id": "t1", "title": "T", "brief": "just text"}
        by_files = {**plain, "files": [{"path": "herdr/mods/x/mod.json", "start": None, "end": None}]}
        by_brief = {**plain, "brief": "edit herdr/mods/x"}
        base = {"id": "m1", "base": "main"}
        for t in (by_files, by_brief):
            msg = self.d.worker_msg("m1", t, "drover/x")
            self.assertIn("If you change a Herdr mod", msg)
            self.assertIn("herdr-app shot", msg)
            self.assertLess(msg.index("If you change a Herdr mod"), msg.index("When done:"))
            rev = self.d.reviewer_msg(base, {**t, "branch": "b"})
            self.assertIn("Reject UI work that was not seen rendered", rev)
        self.assertNotIn("Herdr mod", self.d.worker_msg("m1", plain, "drover/x"))
        self.assertNotIn("Herdr mod", self.d.reviewer_msg(base, {**plain, "branch": "b"}))
        self.assertIn("screenshot", self.d.COORDINATOR_BRIEF)

    def test_agent_picked_and_fallback_when_out(self):
        self.mission()
        out = self.run_task("add", title="one", agent="cursor")
        self.assertEqual(out["agent"], "cursor")
        self.assertIsNone(out["fallback"])
        self.d.mark_out("cursor", time.time() + 3600, "usage limit")
        out = self.run_task("add", title="two", agent="cursor")
        self.assertNotEqual(out["agent"], "cursor")
        self.assertIn("cursor unavailable", out["fallback"])
        self.assertIn("out of capacity", out["fallback"])

    def test_agent_not_installed_falls_back(self):
        self.mission()
        self.fleet["machines"][0]["tools"] = ["claude"]
        out = self.run_task("add", title="x", agent="codex")
        self.assertEqual(out["agent"], "claude")
        self.assertIn("not installed", out["fallback"])

    def test_reviewer_family_refused(self):
        self.mission({"t1": self.wtask("t1", state="done", brief="b")})
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stderr(io.StringIO()) as err:
                self.run_task("review", "t1", agent="claude")
        self.assertIn("same model family", err.getvalue())
        out = self.run_task("review", "t1", agent="codex")
        self.assertEqual(out["reviewer"], "codex")

    def test_after_queues_without_starting(self):
        self.mission({"t1": self.wtask("t1")})
        out = self.run_task("add", title="later", after="t1")
        self.assertEqual((out["state"], out["depends_on"]), ("queued", ["t1"]))
        self.assertEqual(self.started, [])
        self.assertEqual(self.read()["tasks"]["t2"]["state"], "queued")
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stderr(io.StringIO()):
                self.run_task("add", title="bad", after="t9")

    def test_merge_starts_dependent(self):
        self.git("branch", "drover/t1")
        self.mission({"t1": self.wtask("t1", state="approved"),
                      "t2": {"id": "t2", "title": "later", "brief": "b", "role": "worker", "state": "queued",
                             "depends_on": ["t1"], "agent_pref": "codex", "created": 1, "updated": 1}})
        out = self.run_task("merge", "t1")
        self.assertEqual([s["id"] for s in out["started"]], ["t2"])
        t2 = self.read()["tasks"]["t2"]
        self.assertEqual((t2["state"], t2["agent"]), ("working", "codex"))
        self.assertEqual(self.started[-1]["role"], "worker")

    def test_parallel_limit_respected(self):
        self.git("branch", "drover/t1")
        q = lambda i: {"id": f"t{i}", "title": f"q{i}", "brief": "b", "role": "worker", "state": "queued",
                       "depends_on": ["t1"], "created": 1, "updated": 1}
        self.mission({"t1": self.wtask("t1", state="approved"), "t2": self.wtask("t2"), "t3": q(3), "t4": q(4)}, parallel=2)
        out = self.run_task("merge", "t1")
        self.assertEqual([s["id"] for s in out["started"]], ["t3"])
        tasks = self.read()["tasks"]
        self.assertEqual((tasks["t3"]["state"], tasks["t4"]["state"]), ("working", "queued"))

    def test_dropped_dependency_notifies_and_stays_queued(self):
        self.mission({"t1": self.wtask("t1"),
                      "t2": {"id": "t2", "title": "later", "brief": "b", "role": "worker", "state": "queued",
                             "depends_on": ["t1"], "created": 1, "updated": 1}})
        self.run_task("drop", "t1", text="not needed")
        self.assertEqual(self.read()["tasks"]["t2"]["state"], "queued")
        self.assertTrue(any("t2" in text and "depend" in text for addr, text in self.sent if addr == "coord"))
        self.assertEqual(self.started, [])
        # The dependent can be dropped too, without a branch, worktree or agent.
        out = self.run_task("drop", "t2", text="also not needed")
        self.assertEqual((out["state"], out["warnings"]), ("dropped", []))
        self.assertEqual(self.read()["tasks"]["t2"]["state"], "dropped")

    def test_unroutable_ready_task_does_not_block_next(self):
        self.git("branch", "drover/t1")
        q = lambda i: {"id": f"t{i}", "title": f"q{i}", "brief": "b", "role": "worker", "state": "queued",
                       "depends_on": ["t1"], "created": 1, "updated": 1}
        self.mission({"t1": self.wtask("t1", state="approved"), "t2": q(2), "t3": q(3)})
        real = self.d.start_agent
        def pick(cfg, role, repo, message, title, **kw):
            return {"agent": None, "rejected": []} if title == "q2" else real(cfg, role, repo, message, title, **kw)
        self.d.start_agent = pick
        out = self.run_task("merge", "t1")
        self.assertEqual([s["id"] for s in out["started"]], ["t3"])
        self.assertEqual(self.read()["tasks"]["t2"]["state"], "queued")

    def worktree_task(self, tid="t1"):
        """A real task branch + worktree, one commit ahead of main."""
        wt = self.repo.parent / f"wt-{tid}"
        self.git("worktree", "add", "-b", f"drover/{tid}", str(wt))
        return wt

    def wgit(self, wt, *args):
        return subprocess.run(["git", "-C", str(wt), *args], check=True, capture_output=True, text=True,
                              env={**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
                                   "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
                                   "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}).stdout

    def commit_file(self, where, path, text, msg):
        full = Path(where) / path
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(text)
        self.wgit(where, "add", path)
        self.wgit(where, "commit", "-m", msg)

    def merge_mission(self, wt):
        self.mission({"t1": self.wtask("t1", state="approved", worktree=str(wt))})

    def test_merge_auto_resolves_clean_when_main_moved(self):
        wt = self.worktree_task()
        self.commit_file(wt, "mine.txt", "mine\n", "task work")
        self.commit_file(self.repo, "other.txt", "other\n", "main moved")
        self.merge_mission(wt)
        out = self.run_task("merge", "t1", test_command="true")
        self.assertEqual(out["task"], "t1")
        self.assertEqual(self.read()["tasks"]["t1"]["state"], "merged")
        self.assertTrue((self.repo / "mine.txt").exists() and (self.repo / "other.txt").exists())

    def test_auto_resolve_merges_moved_main_cleanly(self):
        wt = self.worktree_task()
        self.commit_file(wt, "mine.txt", "mine\n", "task work")
        self.commit_file(self.repo, "other.txt", "other\n", "main moved")
        ok, detail, files = self.d.auto_resolve_merge(self.cfg, str(self.repo), "main", str(wt), "true")
        self.assertEqual((ok, files), (True, []))
        self.assertTrue((wt / "other.txt").exists())
        self.assertEqual(self.wgit(wt, "status", "--porcelain"), "")

    def test_merge_unions_conflict_in_tests(self):
        wt = self.worktree_task()
        self.commit_file(self.repo, "tests/test_a.py", "import unittest\n", "base tests")
        self.wgit(wt, "merge", "main")
        self.commit_file(wt, "tests/test_a.py", "import unittest\n\nclass A(unittest.TestCase):\n    def test_a(self): pass\n", "mine")
        self.commit_file(self.repo, "tests/test_a.py", "import unittest\n\nclass B(unittest.TestCase):\n    def test_b(self): pass\n", "theirs")
        self.merge_mission(wt)
        self.run_task("merge", "t1", test_command="python3 -m py_compile tests/test_a.py")
        self.assertTrue(any("auto-resolved" in e.get("text", "") for e in self.d.Mission("m1").entries()))
        self.assertEqual(self.read()["tasks"]["t1"]["state"], "merged")
        text = (self.repo / "tests" / "test_a.py").read_text()
        self.assertIn("class A", text)
        self.assertIn("class B", text)

    def test_merge_code_conflict_goes_back_to_worker(self):
        wt = self.worktree_task()
        self.commit_file(wt, "f", "mine\n", "mine")
        self.commit_file(self.repo, "f", "theirs\n", "theirs")
        self.merge_mission(wt)
        before = self.wgit(wt, "rev-parse", "HEAD")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            self.run_task("merge", "t1", test_command="true")
        self.assertEqual(self.read()["tasks"]["t1"]["state"], "changes")
        self.assertEqual(self.wgit(wt, "status", "--porcelain"), "")
        self.assertEqual(self.wgit(wt, "rev-parse", "HEAD"), before)
        self.assertEqual((self.repo / "f").read_text(), "theirs\n")
        sent = {addr: text for addr, text in self.sent}
        for addr in ("a-t1", "coord"):
            self.assertIn("f", sent[addr])
            self.assertIn("Next:", sent[addr])

    def test_merge_failing_tests_after_auto_merge_goes_back(self):
        wt = self.worktree_task()
        self.commit_file(self.repo, "tests/t.txt", "a\n", "base")
        self.wgit(wt, "merge", "main")
        self.commit_file(wt, "tests/t.txt", "a\nmine\n", "mine")
        self.commit_file(self.repo, "tests/t.txt", "a\ntheirs\n", "theirs")
        self.merge_mission(wt)
        before = self.wgit(wt, "rev-parse", "HEAD")
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            self.run_task("merge", "t1", test_command="false")
        self.assertEqual(self.read()["tasks"]["t1"]["state"], "changes")
        self.assertEqual(self.wgit(wt, "rev-parse", "HEAD"), before)


class WatchTests(unittest.TestCase):
    """check_mission / reroute_task with hc and start_agent replaced."""
    CODEX_PROMPT = ("Approaching rate limits\nSwitch to gpt-5-mini for lower credit usage?\n"
                    "1. Switch  2. Keep current model\n")
    LIMIT = "■ You've hit your usage limit. Try again in 2 hours 14 minutes.\n"

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="drover-watch-")
        self.addCleanup(self.temp.cleanup)
        old = os.environ.get("XDG_STATE_HOME")
        self.addCleanup(lambda: os.environ.__setitem__("XDG_STATE_HOME", old) if old else os.environ.pop("XDG_STATE_HOME", None))
        self.d = d = load_engine(self.temp.name)
        self.cfg = d.merged(d.DEFAULT_CONFIG, {})
        d.usage_probe = lambda *a, **k: None
        os.makedirs(os.path.join(d.MISSIONS, "m1"))
        task = {"id": "t1", "title": "Do it", "brief": "build", "role": "worker", "state": "working",
                "agent": "codex", "model": None, "family": "openai", "machine": "box", "address": "box/t1",
                "branch": "drover/do-it", "worktree": "/w/do-it"}
        d.write_json(os.path.join(d.MISSIONS, "m1", "mission.json"), {
            "id": "m1", "state": "running", "repo": "/r", "base": "main", "goal": "g",
            "coordinator": {"address": "coord"}, "tasks": {"t1": task}, "next_task": 2})
        self.m = d.Mission("m1")
        self.screens = {"box/t1": {"state": "live", "status": "idle", "screen": ""}}
        self.calls, self.sent, self.starts, self.chain_empty = [], [], [], False

        def fake_hc(args, timeout=60):
            self.calls.append(args)
            addr = args[1] if len(args) > 1 else None
            if args[0] == "get":
                if addr not in self.screens:
                    return 1, "", "terminal not found"
                s = self.screens[addr]
                return 0, json.dumps({"terminal": {"address": addr, "state": s["state"], "status": s["status"]}}), ""
            if args[0] == "read":
                return 0, self.screens[addr]["screen"], ""
            if args[0] == "kill":
                self.screens.pop(addr, None)
                return 0, "{}", ""
            return 0, "{}", ""

        def fake_start(cfg, role, repo, message, title, **kw):
            self.starts.append({"role": role, "message": message, "title": title, **kw})
            if self.chain_empty:
                return {"agent": None, "machine": None, "rejected": []}
            avoid = kw.get("avoid", ())
            chain = [c for c in cfg["roles"][role]["chain"]
                     if c["agent"] not in d.agents_out() and cfg["agents"][c["agent"]]["family"] not in avoid]
            chain = [c for c in chain if c["agent"] != kw.get("skip_agent")]
            if kw.get("prefer_agent"):
                chain = [{"agent": kw["prefer_agent"], "model": kw.get("prefer_model")}] + chain
            c = chain[0]
            addr = f"box/n{len(self.starts)}"
            self.screens[addr] = {"state": "live", "status": "working", "screen": ""}
            return {"agent": c["agent"], "model": c.get("model"), "family": cfg["agents"][c["agent"]]["family"],
                    "machine": kw.get("machine") or "box", "address": addr, "cwd": kw.get("cwd"), "branch": kw.get("branch")}
        d.hc, d.start_agent = fake_hc, fake_start
        d.hc_send = lambda addr, text: (self.sent.append((addr, text)) or (True, ""))

    def task(self):
        return self.m.read()["tasks"]["t1"]

    def test_codex_prompt_is_capacity(self):
        for text in (self.CODEX_PROMPT, self.LIMIT, "Usage limit reached"):
            self.assertIsNotNone(self.d.detect_capacity("codex", text), text)

    def test_worker_reroute_same_machine_branch_worktree(self):
        self.screens["box/t1"]["screen"] = "working...\n" + self.LIMIT
        acts = self.d.check_mission(self.cfg, "m1")
        self.assertEqual(len(acts), 1)
        self.assertIn("codex", self.d.agents_out())
        self.assertEqual(len(self.starts), 1)
        s = self.starts[0]
        self.assertEqual((s["cwd"], s["branch"], s["machine"]), ("/w/do-it", "drover/do-it", "box"))
        t = self.task()
        self.assertEqual((t["agent"], t["address"]), ("claude", "box/n1"))
        self.assertIn("previous agent (codex) stopped", s["message"])
        self.assertIn("drover task done t1", s["message"])
        self.assertTrue(any(c[0] == "kill" and c[1] == "box/t1" for c in self.calls))
        self.assertEqual(len(self.sent), 1)
        self.assertRegex(self.sent[0][1], r"\[drover\] mission m1: t1 moved from codex to claude \(usage limit until \d\d:\d\d\)")
        self.assertEqual([e["kind"] for e in self.m.entries() if e["kind"] == "reroute"], ["reroute"])

    def test_codex_prompt_reroutes_and_rerun_is_noop(self):
        self.screens["box/t1"]["screen"] = self.CODEX_PROMPT
        self.d.check_mission(self.cfg, "m1")
        self.assertEqual(len(self.starts), 1)
        self.d.check_mission(self.cfg, "m1")
        self.assertEqual(len(self.starts), 1)
        self.assertEqual(len(self.sent), 1)

    def test_working_status_ignores_mentions(self):
        self.screens["box/t1"].update(status="working", screen="editing CAPACITY_PATTERNS: usage limit\n")
        self.assertEqual(self.d.check_mission(self.cfg, "m1"), [])
        self.assertEqual(self.starts, [])

    def test_gone_terminal_reroutes_without_mark_out(self):
        del self.screens["box/t1"]
        self.d.check_mission(self.cfg, "m1")
        self.assertEqual(self.d.agents_out(), {})
        self.assertEqual(len(self.starts), 1)
        self.assertIn("terminal exited", self.sent[0][1])

    def test_done_task_is_left_alone(self):
        self.m.update(lambda x: x["tasks"]["t1"].update(state="done"))
        del self.screens["box/t1"]
        self.assertEqual(self.d.check_mission(self.cfg, "m1"), [])

    def test_reviewer_reroute_keeps_avoid_and_history(self):
        old = {"address": "box/r1", "agent": "claude", "model": "opus", "family": "anthropic",
               "machine": "box", "verdict": None, "started": 1}
        self.m.update(lambda x: x["tasks"]["t1"].update(state="review", review=old))
        self.screens["box/r1"] = {"state": "live", "status": "idle", "screen": "Claude usage limit reached. Try again in 1h\n"}
        self.d.check_mission(self.cfg, "m1")
        s = self.starts[0]
        self.assertEqual((s["role"], s["avoid"], s["machine"], s["cwd"]), ("reviewer", ("openai",), "box", "/w/do-it"))
        t = self.task()
        self.assertEqual(t["review_history"], [old])
        self.assertEqual((t["review"]["agent"], t["review"]["address"], t["review"]["verdict"]), ("cursor", "box/n1", None))
        self.assertEqual(t["agent"], "codex")  # the worker is untouched
        self.assertIn("claude", self.d.agents_out())
        self.assertIn("review", s["message"].lower())

    def fleet_box(self, tools=("codex", "claude", "cursor-agent")):
        d = self.d
        d.fleet = lambda cfg, max_age=0: {"machines": [{"name": "box", "online": True, "tools": list(tools), "disk_free_gb": 500}]}
        d.drover_terminals = lambda strict=False: []

    def reroute(self, *argv):
        import argparse
        a = argparse.Namespace(action="reroute", id="t1", mission="m1", agent=None, model=None, reason=None,
                               review=False, force=False, json=True, text="")
        for k, v in zip(argv[::2], argv[1::2]):
            setattr(a, k, v)
        with contextlib.redirect_stdout(io.StringIO()):
            self.d.cmd_task(a, self.cfg)

    def test_reroute_command_specific_agent(self):
        self.fleet_box()
        self.reroute("agent", "cursor", "reason", "too slow")
        s = self.starts[0]
        self.assertEqual((s["prefer_agent"], s["cwd"], s["branch"], s["machine"]), ("cursor", "/w/do-it", "drover/do-it", "box"))
        self.assertEqual(self.task()["agent"], "cursor")
        self.assertIn("too slow", self.sent[0][1])
        self.assertEqual([e["kind"] for e in self.m.entries() if e["kind"] == "reroute"], ["reroute"])

    def test_reroute_command_refuses_unavailable_agent(self):
        self.fleet_box(tools=("codex", "claude"))
        self.d.mark_out("claude", time.time() + 3600, "limit")
        for agent in ("claude", "cursor"):  # out of capacity; not installed
            with self.assertRaises(SystemExit):
                self.reroute("agent", agent)
        self.assertEqual((self.starts, self.task()["agent"]), ([], "codex"))
        self.reroute("agent", "cursor", "force", True)
        self.assertEqual(self.starts[0]["prefer_force"], True)

    def test_reroute_command_chain_fallback(self):
        self.fleet_box()
        self.reroute()
        s = self.starts[0]
        self.assertEqual((s["skip_agent"], s.get("prefer_agent")), ("codex", None))
        self.assertEqual(self.task()["agent"], "claude")
        self.assertEqual(self.task()["reroutes"], 1)

    def test_reroute_command_review_and_state(self):
        self.fleet_box()
        with self.assertRaises(SystemExit):
            self.reroute("review", True)  # no active review
        self.m.update(lambda x: x["tasks"]["t1"].update(state="review", review={
            "address": "box/r1", "agent": "claude", "family": "anthropic", "machine": "box", "verdict": None}))
        self.screens["box/r1"] = {"state": "live", "status": "idle", "screen": ""}
        self.reroute("review", True)
        self.assertEqual((self.starts[0]["role"], self.starts[0]["avoid"]), ("reviewer", ("openai",)))
        self.assertEqual(self.task()["review"]["agent"], "cursor")

    def test_proactive_move_when_out_without_screen_text(self):
        for status in ("idle", "blocked"):
            self.setUp()
            self.screens["box/t1"]["status"] = status
            self.d.mark_out("codex", time.time() + 3600, "usage limit")
            acts = self.d.check_mission(self.cfg, "m1")
            self.assertEqual(len(acts), 1, status)
            self.assertIn("out of capacity", acts[0]["why"])
            self.assertEqual(self.task()["agent"], "claude")
            self.d.check_mission(self.cfg, "m1")
            self.assertEqual(len(self.starts), 1)  # once per outage

    def test_proactive_move_on_usage_and_not_while_working(self):
        self.d.usage_probe = lambda *a, **k: {"used_percent": 95, "window": "5h", "resets_at": time.time() + 3600}
        self.screens["box/t1"]["status"] = "working"
        self.assertEqual(self.d.check_mission(self.cfg, "m1"), [])
        self.screens["box/t1"]["status"] = "idle"
        self.assertEqual(len(self.d.check_mission(self.cfg, "m1")), 1)

    def test_dashboard_alternatives(self):
        self.fleet_box(tools=("codex", "claude"))
        d = self.d
        d.mark_out("claude", time.time() + 3600, "limit", machine="other")  # another machine: no effect here
        d.usage_probe = lambda agent, *a, **k: {"used_percent": 40.0, "window": "5h", "resets_at": 99} if agent == "claude" else None
        t = self.task()
        alts = d.task_alternatives(self.cfg, t, "worker", ["codex", "claude"], d.agents_out(), time.time())
        self.assertEqual(alts, [{"agent": "claude", "model": "sonnet", "family": "anthropic", "used_percent": 40.0, "resets_at": 99}])
        rv = {**t, "review": {"agent": "claude", "machine": "box"}}  # reviewer: worker is openai, so no codex
        alts = d.task_alternatives(self.cfg, rv, "reviewer", ["codex", "claude", "cursor-agent"], d.agents_out(), time.time())
        self.assertEqual([a["agent"] for a in alts], ["cursor"])
        d.mark_out("cursor", time.time() + 60, "x")
        self.assertEqual(d.task_alternatives(self.cfg, rv, "reviewer", None, d.agents_out(), time.time()), [])

    def test_exhausted_chain_does_not_loop(self):
        self.chain_empty = True
        self.screens["box/t1"]["screen"] = self.LIMIT
        for _ in range(3):
            self.d.check_mission(self.cfg, "m1")
            self.screens.setdefault("box/t1", {"state": "live", "status": "idle", "screen": self.LIMIT})
        self.assertEqual(len(self.starts), 1)
        self.assertEqual(len(self.sent), 1)
        self.assertIn("left as is", self.sent[0][1])
        self.assertEqual(self.task()["address"], "box/t1")

    def test_watcher_not_counted_by_route(self):
        d = self.d
        d.fleet = lambda cfg, max_age=0: {"machines": [{"name": "m1", "online": True, "tools": ["codex"], "disk_free_gb": 500}]}
        d.drover_terminals = lambda strict=False: [{"address": f"w{i}", "labels": {"drover.role": "watcher"}} for i in range(9)]
        self.assertEqual(d.route(self.cfg, "worker")["agent"], "codex")

class CoordinatorWatchTests(WatchTests):
    """check_coordinators: a dead coordinator is replaced, once, with a digest of every running mission."""

    def setUp(self):
        super().setUp()
        d = self.d
        d.write_json(os.path.join(d.MISSIONS, "m2", "mission.json") if os.makedirs(os.path.join(d.MISSIONS, "m2")) is None else "", {
            "id": "m2", "state": "running", "repo": "/r", "base": "main", "goal": "second goal",
            "coordinator": {"address": "coord"}, "next_task": 2, "tasks": {"t1": {
                "id": "t1", "title": "Other", "state": "done", "branch": "drover/other", "agent": "codex"}}})
        self.terms, self.inconclusive = [], False
        self.ls_ok = True
        self.d.hc_inner = d.hc

        def terminals(strict=False):
            if self.inconclusive:
                raise d.Inconclusive("hc down")
            return self.terms
        d.drover_terminals = terminals
        self.cfg["agents"]  # exists
        self.old_hc = d.hc

    def alive(self, status="idle", screen=""):
        self.terms = [{"address": "coord", "state": "live", "status": status, "labels": {"drover.role": "coordinator"}}]
        self.screens["coord"] = {"state": "live", "status": status, "screen": screen}

    def test_dead_restarted_once_with_digest(self):
        self.assertEqual(self.d.check_coordinators(self.cfg, now=1000), [])  # first miss
        self.assertEqual(self.starts, [])
        acts = self.d.check_coordinators(self.cfg, now=1030)
        self.assertEqual(len(self.starts), 1)
        self.assertEqual(acts[0]["restarted"], True)
        msg = self.starts[0]["message"]
        self.assertEqual(self.starts[0]["role"], "coordinator")
        for needle in ("m1", "m2", "second goal", "drover/other", "t1 done: review it", "drover/do-it"):
            self.assertIn(needle, msg)
        for mid in ("m1", "m2"):
            self.assertEqual(self.d.Mission(mid).read()["coordinator"]["address"], "box/n1")
            self.assertTrue(any("handed over from" in e["text"] for e in self.d.Mission(mid).entries()))
        self.terms = [{"address": "box/n1", "state": "live", "status": "working", "labels": {}}]
        self.d.check_coordinators(self.cfg, now=1060)
        self.d.check_coordinators(self.cfg, now=1090)
        self.assertEqual(len(self.starts), 1)

    def test_inconclusive_does_nothing(self):
        self.inconclusive = True
        for t in (1000, 1030, 1060):
            self.assertEqual(self.d.check_coordinators(self.cfg, now=t), [])
        self.assertEqual(self.starts, [])
        self.assertEqual(self.d.Mission("m1").read()["coordinator"]["address"], "coord")

    def test_alive_resets_misses(self):
        self.d.check_coordinators(self.cfg, now=1000)
        self.alive()
        self.d.check_coordinators(self.cfg, now=1030)
        self.terms = []
        self.d.check_coordinators(self.cfg, now=1060)
        self.assertEqual(self.starts, [])

    def test_restart_limit(self):
        self.chain_empty = False
        for i in range(8):
            for mid in ("m1", "m2"):  # the new coordinator dies at once, too
                self.d.Mission(mid).update(lambda x: x["coordinator"].update(address="dead"))
            self.d.check_coordinators(self.cfg, now=1000 + i * 60)
            self.d.check_coordinators(self.cfg, now=1030 + i * 60)
        self.assertEqual(len(self.starts), self.d.COORD_MAX_RESTARTS)
        self.assertTrue(any("not restarting again" in e["text"] for e in self.d.Mission("m1").entries()))
        later = 1000 + 3700
        self.d.check_coordinators(self.cfg, now=later)
        self.d.check_coordinators(self.cfg, now=later + 30)
        self.assertEqual(len(self.starts), self.d.COORD_MAX_RESTARTS + 1)

    def test_capacity_goes_to_next_chain_agent(self):
        for mid in ("m1", "m2"):
            self.d.Mission(mid).update(lambda x: x["coordinator"].update(agent="claude"))
        now = int(time.time())
        self.alive("idle", "Claude usage limit reached. Try again in 1h\n")
        self.d.check_coordinators(self.cfg, now=now)
        self.d.check_coordinators(self.cfg, now=now + 30)
        self.assertIn("claude", self.d.agents_out())
        self.assertEqual(len(self.starts), 1)
        self.assertNotEqual(self.d.Mission("m1").read()["coordinator"]["agent"], "claude")
        self.assertTrue(any(c[0] == "kill" and c[1] == "coord" for c in self.calls))


for _n in [n for n in dir(WatchTests) if n.startswith("test_")]:  # don't rerun the parent's tests
    setattr(CoordinatorWatchTests, _n, None)

class CoordinatorReplaceTests(CoordinatorWatchTests):
    """drover coordinator replace / show, and the shared handover."""
    MARKERS = {"claude": "> please fix the login bug\n  and add a test\n",
               "codex": "› please fix the login bug\n  and add a test\n",
               "cursor": "│ → please fix the login bug\n  and add a test │\n"}

    def replace(self, **kw):
        import argparse
        a = argparse.Namespace(action="replace", repo="/r", agent=None, model=None, force=False, reason=None,
                               json=True)
        for k, v in kw.items():
            setattr(a, k, v)
        with contextlib.redirect_stdout(io.StringIO()):
            self.d.cmd_coordinator(a, self.cfg)

    def test_explicit_agent_outside_chain(self):
        self.alive("idle", "")
        self.replace(agent="cursor", reason="try cursor")
        self.assertEqual(self.starts[0]["prefer_agent"], "cursor")
        self.assertEqual(self.d.Mission("m1").read()["coordinator"]["agent"], "cursor")
        self.assertTrue(any(c[0] == "kill" and c[1] == "coord" for c in self.calls))

    def test_chain_fallback_and_out_marked(self):
        for mid in ("m1", "m2"):
            self.d.Mission(mid).update(lambda x: x["coordinator"].update(agent="claude"))
        self.alive("idle", "Claude usage limit reached. Try again in 1h\n")
        self.replace()
        self.assertIn("claude", self.d.agents_out())
        self.assertNotEqual(self.d.Mission("m1").read()["coordinator"]["agent"], "claude")

    def test_carried_over_message_per_cli(self):
        for cli, screen in self.MARKERS.items():
            self.starts.clear()
            for mid in ("m1", "m2"):
                self.d.Mission(mid).update(lambda x: x["coordinator"].update(address="coord"))
            self.alive("idle", "● earlier answer\n" + screen)
            self.replace()
            msg = self.starts[0]["message"]
            self.assertIn("> please fix the login bug and add a test", msg, cli)
            self.assertIn("Answer it first", msg, cli)

    def test_answered_message_not_carried(self):
        self.alive("idle", "> old question\n● the answer\n> \n")
        self.replace()
        self.assertNotIn("Answer it first", self.starts[0]["message"])

    def test_no_running_missions_digests_newest_finished(self):
        for mid in ("m1", "m2"):
            self.d.Mission(mid).update(lambda x: x.update(state="done"))
        self.alive("idle", "")
        self.replace()
        msg = self.starts[0]["message"]
        self.assertIn("m2", msg)
        self.assertIn("second goal", msg)
        self.assertNotIn("drover/do-it", msg)

    def test_records_and_logs(self):
        self.alive("idle", "")
        self.replace(reason="for a test")
        for mid in ("m1", "m2"):
            self.assertEqual(self.d.Mission(mid).read()["coordinator"]["address"], "box/n1")
            self.assertTrue(any("coordinator handed over from" in e["text"] and "(for a test)" in e["text"]
                                for e in self.d.Mission(mid).entries()))

    def test_show(self):
        import argparse
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.d.cmd_coordinator(argparse.Namespace(action="show", repo="/r", json=True), self.cfg)
        self.assertEqual(json.loads(out.getvalue())["address"], "coord")

    def test_finished_mission_out_of_capacity_with_message(self):
        now = int(time.time())
        for mid in ("m1", "m2"):
            self.d.Mission(mid).update(lambda x: x.update(state="done", done_at=now - 3600))
        self.alive("idle", "> next thing please\nClaude usage limit reached. Try again in 1h\n")
        self.d.Mission("m1").update(lambda x: x["coordinator"].update(agent="claude"))
        self.d.Mission("m2").update(lambda x: x["coordinator"].update(agent="claude"))
        self.d.check_coordinators(self.cfg, now=now)
        self.d.check_coordinators(self.cfg, now=now + 30)
        self.assertEqual(len(self.starts), 1)
        self.assertIn("next thing please", self.starts[0]["message"])

    def test_finished_mission_without_message_left_alone(self):
        now = int(time.time())
        for mid in ("m1", "m2"):
            self.d.Mission(mid).update(lambda x: x.update(state="done", done_at=now - 3600))
        self.alive("idle", "Claude usage limit reached. Try again in 1h\n")
        self.d.check_coordinators(self.cfg, now=now)
        self.d.check_coordinators(self.cfg, now=now + 30)
        self.assertEqual(self.starts, [])


for _n in [n for n in dir(CoordinatorWatchTests) if n.startswith("test_") and n not in vars(CoordinatorReplaceTests)]:
    setattr(CoordinatorReplaceTests, _n, None)

class CoordinatorTabTests(unittest.TestCase):
    def test_tab_is_per_repo_and_stable(self):
        with tempfile.TemporaryDirectory() as d:
            e = load_engine(d)
            a, b = e.coordinator_tab("/work/alpha"), e.coordinator_tab("/work/beta")
            self.assertNotEqual(a, b)
            self.assertEqual(a, e.coordinator_tab("/work/alpha"))
            self.assertNotEqual(e.coordinator_tab("/x/app"), e.coordinator_tab("/y/app"))
            self.assertTrue(a.startswith("drover-coordinator-"))


if __name__ == "__main__":
    unittest.main()
