// AI generated code. Receiver tests with throwaway keys and a fake relay. No network, no real keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as C from "../src/crypto.js";
import { createModule, Receiver, summarize } from "../src/index.js";

const keys = C.generateKeys();
const pins = { xpub: keys.xpub, edpub: keys.edpub, fingerprint: C.fingerprint(keys.xpub, keys.edpub) };
const bundle = `vlrk1.${C.b64u(keys.xpriv)}.${C.b64u(keys.edpriv)}`;
const HOOK_URL = "https://hook.test.invalid/x", HOOK_KEY = "test-bearer";
const secrets = { "VierLink Remote keys|password": bundle, "XIV Crash Bot webhook|uri": HOOK_URL, "XIV Crash Bot webhook|password": HOOK_KEY };
const getSecret = async (item, field) => secrets[`${item}|${field}`];
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "vlr-rcv-"));

class FakeWS {
  static last = null;
  constructor(url, opts) { this.url = url; this.opts = opts; this.sent = []; this.readyState = 0; this.l = {}; FakeWS.last = this; queueMicrotask(() => { this.readyState = 1; this.emit("open", {}); }); }
  addEventListener(t, f) { (this.l[t] ??= []).push(f); }
  emit(t, ev) { for (const f of this.l[t] ?? []) f(ev); }
  send(s) { this.sent.push(s); }
  close(code) { this.readyState = 3; this.closedWith = code; }
  relay(obj) { this.emit("message", { data: JSON.stringify(obj) }); }
}

function readToken(token) {
  const [a, b, sig] = token.split(".");
  assert.equal(a, "vlr1");
  assert.ok(C.verify(C.unb64u(keys.edpub), `${a}.${b}`, C.unb64u(sig)), "token signature");
  return JSON.parse(C.unb64u(b).toString("utf8"));
}

function make(extra = {}) {
  const hooks = [];
  const fetch = async (url, init) => { hooks.push({ url, init }); return { status: extra.hookStatus ?? 204 }; };
  const dir = tmp();
  const mod = createModule({ config: { snapshotDir: path.join(dir, "snaps"), http: { enabled: false }, ...extra.config }, getSecret, fetch, WebSocket: FakeWS, pins });
  return { mod, hooks, dir: path.join(dir, "snaps") };
}

const tick = () => new Promise((r) => setTimeout(r, 10));

test("crypto: seal/open, tamper, wrong key, export timestamp bound", () => {
  const k = C.random(32), sid = C.random(16);
  const blob = C.seal(Buffer.from("hi"), C.unb64u(keys.xpub), k, sid, 7);
  const o = C.open(blob, keys.xpriv, k, sid); assert.equal(o.plain.toString(), "hi"); assert.equal(o.seq, 7n);
  const t = Buffer.from(blob); t[t.length - 1] ^= 1; assert.throws(() => C.open(t, keys.xpriv, k, sid));
  assert.throws(() => C.open(blob, keys.xpriv, C.random(32), sid));
  const ex = C.sealExport('{"a":1}', keys.xpub);
  assert.equal(C.openExport(ex, keys.xpriv).json, '{"a":1}');
  const p = ex.split("."); p[2] = String(Number(p[2]) + 5); assert.throws(() => C.openExport(p.join("."), keys.xpriv), /timestamp/);
});

test("key bundle must match the pins; real pins are unchanged", () => {
  assert.throws(() => C.parseKeyBundle(`vlrk1.${C.b64u(C.random(32))}.${C.b64u(C.random(32))}`, pins), /pinned/);
  assert.equal(C.fingerprint(C.PINNED.xpub, C.PINNED.edpub), C.PINNED.fingerprint);
  assert.equal(C.PINNED.scope, 2);
});

test("startup wipes old snapshot files and keeps foreign files", async () => {
  const { mod, dir } = make();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${C.b64u(C.random(16))}-1.json`), "{}");
  fs.writeFileSync(path.join(dir, "keep.txt"), "x");
  await mod.start();
  assert.deepEqual(fs.readdirSync(dir), ["keep.txt"]);
  if (process.platform !== "win32") assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  await mod.stop();
});

test("start-session: token format, scope, expiry, create proof", async () => {
  const { mod } = make();
  await mod.start();
  const r = await mod.startSession();
  const body = readToken(r.token);
  assert.deepEqual(Object.keys(body), ["v", "scope", "sid", "url", "k", "exp", "self"]);
  assert.equal(body.v, 1); assert.equal(body.scope, 2); assert.equal(body.sid, r.session);
  assert.equal(body.url, "wss://relay.lafxrfz8x1.workers.dev/s/");
  assert.ok(Math.abs(body.exp - (Date.now() / 1000 + 3600)) < 5);
  const ws = FakeWS.last;
  assert.equal(ws.url, body.url + body.sid); assert.equal(ws.opts.headers["X-VLR-Role"], "creator");
  const hello = JSON.parse(ws.sent[0]);
  assert.equal(hello.t, "create"); assert.equal(hello.sid, body.sid); assert.equal(hello.exp, body.exp);
  assert.ok(C.verify(C.unb64u(keys.edpub), C.createProofMessage(hello.sid, hello.exp, hello.auth, hello.ts), C.unb64u(hello.sig)));
  assert.equal(hello.auth, C.b64u(C.authKey(C.unb64u(body.k), C.unb64u(body.sid))));
  await mod.stop();
});

test("snapshots: decrypt, lastSeq, file 0600, webhook once with bearer, refresh, end wipes", async () => {
  const { mod, hooks, dir } = make();
  await mod.start();
  const r = await mod.startSession(); const body = readToken(r.token); const ws = FakeWS.last;
  const k = C.unb64u(body.k), sid = C.unb64u(body.sid);
  const snap = (seq, extra = {}) => ({ t: "data", d: C.b64u(C.seal(Buffer.from(JSON.stringify({ v: 1, scope: 2, mode: "live", reveal: false, players: [{ label: "P1", paired: true, sync: { state: "loaded" } }, { label: "P2", paired: true, sync: { state: "Firstname Lastname" } }], ...extra })), C.unb64u(keys.xpub), k, sid, seq)) });
  ws.relay({ t: "ok" }); ws.relay({ t: "joined" });
  ws.relay(snap(1)); ws.relay(snap(1)); ws.relay(snap(3)); ws.relay(snap(2));
  ws.relay({ t: "data", d: C.b64u(C.seal(Buffer.from("{}"), C.unb64u(keys.xpub), C.random(32), sid, 9)) }); // wrong k
  await tick();
  const files = fs.readdirSync(dir).sort();
  assert.deepEqual(files, [`${body.sid}-1.json`, `${body.sid}-3.json`]);
  if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, files[0])).mode & 0o777, 0o600);
  const rec = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  assert.equal(rec.untrusted, true); assert.equal(rec.seq, 1);
  assert.deepEqual(rec.summary.states, { loaded: 1, other: 1 }); // unknown state value never passes through
  assert.equal(hooks.length, 2);
  assert.equal(hooks[0].url, HOOK_URL); assert.equal(hooks[0].init.headers.Authorization, `Bearer ${HOOK_KEY}`);
  const hb = JSON.parse(hooks[0].init.body);
  assert.deepEqual(Object.keys(hb), ["session", "path", "summary"]); assert.equal(hb.session, body.sid);
  assert.ok(!JSON.stringify(hb).includes("Firstname"));
  mod.refresh(r.session); assert.equal(ws.sent.at(-1), '{"t":"refresh"}');
  assert.equal(mod.end(r.session), true); assert.ok(ws.sent.includes('{"t":"end"}'));
  assert.deepEqual(fs.readdirSync(dir), []);
  assert.throws(() => mod.refresh(r.session));
  await mod.stop();
});

test("reveal is reported from the tester's snapshot", () => {
  assert.equal(summarize({ mode: "live", reveal: true, players: [] }).reveal, true);
  assert.equal(summarize({ mode: "evil", players: "x" }).mode, "other");
});

test("tester leaving keeps files for the retention period; explicit End wipes", async () => {
  const { mod, dir } = make();
  await mod.start();
  const r = await mod.startSession(); const body = readToken(r.token); const ws = FakeWS.last;
  ws.relay({ t: "joined" });
  ws.relay({ t: "data", d: C.b64u(C.seal(Buffer.from('{"players":[]}'), C.unb64u(keys.xpub), C.unb64u(body.k), C.unb64u(body.sid), 1)) });
  ws.relay({ t: "end" });
  assert.equal(fs.readdirSync(dir).length, 1);
  assert.equal(mod.status()[0].ended, true);
  await mod.stop(); // stop wipes everything
  assert.equal(fs.readdirSync(dir).length, 0);
});

test("webhook: no retry after 2xx, retries after failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mod, hooks } = make({ hookStatus: 500 });
  await mod.start();
  const r = await mod.startSession(); const body = readToken(r.token); const ws = FakeWS.last;
  ws.relay({ t: "data", d: C.b64u(C.seal(Buffer.from("{}"), C.unb64u(keys.xpub), C.unb64u(body.k), C.unb64u(body.sid), 1)) });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(hooks.length, 1);
  t.mock.timers.tick(10_000); await Promise.resolve(); await Promise.resolve();
  assert.equal(hooks.length, 2);
  await mod.stop();
});

test("exports decrypt with timestamp and warn when old", async () => {
  const { mod } = make({ config: { webhookEnabled: false } });
  await mod.start();
  const out = mod.decryptExport(C.sealExport('{"mode":"export","players":[]}', keys.xpub, Math.floor(Date.now() / 1000) - 2 * 86400));
  assert.equal(out.warning, "old or future timestamp"); assert.equal(out.summary.mode, "export");
  assert.throws(() => mod.decryptExport("vlrx1.a.b.c"));
  await mod.stop();
});

test("refuses to start without keys or with a non-https webhook; never leaks secrets in errors", async () => {
  const bad = new Receiver({ config: { snapshotDir: path.join(tmp(), "s") }, getSecret: async (i, f) => (f === "uri" ? "http://plain" : secrets[`${i}|${f}`]), WebSocket: FakeWS, pins });
  await assert.rejects(() => bad.start(), (e) => /https/.test(e.message) && !e.message.includes(HOOK_KEY));
  assert.throws(() => new Receiver({ config: { snapshotDir: os.homedir() } }), /dedicated/);
});

test("local HTTP: 127.0.0.1 only, refuses Origin and foreign Host, never port 17346", async () => {
  const { createHttpServer } = await import("../src/http.js");
  assert.throws(() => createHttpServer({}, { port: 17346 }), /17346/);
  const port = 20000 + Math.floor(Math.random() * 30000);
  const dir = tmp();
  const mod = createModule({ config: { snapshotDir: path.join(dir, "s"), webhookEnabled: false, http: { port } }, getSecret, WebSocket: FakeWS, pins });
  await mod.start();
  try {
    let r = await fetch(`http://127.0.0.1:${port}/sessions`); assert.equal(r.status, 200);
    r = await fetch(`http://127.0.0.1:${port}/sessions`, { headers: { Origin: "https://evil.example" } }); assert.equal(r.status, 403);
    const http = await import("node:http");
    const code = await new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: "/sessions", headers: { Host: "evil.example" } }, (x) => { x.resume(); res(x.statusCode); }).on("error", rej));
    assert.equal(code, 421);
    assert.equal(mod.receiver.cfg.http.port, port);
    r = await fetch(`http://127.0.0.1:${port}/start-session`, { method: "POST" }); const j = await r.json();
    assert.equal(readToken(j.token).sid, j.session);
  } finally { await mod.stop(); }
});
