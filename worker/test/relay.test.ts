// AI generated code. Worker unit tests (vitest + workers pool / miniflare). No network, no real keys.
import { SELF, env, runInDurableObject } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rnd = (n: number) => crypto.getRandomValues(new Uint8Array(n));
const newSid = () => b64u(rnd(16));
const now = () => Math.floor(Date.now() / 1000);

async function open(sid: string, role: string) {
  const res = await SELF.fetch(`https://relay.test/s/${sid}`, { headers: { Upgrade: "websocket", "X-VLR-Role": role } });
  expect(res.status).toBe(101);
  const ws = res.webSocket!; ws.accept();
  const msgs: string[] = []; let closed: number | null = null;
  ws.addEventListener("message", e => { msgs.push(String(e.data)); });
  ws.addEventListener("close", e => { closed = e.code; });
  const wait = async (pred: () => boolean) => { for (let i = 0; i < 100 && !pred(); i++) await new Promise(r => setTimeout(r, 10)); };
  return { ws, msgs, get closed() { return closed; }, wait };
}

// Seed a created session directly (the creator Ed25519 key is pinned and its private half is not available to tests).
async function seed(sid: string, auth: Uint8Array) {
  const ns = (env as any).SESSIONS as DurableObjectNamespace;
  const stub: any = ns.get(ns.idFromName(sid));
  await (runInDurableObject as any)(stub, async (inst: any) => {
    inst.meta = { sid, exp: now() + 600, auth: b64u(auth), consumed: false };
    inst.creatorClaimed = true;
    inst.creator = { send() {}, close() {} };
  });
}

async function joinMsg(sid: string, auth: Uint8Array, good = true) {
  const ts = now(), n = b64u(rnd(8));
  const key = await crypto.subtle.importKey("raw", good ? auth : rnd(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`vlr1-join|${sid}|${ts}|${n}`)));
  return JSON.stringify({ t: "join", sid, ts, n, mac: b64u(mac) });
}

describe("routing", () => {
  it("refuses non-websocket, Origin, query strings, bad sid, bad role", async () => {
    const sid = newSid();
    expect((await SELF.fetch(`https://relay.test/s/${sid}`)).status).toBe(404);
    expect((await SELF.fetch(`https://relay.test/s/${sid}`, { headers: { Upgrade: "websocket", "X-VLR-Role": "tester", Origin: "https://evil.example" } })).status).toBe(404);
    expect((await SELF.fetch(`https://relay.test/s/${sid}?x=1`, { headers: { Upgrade: "websocket", "X-VLR-Role": "tester" } })).status).toBe(404);
    expect((await SELF.fetch(`https://relay.test/s/short`, { headers: { Upgrade: "websocket", "X-VLR-Role": "tester" } })).status).toBe(404);
    expect((await SELF.fetch(`https://relay.test/s/${sid}`, { headers: { Upgrade: "websocket", "X-VLR-Role": "admin" } })).status).toBe(404);
  });
});

describe("auth", () => {
  it("rejects a creator with a bad signature", async () => {
    const sid = newSid(); const c = await open(sid, "creator");
    c.ws.send(JSON.stringify({ t: "create", sid, exp: now() + 600, auth: b64u(rnd(32)), ts: now(), sig: b64u(rnd(64)) }));
    await c.wait(() => c.closed !== null);
    expect(c.closed).toBe(4403);
  });

  it("rejects a tester when no session exists", async () => {
    const sid = newSid(); const t = await open(sid, "tester");
    t.ws.send(await joinMsg(sid, rnd(32)));
    await t.wait(() => t.closed !== null);
    expect(t.closed).toBe(4403);
  });

  it("a wrong MAC does not burn the token; the right one then works", async () => {
    const sid = newSid(), auth = rnd(32); await seed(sid, auth);
    const bad = await open(sid, "tester"); bad.ws.send(await joinMsg(sid, auth, false));
    await bad.wait(() => bad.closed !== null); expect(bad.closed).toBe(4403);
    const good = await open(sid, "tester"); good.ws.send(await joinMsg(sid, auth));
    await good.wait(() => good.msgs.length > 0); expect(good.msgs[0]).toBe('{"t":"ok"}');
  });
});

describe("single use", () => {
  it("rejects a second tester, including a concurrent one", async () => {
    const sid = newSid(), auth = rnd(32); await seed(sid, auth);
    const a = await open(sid, "tester"), b = await open(sid, "tester");
    const [ma, mb] = [await joinMsg(sid, auth), await joinMsg(sid, auth)];
    a.ws.send(ma); b.ws.send(mb); // race
    await a.wait(() => (a.msgs.length > 0 || a.closed !== null) && (b.msgs.length > 0 || b.closed !== null));
    const oks = [a, b].filter(x => x.msgs.includes('{"t":"ok"}')).length;
    expect(oks).toBe(1);
    const c = await open(sid, "tester"); c.ws.send(await joinMsg(sid, auth));
    await c.wait(() => c.closed !== null); expect(c.closed).toBe(4403);
  });
});

describe("size caps", () => {
  it("closes an unauthenticated socket that sends an oversized hello", async () => {
    const sid = newSid(); const t = await open(sid, "tester");
    t.ws.send("x".repeat(3000));
    await t.wait(() => t.closed !== null); expect(t.closed).toBe(4413);
  });

  it("closes a tester that sends a frame over 64 KiB", async () => {
    const sid = newSid(), auth = rnd(32); await seed(sid, auth);
    const t = await open(sid, "tester"); t.ws.send(await joinMsg(sid, auth));
    await t.wait(() => t.msgs.length > 0);
    t.ws.send(JSON.stringify({ t: "data", d: "A".repeat(65 * 1024) }));
    await t.wait(() => t.closed !== null); expect(t.closed).not.toBeNull();
  });
});
