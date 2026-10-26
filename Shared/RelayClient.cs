// AI generated code.
using System;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace VierLinkRemote.Shared;

/// <summary>Outgoing-only WebSocket to the pinned relay. Never listens. Incoming frames are queued for the UI thread.</summary>
public sealed class RelayClient : IDisposable
{
    public const int MaxFrame = 60 * 1024;        // largest frame we send (Worker accepts 64 KiB)
    public const int MaxReceive = 96 * 1024;      // receive headroom above the Worker maximum
    private readonly ClientWebSocket ws = new();
    private readonly CancellationTokenSource cts = new();
    private readonly SemaphoreSlim sendLock = new(1, 1);
    public readonly ConcurrentQueue<string> Inbox = new();
    public volatile bool Closed;
    public string? CloseReason;

    public async Task ConnectAsync(string sid, string role, string hello)
    {
        if (!Pinned.HostConfigured) throw new InvalidOperationException("relay hostname is not configured in this build");
        ws.Options.SetRequestHeader("X-VLR-Role", role);
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        using var t = CancellationTokenSource.CreateLinkedTokenSource(cts.Token); t.CancelAfter(TimeSpan.FromSeconds(15));
        await ws.ConnectAsync(new Uri(Pinned.RelayBase + sid), t.Token);
        await SendAsync(hello);
        _ = Task.Run(ReceiveLoop);
    }

    public async Task SendAsync(string text)
    {
        var b = Encoding.UTF8.GetBytes(text);
        if (b.Length > MaxFrame) throw new InvalidOperationException("message too large");
        await sendLock.WaitAsync(cts.Token);
        try { await ws.SendAsync(b, WebSocketMessageType.Text, true, cts.Token); } finally { sendLock.Release(); }
    }

    private async Task ReceiveLoop()
    {
        var buf = new byte[MaxReceive];
        try
        {
            while (ws.State == WebSocketState.Open && !cts.IsCancellationRequested)
            {
                int n = 0; WebSocketReceiveResult r;
                do
                {
                    if (n >= buf.Length) throw new InvalidOperationException("frame too large");
                    r = await ws.ReceiveAsync(new ArraySegment<byte>(buf, n, buf.Length - n), cts.Token);
                    if (r.MessageType == WebSocketMessageType.Close) { CloseReason = ws.CloseStatusDescription ?? "closed by relay"; Closed = true; return; }
                    n += r.Count;
                } while (!r.EndOfMessage);
                Inbox.Enqueue(Encoding.UTF8.GetString(buf, 0, n));
            }
        }
        catch (Exception e) { CloseReason ??= e.GetType().Name; }
        finally { Closed = true; }
    }

    public void Dispose()
    {
        try { if (ws.State == WebSocketState.Open) ws.CloseOutputAsync(WebSocketCloseStatus.NormalClosure, "end", CancellationToken.None).Wait(1000); } catch { }
        Closed = true; cts.Cancel(); ws.Dispose();
    }
}
