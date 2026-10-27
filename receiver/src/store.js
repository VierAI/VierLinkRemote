// AI generated code. Snapshot folder: 0700 dir, 0600 files, only our own file names are ever deleted.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const OURS = /^[A-Za-z0-9_-]{22}-\d{1,20}\.json$/;

export class SnapshotStore {
  constructor(dir) {
    const d = path.resolve(dir);
    const bad = [path.parse(d).root, os.homedir(), os.tmpdir()].map((p) => path.resolve(p));
    if (bad.includes(d)) throw new Error("snapshotDir must be a dedicated folder");
    this.dir = d;
  }
  init() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") fs.chmodSync(this.dir, 0o700);
    this.wipe();
  }
  write(sid, seq, obj) {
    const name = `${sid}-${seq}.json`;
    fs.writeFileSync(path.join(this.dir, name), JSON.stringify(obj, null, 2), { mode: 0o600, flag: "wx" });
    return name; // relative to the snapshot folder
  }
  /** Deletes our files for one session (sid) or all of them. Returns the count. */
  wipe(sid) {
    let n = 0;
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return 0; }
    for (const f of names) {
      if (!OURS.test(f)) continue;
      if (sid && !f.startsWith(sid + "-")) continue;
      try { fs.rmSync(path.join(this.dir, f), { force: true }); n++; } catch { /* ignore */ }
    }
    return n;
  }
  /** Deletes our files older than maxAgeMs (by mtime) unless their session is still kept. */
  sweep(maxAgeMs, keepSids = new Set()) {
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return 0; }
    let n = 0; const cutoff = Date.now() - maxAgeMs;
    for (const f of names) {
      if (!OURS.test(f) || keepSids.has(f.slice(0, 22))) continue;
      try { const p = path.join(this.dir, f); if (fs.statSync(p).mtimeMs < cutoff) { fs.rmSync(p, { force: true }); n++; } } catch { /* ignore */ }
    }
    return n;
  }
}
