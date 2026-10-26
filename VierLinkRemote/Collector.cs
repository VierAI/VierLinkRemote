// AI generated code.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dalamud.Game.ClientState.Objects.SubKinds;
using Lumina.Excel.Sheets;
using Newtonsoft.Json.Linq;
using VierLinkRemote.Shared;

namespace VierLinkRemote;

/// <summary>Per-snapshot context: all hashes are keyed per session, labels randomized per session.</summary>
public sealed class Ctx
{
    public byte[] HashKey = Crypto.Random(32);
    public byte[]? SelfKey;
    public string SelfHash = "";
    public bool Reveal;
    private readonly Dictionary<string, string> labels = new();
    private readonly Queue<int> pool;
    public Ctx() { var r = new Random(BitConverter.ToInt32(Crypto.Random(4))); pool = new Queue<int>(Enumerable.Range(1, 999).OrderBy(_ => r.Next())); }
    public string Label(string nameHash) { if (!labels.TryGetValue(nameHash, out var l)) labels[nameHash] = l = "P" + (pool.Count > 0 ? pool.Dequeue() : labels.Count + 1); return l; }
    public string H(string kind, string v) => Crypto.H(HashKey, kind, v);
    public void Wipe() { Array.Clear(HashKey); if (SelfKey != null) Array.Clear(SelfKey); labels.Clear(); }
}

public static unsafe class Collector
{
    public const float MaxYalms = 50f;
    private static readonly string[] Slots = { "MainHand", "OffHand", "Head", "Body", "Hands", "Legs", "Feet", "Ears", "Neck", "Wrists", "RFinger", "LFinger" };

    private sealed record Pair(string? State, string? Status, string? LastApplyUtc, string? DataHash);

    /// <summary>Framework thread only. Returns the snapshot JSON (pretty) that is previewed and then encrypted.</summary>
    /// <summary>Plaintext cap so the encrypted, base64'd, enveloped frame stays under the relay limit.</summary>
    public const int MaxPlain = 40 * 1024;

    public static string Build(Ctx c, string mode) => Build(c, mode, out _);

    public static string Build(Ctx c, string mode, out int trimmed)
    {
        trimmed = 0;
        var lp = Plugin.Objects.LocalPlayer;
        var root = new JsonObject { ["v"] = Pinned.Protocol, ["scope"] = Pinned.Scope, ["mode"] = mode, ["reveal"] = c.Reveal, ["atUtc"] = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ") };
        var players = new JsonArray();
        if (lp == null) { root["error"] = "not logged in"; root["players"] = players; return root.ToJsonString(new JsonSerializerOptions { WriteIndented = true }); }

        var (pairs, source) = ReadPairs();
        var handled = ReadHandled();
        root["syncSource"] = source;
        foreach (var o in Plugin.Objects)
        {
            if (o is not IPlayerCharacter pc || o.Address == 0 || o.Address == lp.Address) continue;
            var go = (FFXIVClientStructs.FFXIV.Client.Game.Object.GameObject*)o.Address;
            if (go->DrawObject == null) continue; // not rendered
            var dist = Vector3.Distance(lp.Position, o.Position);
            if (dist > MaxYalms) continue;
            var nw = pc.Name.TextValue + "@" + (pc.HomeWorld.ValueNullable?.Name.ExtractText() ?? "?");
            var isSelf = c.SelfKey != null && c.SelfHash.Length > 0 && Crypto.H(c.SelfKey, "self", nw.ToLowerInvariant()) == c.SelfHash;
            pairs.TryGetValue(o.ObjectIndex, out var pair);
            var paired = pair != null || handled.Contains(o.Address);
            if (!isSelf && !paired) continue; // vanilla / unpaired players are never included
            var open = isSelf || c.Reveal;
            var nh = c.H("name", nw);
            var p = new JsonObject { ["label"] = isSelf ? "receiver" : c.Label(nh), ["self"] = isSelf, ["paired"] = paired, ["distance"] = Math.Round(dist, 1) };
            if (open) p["name"] = nw; else p["nameHash"] = nh;
            if (pair != null) p["sync"] = new JsonObject { ["state"] = pair.State, ["status"] = pair.Status, ["lastApplyUtc"] = pair.LastApplyUtc, ["dataHash"] = pair.DataHash == null ? null : c.H("data", pair.DataHash) };
            else p["sync"] = new JsonObject { ["state"] = paired ? "handled (no state IPC)" : "not paired" };
            p["penumbra"] = Penumbra(o.ObjectIndex, c, open);
            p["glamourer"] = Glamourer(o.ObjectIndex);
            p["customizePlus"] = CPlus(o.ObjectIndex);
            players.Add(p);
        }
        root["players"] = players;
        var opt = new JsonSerializerOptions { WriteIndented = true };
        var text = root.ToJsonString(opt);
        while (System.Text.Encoding.UTF8.GetByteCount(text) > MaxPlain && players.Count > 0)
        {
            players.RemoveAt(players.Count - 1); trimmed++;
            root["trimmed"] = $"snapshot too large: {trimmed} player(s) left out";
            text = root.ToJsonString(opt);
        }
        return text;
    }

    private static readonly System.Text.RegularExpressions.Regex Word = new("^[A-Za-z][A-Za-z _-]{0,23}$");
    /// <summary>PSync state/status reduced to a short word; anything else (could hold names or IDs) becomes "other".</summary>
    private static string? Enum(string? s) => s == null ? null : Word.IsMatch(s) && !s.Contains('@') ? s : "other";
    private static string? Utc(string? s) => s != null && DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var d) ? d.ToString("yyyy-MM-ddTHH:mm:ssZ") : null;

    private static (Dictionary<int, Pair>, string) ReadPairs()
    {
        var d = new Dictionary<int, Pair>();
        try
        {
            var ver = Plugin.Pi.GetIpcSubscriber<int>("PSync.GetPairStatesVersion").InvokeFunc();
            if (ver < 2) return (d, "pair-state IPC too old");
            var raw = Plugin.Pi.GetIpcSubscriber<string>("PSync.GetPairStates").InvokeFunc();
            foreach (var it in JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "[]" : raw).RootElement.EnumerateArray())
            {
                int? ix = null;
                foreach (var k in new[] { "objIndex", "objectIndex" }) if (it.TryGetProperty(k, out var e) && e.ValueKind == JsonValueKind.Number && e.TryGetInt32(out var x)) ix = x;
                if (ix is not { } i || i < 0) continue;
                d[i] = new Pair(Enum(S(it, "state")), Enum(S(it, "status")), Utc(S(it, "lastApplyUtc")), S(it, "dataHash"));
            }
            return (d, "pair-states v" + ver);
        }
        catch { return (d, "pair-state IPC unavailable"); }
        static string? S(JsonElement o, string k) => o.TryGetProperty(k, out var e) ? (e.ValueKind == JsonValueKind.String ? e.GetString() : e.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined ? null : e.ToString()) : null;
    }

    private static HashSet<nint> ReadHandled()
    {
        foreach (var label in new[] { "PlayerSync.GetHandledAddresses", "MareSynchronos.GetHandledAddresses" })
            try { return new HashSet<nint>(Plugin.Pi.GetIpcSubscriber<List<nint>>(label).InvokeFunc()); } catch { }
        return new HashSet<nint>();
    }

    private static JsonObject Penumbra(int ix, Ctx c, bool open)
    {
        var o = new JsonObject();
        try
        {
            var col = Plugin.Pi.GetIpcSubscriber<int, (bool, bool, (Guid, string))>("Penumbra.GetCollectionForObject.V5").InvokeFunc(ix);
            if (col.Item1) { if (open) o["collection"] = col.Item3.Item2; else o["collectionHash"] = c.H("col", col.Item3.Item2); }
        }
        catch { o["collectionError"] = "IPC unavailable"; }
        try
        {
            var res = Plugin.Pi.GetIpcSubscriber<ushort[], Dictionary<string, HashSet<string>>?[]>("Penumbra.GetGameObjectResourcePaths.V5").InvokeFunc(new[] { (ushort)ix });
            var map = res.Length > 0 ? res[0] : null;
            int redirected = 0, missing = 0, empty = 0; var changed = new SortedSet<string>(StringComparer.Ordinal);
            if (map != null)
                foreach (var (resolved, games) in map)
                {
                    if (!Path.IsPathRooted(resolved)) continue; // unmodded game file
                    redirected++;
                    try { var fi = new FileInfo(resolved); if (!fi.Exists) missing++; else if (fi.Length == 0) empty++; } catch { missing++; }
                    foreach (var g in games) changed.Add(Prefix(g)); // game-path prefix only; never the local file path
                }
            o["redirectedFiles"] = redirected; o["missingFiles"] = missing; o["emptyFiles"] = empty;
            var arr = new JsonArray(); foreach (var g in changed) arr.Add(open ? g : c.H("item", g));
            o[open ? "changedItems" : "changedItemHashes"] = arr;
        }
        catch { o["resourceError"] = "IPC unavailable"; }
        return o;
    }

    /// <summary>"chara/equipment/e6012/model/c0201e6012_top.mdl" -> "chara/equipment/e6012".</summary>
    private static string Prefix(string g) { var s = g.Replace('\\', '/').Split('/'); return string.Join('/', s.Take(Math.Min(3, Math.Max(1, s.Length - 1)))); }

    private static JsonObject Glamourer(int ix)
    {
        var o = new JsonObject();
        try
        {
            var st = Plugin.Pi.GetIpcSubscriber<int, uint, (int, JObject?)>("Glamourer.GetState").InvokeFunc(ix, 0);
            if (st.Item2?["Equipment"] is not JObject eq) { o["state"] = "none (" + st.Item1 + ")"; return o; }
            var sheet = Plugin.Data.GetExcelSheet<Item>();
            var items = new JsonObject();
            foreach (var slot in Slots)
            {
                var id = eq[slot]?["ItemId"]?.Value<ulong>() ?? 0;
                string? name = id is > 0 and < uint.MaxValue ? sheet.GetRowOrDefault((uint)id)?.Name.ExtractText() : null;
                items[slot] = string.IsNullOrEmpty(name) ? null : name; // item names only, never design names
            }
            o["items"] = items;
        }
        catch { o["state"] = "IPC unavailable"; }
        return o;
    }

    private static JsonObject CPlus(int ix)
    {
        try { var r = Plugin.Pi.GetIpcSubscriber<ushort, (int, Guid?)>("CustomizePlus.Profile.GetActiveProfileIdOnCharacter").InvokeFunc((ushort)ix); return new JsonObject { ["active"] = r.Item1 == 0 && r.Item2 != null }; }
        catch { return new JsonObject { ["active"] = null, ["state"] = "IPC unavailable" }; }
    }
}
