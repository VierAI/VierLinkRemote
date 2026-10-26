// AI generated code.
using System;
using System.Numerics;
using System.Text;
using Dalamud.Bindings.ImGui;
using Dalamud.Interface.Windowing;
using VierLinkRemote.Shared;

namespace VierLinkRemote;

public sealed class MainWindow : Window
{
    private string token = "";
    private string? tokenError;
    private string? exportPreview, exportBlob;
    private bool exportReveal;
    private string? exportNote;
    private string? copyNote; private bool copyFailed;

    public MainWindow() : base("VierLink Remote") { Size = new Vector2(620, 600); SizeCondition = ImGuiCond.FirstUseEver; IsOpen = !Plugin.Allowed; }

    public void WipeToken() { token = ""; tokenError = null; }

    private static readonly Vector4 Warn = new(1f, 0.75f, 0.2f, 1f);

    public override void Draw()
    {
        ImGui.SetWindowFontScale(1.25f);
        ImGui.TextColored(Warn, "READ BEFORE ENABLING");
        ImGui.SetWindowFontScale(1f);
        ImGui.TextWrapped(
            "AI generated code.\n\n" +
            "This plugin lets ONE person who gives you a signed session token see how they and the players you are synced with " +
            "through PlayerSync appear on YOUR game, to debug outfit and mod sync. It is read only and only sends what you allow.\n\n" +
            "WHO VIEWS IT: live sessions and exports are received and read by an AUTOMATED ASSISTANT (an AI bot) run by the token owner, " +
            "not only by a person. It decrypts each snapshot, may keep it for up to 24 hours after the session ends, and may pass a " +
            "short summary (counts only, no names) to the owner's other bots.\n\n" +
            "What can be shared, per player within about 50 yalms who is drawn on your screen and is either a PlayerSync pair or the token's owner:\n" +
            " - PlayerSync sync state, status, last-apply time, and a per-session hash of the applied data\n" +
            " - Penumbra: counts of modded, missing and empty files, plus which game items are modded\n" +
            " - Glamourer: equipped item names only (no design names)\n" +
            " - Customize+: whether a profile is active (yes/no)\n" +
            " - how far they are from you, in yalms\n\n" +
            "Never shared: chat or party chat, file paths or file contents, players you are not synced with, anything about your own character.\n\n" +
            "By default other players' names, collection names and modded items are replaced by random per-session hashes and labels " +
            "(P12, P407...). The single 'Reveal' switch in the session window shows BOTH player names AND their mod/collection names " +
            "and modded items for that session only. The token owner's own character is always shown by name.\n\n" +
            "Data is encrypted on your PC so only the token owner can read it; the relay server sees ciphertext only. This plugin only " +
            "connects out and never opens a port. Nothing is saved to disk. Each token works once, for at most one hour. " +
            "While a session is live a 'BEING VIEWED' window stays open; closing it or pressing End stops everything immediately.");
        ImGui.Separator();

        var consent = Plugin.Cfg.ConsentedScope == Pinned.Scope;
        if (ImGui.Checkbox($"I have read this and agree (scope v{Pinned.Scope})", ref consent))
        { Plugin.Cfg.ConsentedScope = consent ? Pinned.Scope : 0; if (!consent) Plugin.Cfg.Enabled = false; Plugin.Save(); }
        if (!consent) { ImGui.TextDisabled("Agree above to enable. A newer scope version asks again."); return; }
        var en = Plugin.Cfg.Enabled;
        if (ImGui.Checkbox("Enable VierLink Remote", ref en)) { Plugin.Cfg.Enabled = en; Plugin.Save(); }
        if (!en) return;
        ImGui.TextDisabled("Pinned receiver key fingerprint: " + Pinned.Fingerprint + (Pinned.FingerprintMatches() ? "" : "  (MISMATCH - do not use)"));

        ImGui.Separator();
        ImGui.TextColored(Warn, "1. One-click export (no server, no token)");
        ImGui.Checkbox("Reveal names in this export", ref exportReveal);
        if (ImGui.Button("Build export preview"))
        {
            var c = new Ctx { Reveal = exportReveal };
            exportPreview = Collector.Build(c, "export", out var trimmedN); c.Wipe();
            exportNote = trimmedN > 0 ? $"Snapshot too large, trimmed: {trimmedN} player(s) left out." : null;
            exportBlob = Crypto.SealExport(exportPreview);
        }
        if (exportPreview != null && exportBlob != null)
        {
            if (exportNote != null) ImGui.TextColored(Warn, exportNote);
            ImGui.TextWrapped("This is exactly what is inside the encrypted text below. Only the token owner can decrypt it.");
            var pv = exportPreview;
            ImGui.InputTextMultiline("##pv", ref pv, 200000, new Vector2(-1, 180), ImGuiInputTextFlags.ReadOnly);
            if (ImGui.Button("Copy encrypted export to clipboard"))
            {
                copyFailed = !SecureClipboard.Set(exportBlob);
                copyNote = copyFailed ? "Copy failed: " + SecureClipboard.LastError + ". Try again." : "Export copied.";
            }
            if (copyNote != null) { if (copyFailed) ImGui.TextColored(Warn, copyNote); else ImGui.TextDisabled(copyNote); }
            ImGui.SameLine(); if (ImGui.Button("Discard")) { exportPreview = null; exportBlob = null; }
        }

        ImGui.Separator();
        ImGui.TextColored(Warn, "2. Live session");
        if (!Pinned.HostConfigured) { ImGui.TextDisabled("Live sessions are not available in this build (relay not configured)."); return; }
        if (Plugin.Current is { Ended: false }) { ImGui.Text("A session is live. See the BEING VIEWED window."); return; }
        ImGui.InputText("Session token", ref token, 4096, ImGuiInputTextFlags.Password);
        if (ImGui.Button("Verify and start"))
        {
            try { if (ImGui.GetClipboardText() == token) SecureClipboard.Clear(); } catch { } // don't leave the token on the clipboard
            try { var t = Crypto.ReadToken(token); Plugin.Current = new Session(t); Plugin.SessionWin.IsOpen = true; Plugin.Current.Connect(); tokenError = null; }
            catch (Exception e) { tokenError = e.Message; }
            token = "";
        }
        if (tokenError != null) ImGui.TextColored(new Vector4(1, 0.4f, 0.4f, 1), "Rejected: " + tokenError);
    }
}

public sealed class SessionWindow : Window
{
    public SessionWindow() : base("VierLink Remote - BEING VIEWED###vlrsession") { Size = new Vector2(560, 520); SizeCondition = ImGuiCond.FirstUseEver; RespectCloseHotkey = false; }

    public override void OnClose() { Plugin.Current?.End("session window closed"); }

    public override void Draw()
    {
        var s = Plugin.Current;
        if (s == null) { ImGui.Text("No session."); return; }
        ImGui.PushStyleColor(ImGuiCol.ChildBg, s.Ended ? new Vector4(0.25f, 0.25f, 0.25f, 1) : new Vector4(0.55f, 0.1f, 0.1f, 1));
        ImGui.BeginChild("banner", new Vector2(-1, 48), true);
        ImGui.SetWindowFontScale(1.4f);
        ImGui.Text(s.Ended ? "Session ended" : s.Connected ? "BEING VIEWED  (live)" : "Connecting…");
        ImGui.SetWindowFontScale(1f);
        ImGui.EndChild(); ImGui.PopStyleColor();
        if (!s.Ended)
        {
            ImGui.Text("Expires " + DateTimeOffset.FromUnixTimeSeconds(s.Exp).ToLocalTime().ToString("HH:mm:ss"));
            if (ImGui.Button("END SESSION")) s.End("ended by you");
            ImGui.SameLine();
            var rev = s.Ctx.Reveal;
            if (ImGui.Checkbox("Reveal names + mods (this session)", ref rev)) { s.Ctx.Reveal = rev; s.Note(rev ? "reveal ON" : "reveal off"); s.Pending = null; }
            ImGui.Checkbox("Auto-send every 10 s (skip preview)", ref s.AutoSend);
            if (s.Connected && ImGui.Button("Capture snapshot")) s.Capture();
            if (s.Pending != null)
            {
                ImGui.TextWrapped("Preview - exactly what will be encrypted and sent:");
                var p = s.Pending;
                ImGui.InputTextMultiline("##pending", ref p, 200000, new Vector2(-1, 170), ImGuiInputTextFlags.ReadOnly);
                if (ImGui.Button("Send")) s.SendPending();
                ImGui.SameLine(); if (ImGui.Button("Discard")) s.Pending = null;
            }
        }
        ImGui.Separator(); ImGui.Text("Activity (this session only, not saved):");
        ImGui.BeginChild("log", new Vector2(-1, -1), true);
        lock (s.Activity) foreach (var l in s.Activity) ImGui.TextUnformatted(l);
        ImGui.EndChild();
    }
}
