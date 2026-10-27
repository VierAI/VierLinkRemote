// AI generated code. Module entry point for a host process (for example Mac Script Master). Not a service by itself.
import { Receiver } from "./receiver.js";
import { createHttpServer } from "./http.js";
import crypto from "node:crypto";
import fs from "node:fs";
export { Receiver, sanitize, summarize } from "./receiver.js";
export * as protocol from "./crypto.js";

/**
 * createModule({ config, getSecret, log }) -> { start(), stop(), startSession(), refresh(id), end(id), decryptExport(text), status() }
 * config: snapshotDir (required), retentionHours (24), maxSessions (2), http: { enabled (false), port (17361), tokenFile },
 *   keysItem, keysField, webhookItem, webhookUrlField, webhookKeyField, webhookEnabled (true), secretCommand, selfName.
 */
export function createModule({ config = {}, getSecret, log, fetch, WebSocket, pins } = {}) {
  const receiver = new Receiver({ config, getSecret, log, fetch, WebSocket, pins });
  const httpCfg = { enabled: false, port: 17361, tokenFile: null, ...(config.http ?? {}) };
  let web = null, httpToken = null;
  const dropToken = () => { if (httpCfg.tokenFile) { try { fs.rmSync(httpCfg.tokenFile, { force: true }); } catch { /* ignore */ } } httpToken = null; };
  return {
    name: "vierlink-remote-receiver",
    receiver,
    async start() {
      await receiver.start();
      if (httpCfg.enabled) {
        httpToken = crypto.randomBytes(32).toString("base64url"); // new every start
        try {
          web = createHttpServer(receiver, { port: httpCfg.port, token: httpToken });
          await web.listen();
          if (httpCfg.tokenFile) { fs.rmSync(httpCfg.tokenFile, { force: true }); fs.writeFileSync(httpCfg.tokenFile, httpToken, { mode: 0o600, flag: "wx" }); }
        } catch (e) { if (web) { await web.close().catch(() => {}); web = null; } dropToken(); await receiver.stop(); throw e; }
        receiver.log("info", `local interface on http://127.0.0.1:${httpCfg.port}`);
      }
    },
    async stop() { if (web) { await web.close(); web = null; } dropToken(); await receiver.stop(); },
    /** The per-start bearer for the local HTTP interface (null when disabled). Hand it only to the host or CLI. */
    httpToken: () => httpToken,
    startSession: () => receiver.startSession(),
    refresh: (id) => receiver.refresh(id),
    end: (id) => receiver.end(id, "ended by request", { wipe: true }),
    decryptExport: (text) => receiver.decryptExport(text),
    status: () => receiver.status(),
  };
}
