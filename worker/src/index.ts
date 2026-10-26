// AI generated code.
// Relay for VierLink Remote. Routes opaque ciphertext between exactly one creator and one tester per session.
// Never logs anything: no console calls exist in this file on purpose.

export interface Env { SESSIONS: DurableObjectNamespace }

// Receiver's Ed25519 public key (base64url). Only this key can create sessions.
const CREATOR_ED25519_PUB = "IoYptqyr-rn4SptqhjHxcDIAnxexZFpsa5zG4av3jiM";
const MAX_DATA = 64 * 1024;   // tester -> creator frame cap
const MAX_CTL = 512;          // creator -> tester frame cap
const MAX_TTL = 3600;         // seconds
const SKEW = 120;             // seconds
const HELLO_TIMEOUT_MS = 10_000;
const SID_RE = /^[A-Za-z0-9_-]{22}$/;

const notFound = () => new Response(null, { status: 404 });

function b64u(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}
const enc = new TextEncoder();
const now = () => Math.floor(Date.now() / 1000);

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // WebSocket only; browsers (any Origin header) are refused, so no CORS surface exists.
    if (req.method !== "GET" || req.headers.get("Upgrade")?.toLowerCase() !== "websocket" || req.headers.has("Origin")) return notFound();
    const u = new URL(req.url);
    if (u.search !== "") return notFound();
    const m = /^\/s\/([^/]+)$/.exec(u.pathname);
    if (!m || !SID_RE.test(m[1])) return notFound();
    const role = req.headers.get("X-VLR-Role");
    if (role !== "creator" && role !== "tester") return notFound();
    return env.SESSIONS.get(env.SESSIONS.idFromName(m[1])).fetch(req);
  },
};

interface Meta { sid: string; exp: number; auth: string; consumed: boolean }
interface Bucket { tokens: number; at: number }

export class Session {
  private creator: WebSocket | null = null;
  private tester: WebSocket | null = null;
  private meta: Meta | null = null;
  private ended = false;
  // Synchronous claims taken before any await, so concurrent hellos cannot both pass (input gates open on awaits).
  private creatorClaimed = false;
  private testerClaimed = false;

  constructor(private state: DurableObjectState, _env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const sid = new URL(req.url).pathname.split("/")[2];
    const role = req.headers.get("X-VLR-Role") as "creator" | "tester";
    if (this.ended) return notFound();
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    let authed = false;
    const bucket: Bucket = { tokens: 5, at: Date.now() };
    const timer = setTimeout(() => { if (!authed) this.close(server, 4401, "auth timeout"); }, HELLO_TIMEOUT_MS);

    server.addEventListener("message", (ev: MessageEvent) => { void (async () => {
      const data = typeof ev.data === "string" ? ev.data : "";
      const cap = !authed ? 2048 : role === "tester" ? MAX_DATA : MAX_CTL;
      if (data.length === 0 || data.length > cap) return this.close(server, 4413, "too large");
      if (!take(bucket, role === "tester" ? 1 : 2)) return this.close(server, 4429, "rate limited");
      let msg: any; try { msg = JSON.parse(data); } catch { return this.close(server, 4400, "bad frame"); }
      if (!authed) {
        const ok = role === "creator" ? await this.authCreator(sid, msg) : await this.authTester(sid, msg);
        if (!ok) return this.close(server, 4403, "denied");
        authed = true; clearTimeout(timer);
        if (role === "creator") this.creator = server;
        else { this.tester = server; this.creator?.send('{"t":"joined"}'); }
        server.send('{"t":"ok"}');
        return;
      }
      if (msg?.t === "end") return this.endAll();
      if (role === "tester" && msg?.t === "data" && typeof msg.d === "string") { this.creator?.send(JSON.stringify({ t: "data", d: msg.d })); return; }
      if (role === "creator" && msg?.t === "refresh") { this.tester?.send('{"t":"refresh"}'); return; }
      this.close(server, 4400, "bad frame");
    })(); });
    const gone = () => { clearTimeout(timer); if (authed) this.endAll(); };
    server.addEventListener("close", gone);
    server.addEventListener("error", gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async authCreator(sid: string, m: any): Promise<boolean> {
    if (this.creatorClaimed || this.creator || this.meta) return false;
    this.creatorClaimed = true; // never released: one creation attempt per session object
    if (m?.t !== "create" || m.sid !== sid || typeof m.auth !== "string" || typeof m.sig !== "string") return false;
    if ((await this.state.storage.get("meta")) || (await this.state.storage.get("dead"))) return false; // one creation per session id
    const t = now();
    if (!Number.isInteger(m.ts) || Math.abs(t - m.ts) > SKEW) return false;
    if (!Number.isInteger(m.exp) || m.exp <= t || m.exp > t + MAX_TTL + SKEW) return false;
    try {
      const key = await crypto.subtle.importKey("raw", b64u(CREATOR_ED25519_PUB), { name: "Ed25519" }, false, ["verify"]);
      const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, b64u(m.sig), enc.encode(`vlr1-create|${sid}|${m.exp}|${m.auth}|${m.ts}`));
      if (!ok || b64u(m.auth).length !== 32) return false;
    } catch { return false; }
    this.meta = { sid, exp: m.exp, auth: m.auth, consumed: false };
    await this.state.storage.put("meta", this.meta);
    await this.state.storage.setAlarm(m.exp * 1000);
    return true;
  }

  private async authTester(sid: string, m: any): Promise<boolean> {
    const meta = this.meta;
    if (!meta || !this.creator || this.tester || meta.consumed || this.testerClaimed) return false; // second tester rejected
    if (m?.t !== "join" || m.sid !== sid || typeof m.n !== "string" || typeof m.mac !== "string") return false;
    const t = now();
    if (!Number.isInteger(m.ts) || Math.abs(t - m.ts) > SKEW || t >= meta.exp) return false;
    this.testerClaimed = true; // claimed synchronously, before the first await
    let ok = false;
    try {
      const key = await crypto.subtle.importKey("raw", b64u(meta.auth), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
      ok = await crypto.subtle.verify("HMAC", key, b64u(m.mac), enc.encode(`vlr1-join|${sid}|${m.ts}|${m.n}`));
    } catch { ok = false; }
    if (!ok) {
      // Safe to release: nothing was consumed and no other join could pass while the claim was held.
      // Releasing keeps a bad guess from burning the real tester's token.
      this.testerClaimed = false;
      return false;
    }
    meta.consumed = true; // single use: consumed at first successful handshake
    await this.state.storage.put("meta", meta);
    return true;
  }

  private close(ws: WebSocket, code: number, reason: string) { try { ws.close(code, reason); } catch { /* already closed */ } }

  private async endAll() {
    if (this.ended) return;
    this.ended = true;
    for (const ws of [this.creator, this.tester]) if (ws) { try { ws.send('{"t":"end"}'); } catch { } this.close(ws, 1000, "session ended"); }
    this.creator = this.tester = null; this.meta = null;
    await this.state.storage.deleteAll();
    // Short tombstone so a captured create message cannot be replayed inside its timestamp window.
    await this.state.storage.put("dead", 1);
    await this.state.storage.setAlarm(Date.now() + 2 * SKEW * 1000);
  }

  async alarm() {
    if (await this.state.storage.get("dead")) { await this.state.storage.deleteAll(); return; }
    await this.endAll();
  }
}

function take(b: Bucket, perSec: number): boolean {
  const t = Date.now();
  b.tokens = Math.min(5, b.tokens + ((t - b.at) / 1000) * perSec); b.at = t;
  if (b.tokens < 1) return false;
  b.tokens -= 1; return true;
}
