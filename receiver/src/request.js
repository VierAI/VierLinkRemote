// AI generated code. Capture request validation; mirrors Shared/Request.cs. A request only narrows a snapshot.
export const SECTIONS = Object.freeze(["sync", "penumbra", "glamourer", "customizePlus", "distance"]);
export const MAX_PLAYERS = 20;
export const MAX_RAW = 400;
const ID = /^[A-Za-z0-9_-]{1,32}$/;
const LABEL = /^(P[0-9]{1,4}|receiver)$/;

function set(a, max, ok, what) {
  if (!Array.isArray(a) || a.length > max) throw new Error(`bad ${what}`);
  const s = new Set();
  for (const v of a) { if (typeof v !== "string" || !ok(v) || s.has(v)) throw new Error(`bad ${what}`); s.add(v); }
  return [...s];
}

/** Returns a clean copy { id, players?, sections? } or throws. Accepts an object or a JSON string. */
export function validateRequest(input) {
  let r = input;
  if (typeof r === "string") { if (r.length > MAX_RAW) throw new Error("request too large"); try { r = JSON.parse(r); } catch { throw new Error("request is not JSON"); } }
  if (!r || typeof r !== "object" || Array.isArray(r)) throw new Error("request must be an object");
  for (const k of Object.keys(r)) if (!["id", "players", "sections"].includes(k)) throw new Error(`unknown key ${JSON.stringify(k).slice(0, 40)}`);
  if (typeof r.id !== "string" || !ID.test(r.id)) throw new Error("bad id");
  const out = { id: r.id };
  if (r.players !== undefined) out.players = set(r.players, MAX_PLAYERS, (v) => LABEL.test(v), "players");
  if (r.sections !== undefined) { out.sections = set(r.sections, SECTIONS.length, (v) => SECTIONS.includes(v), "sections"); if (!out.sections.length) throw new Error("sections must not be empty"); }
  if (JSON.stringify(out).length > MAX_RAW) throw new Error("request too large");
  return out;
}

export const newRequestId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);