// AI generated code.
using System;
using System.Collections.Generic;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using VierLinkRemote.Shared;

namespace VierLinkRemote;

/// <summary>One live session. Everything is in memory; End() wipes keys and token.</summary>
public sealed class Session
{
    public readonly List<string> Activity = new();
    public readonly Ctx Ctx = new();
    public string? Pending;           // snapshot awaiting the tester's Send (preview-before-send)
    public bool AutoSend;             // off by default
    public bool Connected;
    public bool Ended;
    public readonly long Exp;
    private readonly string sid;
    private byte[] k, sidBytes;
    private RelayClient? relay;
    private ulong seq;
    private DateTime nextAuto = DateTime.MinValue;

    public Session(TokenBody t)
    {
        sid = t.sid; Exp = t.exp; k = B64.Dec(t.k); sidBytes = B64.Dec(t.sid);
        Ctx.HashKey = Crypto.HashKey(k, sidBytes); Ctx.SelfKey = Crypto.SelfKey(k, sidBytes); Ctx.SelfHash = t.self;
        Note("token verified against pinned key " + Pinned.Fingerprint[..8] + "…; expires " + DateTimeOffset.FromUnixTimeSeconds(Exp).ToLocalTime().ToString("HH:mm"));
    }

    public void Note(string s) { lock (Activity) { Activity.Add($"{DateTime.Now:HH:mm:ss} {s}"); if (Activity.Count > 300) Activity.RemoveAt(0); } }

    public void Connect()
    {
        var ts = DateTimeOffset.UtcNow.ToUnixTimeSeconds(); var n = B64.Enc(Crypto.Random(16));
        var auth = Crypto.AuthKey(k, sidBytes);
        var hello = JsonSerializer.Serialize(new { t = "join", sid, ts, n, mac = Crypto.JoinMac(auth, sid, ts, n) });
        Array.Clear(auth);
        relay = new RelayClient();
        Note("connecting (outgoing only)…");
        var r = relay;
        Task.Run(async () => { try { await r.ConnectAsync(sid, "tester", hello); } catch (Exception e) { r.CloseReason = e.Message; r.Closed = true; } });
    }

    public void Capture() { Pending = Collector.Build(Ctx, "live"); Note("snapshot captured (" + Pending.Length + " chars)" + (AutoSend ? "" : "; waiting for you to press Send")); }

    public void SendPending()
    {
        if (Pending == null || relay == null || !Connected) return;
        var blob = Crypto.Seal(Encoding.UTF8.GetBytes(Pending), B64.Dec(Pinned.XPub), k, sidBytes, ++seq);
        var msg = JsonSerializer.Serialize(new { t = "data", d = B64.Enc(blob) });
        Pending = null;
        var r = relay; _ = Task.Run(async () => { try { await r.SendAsync(msg); } catch (Exception e) { Note("send failed: " + e.GetType().Name); } });
        Note($"sent encrypted snapshot #{seq} ({blob.Length} bytes)");
    }

    /// <summary>Framework thread.</summary>
    public void Tick()
    {
        if (Ended) return;
        if (DateTimeOffset.UtcNow.ToUnixTimeSeconds() >= Exp) { End("token expired"); return; }
        if (relay == null) return;
        while (relay.Inbox.TryDequeue(out var m))
        {
            string? t = null; try { t = JsonDocument.Parse(m).RootElement.GetProperty("t").GetString(); } catch { }
            switch (t)
            {
                case "ok": Connected = true; Note("connected; the viewer can now request snapshots"); Capture(); break;
                case "refresh": Note("viewer asked for a fresh snapshot"); Capture(); break;
                case "end": End("viewer ended the session"); return;
                default: Note("ignored unknown relay message"); break;
            }
        }
        if (relay.Closed) { End("relay closed: " + (relay.CloseReason ?? "?")); return; }
        if (AutoSend && Connected && DateTime.Now >= nextAuto) { nextAuto = DateTime.Now.AddSeconds(10); if (Pending == null) Capture(); SendPending(); }
    }

    public void End(string why)
    {
        if (Ended) return;
        Ended = true; Connected = false; Note("session ended: " + why);
        var r = relay; relay = null;
        if (r != null) Task.Run(async () => { try { if (!r.Closed) await r.SendAsync("{\"t\":\"end\"}"); } catch { } r.Dispose(); });
        Array.Clear(k); Array.Clear(sidBytes); Ctx.Wipe(); Pending = null;
        Plugin.Main.WipeToken();
    }
}
