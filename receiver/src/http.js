// AI generated code. Optional local HTTP interface. Binds 127.0.0.1 only; refuses browser (Origin) and foreign Host headers.
import http from "node:http";

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };

export function createHttpServer(receiver, { port }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 17346) throw new Error("http.port must be 1024-65535 and not 17346");
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.origin !== undefined) return json(res, 403, { error: "browser requests refused" });
      if (!hosts.has(String(req.headers.host))) return json(res, 421, { error: "bad host" });
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.search) return json(res, 400, { error: "no query strings" });
      let body = "";
      if (req.method === "POST") {
        for await (const c of req) { body += c; if (body.length > 400_000) return json(res, 413, { error: "too large" }); }
      }
      const m = url.pathname.match(/^\/sessions\/([A-Za-z0-9_-]{22})\/(refresh|end)$/);
      if (req.method === "POST" && url.pathname === "/start-session") return json(res, 200, await receiver.startSession());
      if (req.method === "POST" && m && m[2] === "refresh") { receiver.refresh(m[1]); return json(res, 200, { ok: true }); }
      if (req.method === "POST" && m && m[2] === "end") return json(res, 200, { ok: receiver.end(m[1], "ended by request", { wipe: true }) });
      if (req.method === "POST" && url.pathname === "/export") {
        let text = body; try { const j = JSON.parse(body); if (typeof j?.text === "string") text = j.text; } catch { /* raw body */ }
        return json(res, 200, receiver.decryptExport(text));
      }
      if (req.method === "GET" && url.pathname === "/sessions") return json(res, 200, { sessions: receiver.status() });
      return json(res, 404, { error: "not found" });
    } catch (e) { return json(res, 400, { error: String(e?.message ?? e) }); }
  });
  return {
    listen: () => new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => resolve(server.address())); }),
    close: () => new Promise((resolve) => server.close(() => resolve())),
    server,
  };
}
