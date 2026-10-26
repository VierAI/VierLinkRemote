// AI generated code. Module entry point for a host process (for example Mac Script Master). Not a service by itself.
import { Receiver } from "./receiver.js";
import { createHttpServer } from "./http.js";
export { Receiver, sanitize, summarize } from "./receiver.js";
export * as protocol from "./crypto.js";

/**
 * createModule({ config, getSecret, log }) -> { start(), stop(), startSession(), refresh(id), end(id), decryptExport(text), status() }
 * config: snapshotDir (required), retentionHours (24), maxSessions (2), http: { enabled (true), port (17361) },
 *   keysItem, keysField, webhookItem, webhookUrlField, webhookKeyField, webhookEnabled (true), secretCommand, selfName.
 */
export function createModule({ config = {}, getSecret, log, fetch, WebSocket, pins } = {}) {
  const receiver = new Receiver({ config, getSecret, log, fetch, WebSocket, pins });
  const httpCfg = { enabled: true, port: 17361, ...(config.http ?? {}) };
  let web = null;
  return {
    name: "vierlink-remote-receiver",
    receiver,
    async start() {
      await receiver.start();
      if (httpCfg.enabled) {
        web = createHttpServer(receiver, { port: httpCfg.port });
        try { await web.listen(); } catch (e) { await receiver.stop(); throw e; }
        receiver.log("info", `local interface on http://127.0.0.1:${httpCfg.port}`);
      }
    },
    async stop() { if (web) { await web.close(); web = null; } await receiver.stop(); },
    startSession: () => receiver.startSession(),
    refresh: (id) => receiver.refresh(id),
    end: (id) => receiver.end(id, "ended by request", { wipe: true }),
    decryptExport: (text) => receiver.decryptExport(text),
    status: () => receiver.status(),
  };
}
