// AI generated code. Port of Shared/Proto.cs (VierLink Remote protocol v1) to node:crypto. No dependencies.
import crypto from "node:crypto";

export const PINNED = Object.freeze({
  relayHost: "relay.lafxrfz8x1.workers.dev",
  xpub: "0BSjtgkq7MLcNveyw60nMOpcGrJXj4GJ-RWPcDKx3D8",
  edpub: "IoYptqyr-rn4SptqhjHxcDIAnxexZFpsa5zG4av3jiM",
  fingerprint: "3fc91495a6dfaa226937138c7cc2a4e0",
  protocol: 1,
  scope: 2, // must equal Pinned.Scope in Shared/Proto.cs
  tokenTtlSeconds: 3600,
});

export const b64u = (b) => Buffer.from(b).toString("base64url");
export const unb64u = (s) => {
  if (typeof s !== "string" || !/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad base64url");
  return Buffer.from(s, "base64url");
};
export const random = (n) => crypto.randomBytes(n);
export const relayBase = (host) => `wss://${host}/s/`;

const X_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const ED_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const X_SPKI = Buffer.from("302a300506032b656e032100", "hex");
const ED_SPKI = Buffer.from("302a300506032b6570032100", "hex");

const xPrivKey = (raw) => crypto.createPrivateKey({ key: Buffer.concat([X_PKCS8, raw]), format: "der", type: "pkcs8" });
const edPrivKey = (raw) => crypto.createPrivateKey({ key: Buffer.concat([ED_PKCS8, raw]), format: "der", type: "pkcs8" });
const xPubKey = (raw) => crypto.createPublicKey({ key: Buffer.concat([X_SPKI, raw]), format: "der", type: "spki" });
const edPubKey = (raw) => crypto.createPublicKey({ key: Buffer.concat([ED_SPKI, raw]), format: "der", type: "spki" });
const rawPub = (k) => k.export({ format: "der", type: "spki" }).subarray(12);

export const xPublic = (priv) => rawPub(crypto.createPublicKey(xPrivKey(priv)));
export const edPublic = (priv) => rawPub(crypto.createPublicKey(edPrivKey(priv)));

export function fingerprint(xpub, edpub) {
  return crypto.createHash("sha256").update(Buffer.concat([unb64u(xpub), unb64u(edpub)])).digest("hex").slice(0, 32);
}

/** Throwaway key pair (tests only). Returns raw 32-byte buffers. */
export function generateKeys() {
  const x = crypto.generateKeyPairSync("x25519"), e = crypto.generateKeyPairSync("ed25519");
  const xpriv = x.privateKey.export({ format: "der", type: "pkcs8" }).subarray(16);
  const edpriv = e.privateKey.export({ format: "der", type: "pkcs8" }).subarray(16);
  return { xpriv: Buffer.from(xpriv), edpriv: Buffer.from(edpriv), xpub: b64u(xPublic(xpriv)), edpub: b64u(edPublic(edpriv)) };
}

export const hkdf = (ikm, salt, info, len = 32) => Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from(info, "utf8"), len));
export const authKey = (k, sid) => hkdf(k, sid, "vlr1 tester-auth");
export const selfKey = (k, sid) => hkdf(k, sid, "vlr1 self");
export const H = (key, kind, value) => b64u(crypto.createHmac("sha256", key).update(Buffer.from(kind + "\0" + value, "utf8")).digest().subarray(0, 12));

function contentKey(shared, k, sid, epk, rpub) {
  const ikm = k ? Buffer.concat([shared, k]) : Buffer.from(shared);
  const ck = hkdf(ikm, sid, "vlr1 content" + b64u(epk) + b64u(rpub));
  ikm.fill(0);
  return ck;
}

function aad(sid, seq) {
  const s = Buffer.alloc(8); s.writeBigUInt64LE(BigInt(seq));
  return Buffer.concat([Buffer.from("vlr1", "ascii"), sid, s]);
}

/** Layout: 0x01 | epk(32) | nonce(12) | seq(8 LE) | tag(16) | ct. Used by tests to play the tester side. */
export function seal(plain, rpub, k, sid, seq) {
  const e = crypto.generateKeyPairSync("x25519");
  const epk = rawPub(e.publicKey);
  const shared = crypto.diffieHellman({ privateKey: e.privateKey, publicKey: xPubKey(rpub) });
  const ck = contentKey(shared, k, sid, epk, rpub); shared.fill(0);
  const nonce = random(12);
  const c = crypto.createCipheriv("aes-256-gcm", ck, nonce, { authTagLength: 16 });
  c.setAAD(aad(sid, seq));
  const ct = Buffer.concat([c.update(plain), c.final()]); const tag = c.getAuthTag(); ck.fill(0);
  const s = Buffer.alloc(8); s.writeBigUInt64LE(BigInt(seq));
  return Buffer.concat([Buffer.from([1]), epk, nonce, s, tag, ct]);
}

/** Returns { plain, seq } (seq as BigInt). Throws on any authentication failure. */
export function open(blob, xpriv, k, sid) {
  if (blob.length < 69 || blob[0] !== 1) throw new Error("bad blob");
  const epk = blob.subarray(1, 33), nonce = blob.subarray(33, 45), seq = blob.readBigUInt64LE(45), tag = blob.subarray(53, 69), ct = blob.subarray(69);
  const shared = crypto.diffieHellman({ privateKey: xPrivKey(xpriv), publicKey: xPubKey(epk) });
  const ck = contentKey(shared, k, sid, epk, xPublic(xpriv)); shared.fill(0);
  try {
    const d = crypto.createDecipheriv("aes-256-gcm", ck, nonce, { authTagLength: 16 });
    d.setAAD(aad(sid, seq)); d.setAuthTag(tag);
    return { plain: Buffer.concat([d.update(ct), d.final()]), seq };
  } finally { ck.fill(0); }
}

export const sign = (edpriv, msg) => crypto.sign(null, Buffer.from(msg, "utf8"), edPrivKey(edpriv));
export const verify = (edpub, msg, sig) => crypto.verify(null, Buffer.from(msg, "utf8"), edPubKey(edpub), sig);

/** Same field order as TokenBody in Proto.cs. */
export function makeToken(body, edpriv) {
  const b = { v: body.v, scope: body.scope, sid: body.sid, url: body.url, k: body.k, exp: body.exp, self: body.self ?? "" };
  const head = "vlr1." + b64u(Buffer.from(JSON.stringify(b), "utf8"));
  return head + "." + b64u(sign(edpriv, head));
}

export const createProofMessage = (sid, exp, auth, ts) => `vlr1-create|${sid}|${exp}|${auth}|${ts}`;
export const joinMac = (ak, sid, ts, n) => b64u(crypto.createHmac("sha256", ak).update(`vlr1-join|${sid}|${ts}|${n}`).digest());

/** vlrx1.<sid>.<unix ts>.<blob>; the timestamp is the GCM seq/AAD. Returns { json, at: Date }. */
export function openExport(text, xpriv) {
  const p = String(text).trim().split(".");
  if (p.length !== 4 || p[0] !== "vlrx1" || !/^\d{1,12}$/.test(p[2])) throw new Error("not an export");
  const ts = BigInt(p[2]);
  const { plain, seq } = open(unb64u(p[3]), xpriv, null, unb64u(p[1]));
  if (seq !== ts) throw new Error("timestamp mismatch");
  return { json: plain.toString("utf8"), at: new Date(Number(ts) * 1000) };
}

/** Test helper: the plugin's SealExport against an arbitrary receiver public key. */
export function sealExport(json, xpubB64, tsSec = Math.floor(Date.now() / 1000)) {
  const sid = random(16);
  return `vlrx1.${b64u(sid)}.${tsSec}.${b64u(seal(Buffer.from(json, "utf8"), unb64u(xpubB64), null, sid, tsSec))}`;
}

/** Parses "vlrk1.<xpriv>.<edpriv>" and checks it against the pins. Returns raw buffers. */
export function parseKeyBundle(bundle, pins) {
  const p = String(bundle ?? "").trim().split(".");
  if (p.length !== 3 || p[0] !== "vlrk1") throw new Error("not a key bundle");
  const x = unb64u(p[1]), e = unb64u(p[2]);
  if (x.length !== 32 || e.length !== 32 || b64u(xPublic(x)) !== pins.xpub || b64u(edPublic(e)) !== pins.edpub) {
    x.fill(0); e.fill(0); throw new Error("keys do not match the pinned public keys");
  }
  return { xpriv: x, edpriv: e };
}
