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
  assert.equal(C.PINNED.scope, 3);
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
  assert.equal(body.v, 1); assert.equal(body.scope, 3); assert.equal(body.sid, r.session);
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
  const snap = (seq, extra = {}) => ({ t: "data", d: C.b64u(C.seal(Buffer.from(JSON.stringify({ v: 1, scope: 3, mode: "live", reveal: false, players: [{ label: "P1", paired: true, sync: { state: "loaded" } }, { label: "P2", paired: true, sync: { state: "Firstname Lastname" } }], ...extra })), C.unb64u(keys.xpub), k, sid, seq)) });
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
  assert.equal(hooks[0].init.redirect, "error");
  const hb = JSON.parse(hooks[0].init.body);
  assert.equal(hb.path, files[0]); // relative file name, never an absolute path
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

test("a failing store.write or bad relay data never throws into the host", async () => {
  const { mod } = make();
  await mod.start();
  const r = await mod.startSession(); const body = readToken(r.token); const ws = FakeWS.last;
  mod.receiver.store.write = () => { const e = new Error("disk full"); e.code = "ENOSPC"; throw e; };
  const snap = () => ({ t: "data", d: C.b64u(C.seal(Buffer.from("{}"), C.unb64u(keys.xpub), C.unb64u(body.k), C.unb64u(body.sid), 1)) });
  assert.doesNotThrow(() => ws.relay(snap()));
  assert.doesNotThrow(() => ws.emit("message", { data: new Uint8Array([0xff, 0xfe]) }));
  assert.doesNotThrow(() => ws.relay({ t: "data", d: 42 }));
  assert.ok(mod.status()[0].log.some((l) => l.includes("ENOSPC")));
  await mod.stop();
  assert.equal(mod.status().length, 0); // session map cleared on stop
});

test("start failure zeroes keys; retention is capped", async () => {
  const rcv = new Receiver({ config: { snapshotDir: path.join(tmp(), "s") }, getSecret: async (i, f) => (f === "uri" ? "http://plain" : secrets[`${i}|${f}`]), WebSocket: FakeWS, pins });
  await assert.rejects(() => rcv.start(), /https/);
  assert.equal(rcv.keys, null); assert.equal(rcv.started, false);
  assert.equal(new Receiver({ config: { snapshotDir: path.join(tmp(), "s"), retentionHours: 10_000 } }).cfg.retentionHours, 500);
  assert.throws(() => new Receiver({ config: { snapshotDir: path.join(tmp(), "s"), retentionHours: 0 } }), /retentionHours/);
});

test("retention sweep deletes old files of finished sessions only", async () => {
  const { mod, dir } = make();
  await mod.start();
  const old = `${C.b64u(C.random(16))}-1.json`, fresh = `${C.b64u(C.random(16))}-1.json`;
  fs.writeFileSync(path.join(dir, old), "{}"); fs.writeFileSync(path.join(dir, fresh), "{}");
  const past = new Date(Date.now() - 25 * 3600_000); fs.utimesSync(path.join(dir, old), past, past);
  assert.equal(mod.receiver.store.sweep(24 * 3600_000), 1);
  assert.deepEqual(fs.readdirSync(dir), [fresh]);
  await mod.stop();
});

test("webhook: 4xx other than 408/429 is not retried", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { mod, hooks } = make({ hookStatus: 401 });
  await mod.start();
  const r = await mod.startSession(); const body = readToken(r.token); const ws = FakeWS.last;
  ws.relay({ t: "data", d: C.b64u(C.seal(Buffer.from("{}"), C.unb64u(keys.xpub), C.unb64u(body.k), C.unb64u(body.sid), 1)) });
  await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(60_000); await Promise.resolve(); await Promise.resolve();
  assert.equal(hooks.length, 1);
  await mod.stop();
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
  assert.throws(() => createHttpServer({}, { port: 17346, token: "x".repeat(43) }), /17346/);
  assert.throws(() => createHttpServer({}, { port: 17999 }), /token/);
  const port = 20000 + Math.floor(Math.random() * 30000);
  const dir = tmp();
  const mod = createModule({ config: { snapshotDir: path.join(dir, "s"), webhookEnabled: false, http: { enabled: true, port, tokenFile: path.join(dir, "tok") } }, getSecret, WebSocket: FakeWS, pins });
  await mod.start();
  try {
    const tok = mod.httpToken(); assert.equal(fs.readFileSync(path.join(dir, "tok"), "utf8"), tok);
    if (process.platform !== "win32") assert.equal(fs.statSync(path.join(dir, "tok")).mode & 0o777, 0o600);
    const A = { Authorization: `Bearer ${tok}` };
    let r = await fetch(`http://127.0.0.1:${port}/sessions`); assert.equal(r.status, 401);
    r = await fetch(`http://127.0.0.1:${port}/sessions`, { headers: { Authorization: "Bearer wrong" } }); assert.equal(r.status, 401);
    r = await fetch(`http://127.0.0.1:${port}/sessions`, { headers: A }); assert.equal(r.status, 200);
    r = await fetch(`http://127.0.0.1:${port}/sessions`, { headers: { ...A, Origin: "https://evil.example" } }); assert.equal(r.status, 403);
    const http = await import("node:http");
    const code = await new Promise((res, rej) => http.get({ host: "127.0.0.1", port, path: "/sessions", headers: { Host: "evil.example", ...A } }, (x) => { x.resume(); res(x.statusCode); }).on("error", rej));
    assert.equal(code, 421);
    assert.equal(mod.receiver.cfg.http.port, port);
    r = await fetch(`http://127.0.0.1:${port}/start-session`, { method: "POST", headers: A }); const j = await r.json();
    assert.equal(readToken(j.token).sid, j.session);
  } finally { await mod.stop(); }
  assert.equal(fs.existsSync(path.join(dir, "tok")), false);
  assert.equal(mod.httpToken(), null);
});

test("http interface is off by default", async () => {
  const { mod } = make();
  await mod.start(); assert.equal(mod.httpToken(), null); await mod.stop();
});

test("capture requests: strict validation, one-shot end after the matching reply, reqId in summary", async () => {
  const { validateRequest } = await import("../src/request.js");
  assert.deepEqual(validateRequest({ id: "a1", players: ["P12", "receiver"], sections: ["sync"] }), { id: "a1", players: ["P12", "receiver"], sections: ["sync"] });
  assert.deepEqual(validateRequest('{"id":"x"}'), { id: "x" });
  for (const bad of [null, [], "nope", {}, { id: "" }, { id: "a b" }, { id: "x".repeat(33) }, { id: "a", reveal: true }, { id: "a", extra: 1 },
    { id: "a", players: ["Firstname Lastname"] }, { id: "a", players: ["P1", "P1"] }, { id: "a", players: Array.from({ length: 21 }, (_, i) => `P${i}`) },
    { id: "a", sections: [] }, { id: "a", sections: ["chat"] }, { id: "a", sections: "sync" }, "x".repeat(401)])
    assert.throws(() => validateRequest(bad), undefined, JSON.stringify(bad)?.slice(0, 60));

  const { mod, hooks, dir } = make();
  await mod.start();
  const r = await mod.startSession({ request: { id: "first", sections: ["sync"] } }); const body = readToken(r.token); const ws = FakeWS.last;
  const k = C.unb64u(body.k), sid = C.unb64u(body.sid);
  const reply = (seq, reqId) => ({ t: "data", d: C.b64u(C.seal(Buffer.from(JSON.stringify({ v: 1, scope: 3, mode: "live", reveal: false, reqId, sections: ["sync"], players: [{ label: "P1", paired: true, sync: { state: "loaded" } }] })), C.unb64u(keys.xpub), k, sid, seq)) });
  assert.throws(() => mod.request(r.session, { id: "early" }), /not joined/);
  ws.relay({ t: "ok" }); ws.relay({ t: "joined" });
  assert.deepEqual(JSON.parse(ws.sent.at(-1)), { t: "refresh", req: { id: "first", sections: ["sync"] } });
  ws.relay(reply(1, undefined)); await tick(); // the tester's automatic first capture: kept, session stays open
  assert.equal(mod.status()[0].ended, false);
  ws.relay(reply(2, "other")); await tick();
  assert.equal(mod.status()[0].ended, false);
  ws.relay(reply(3, "first")); await tick();
  assert.equal(mod.status()[0].ended, true);
  assert.ok(ws.sent.includes('{"t":"end"}'));
  assert.equal(fs.readdirSync(dir).length, 3); // one-shot end keeps files for the retention period
  assert.equal(JSON.parse(hooks.at(-1).init.body).summary.reqId, "first");
  await mod.stop();

  const m2 = make(); await m2.mod.start();
  await assert.rejects(m2.mod.startSession({ request: { id: "a", reveal: true } }), /unknown key/);
  const r2 = await m2.mod.startSession(); const w2 = FakeWS.last; w2.relay({ t: "ok" }); w2.relay({ t: "joined" });
  assert.throws(() => m2.mod.request(r2.session, { id: "a", sections: ["names"] }), /bad sections/);
  assert.deepEqual(m2.mod.request(r2.session, { id: "q2", players: ["P3"] }), { session: r2.session, reqId: "q2" });
  assert.equal(w2.sent.at(-1), '{"t":"refresh","req":{"id":"q2","players":["P3"]}}');
  await m2.mod.stop();
});