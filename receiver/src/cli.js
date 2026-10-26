#!/usr/bin/env node
// AI generated code. Thin client for the module's local HTTP interface (the module must already be running in its host).
// Usage: vlr-receiver --token-file F [--port N] start-session | sessions | refresh <id> | end <id> | export <file|->
import fs from "node:fs";

const args = process.argv.slice(2);
let port = 17361, tokenFile = null;
while (args[0] === "--port" || args[0] === "--token-file") { if (args[0] === "--port") port = Number(args[1]); else tokenFile = args[1]; args.splice(0, 2); }
const token = tokenFile ? fs.readFileSync(tokenFile, "utf8").trim() : process.env.VLR_RECEIVER_TOKEN ?? "";
const [cmd, arg] = args;
const base = `http://127.0.0.1:${port}`;
const call = async (method, path, body) => {
  const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json(); process.stdout.write(JSON.stringify(j, null, 2) + "\n"); if (!r.ok) process.exitCode = 1;
};
const routes = {
  "start-session": () => call("POST", "/start-session"),
  sessions: () => call("GET", "/sessions"),
  refresh: () => call("POST", `/sessions/${arg}/refresh`),
  end: () => call("POST", `/sessions/${arg}/end`),
  export: () => call("POST", "/export", { text: fs.readFileSync(arg === "-" || !arg ? 0 : arg, "utf8") }),
};
if (!routes[cmd]) { process.stderr.write("usage: vlr-receiver --token-file F [--port N] start-session | sessions | refresh <id> | end <id> | export <file|->\n"); process.exit(2); }
routes[cmd]().catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exit(1); });
