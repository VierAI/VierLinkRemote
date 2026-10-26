// AI generated code.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace VierLinkRemote.Shared;

/// <summary>A viewer's capture request: a subset of the existing snapshot fields. It can never add fields or turn on reveal.
/// Wire form: {"t":"refresh","req":{"id":"...","players":["P12","receiver"],"sections":["sync","penumbra"]}}.</summary>
public sealed class CaptureRequest
{
    public static readonly string[] AllSections = { "sync", "penumbra", "glamourer", "customizePlus", "distance" };
    public const int MaxPlayers = 20;
    public const int MaxRaw = 400;
    private static readonly Regex IdRx = new("^[A-Za-z0-9_-]{1,32}$", RegexOptions.CultureInvariant);
    private static readonly Regex LabelRx = new("^(P[0-9]{1,4}|receiver)$", RegexOptions.CultureInvariant);

    public string Id = "";
    /// <summary>Null = every player the snapshot would include anyway.</summary>
    public HashSet<string>? Players;
    /// <summary>Never empty after parsing; defaults to all sections.</summary>
    public HashSet<string> Sections = new(AllSections, StringComparer.Ordinal);

    public bool Wants(string section) => Sections.Contains(section);

    /// <summary>Strict: unknown keys, wrong types, duplicates, bad ids/labels/sections or oversize input are all refused.</summary>
    public static CaptureRequest Parse(JsonElement req)
    {
        if (req.ValueKind != JsonValueKind.Object) throw new FormatException("request must be an object");
        if (req.GetRawText().Length > MaxRaw) throw new FormatException("request too large");
        var r = new CaptureRequest(); var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in req.EnumerateObject())
        {
            if (!seen.Add(p.Name)) throw new FormatException("duplicate key");
            switch (p.Name)
            {
                case "id":
                    if (p.Value.ValueKind != JsonValueKind.String || !IdRx.IsMatch(p.Value.GetString()!)) throw new FormatException("bad id");
                    r.Id = p.Value.GetString()!; break;
                case "players":
                    r.Players = Set(p.Value, MaxPlayers, s => LabelRx.IsMatch(s), "players"); break;
                case "sections":
                    r.Sections = Set(p.Value, AllSections.Length, s => AllSections.Contains(s), "sections");
                    if (r.Sections.Count == 0) throw new FormatException("sections must not be empty"); break;
                default: throw new FormatException("unknown key");
            }
        }
        if (r.Id.Length == 0) throw new FormatException("missing id");
        return r;
    }

    private static HashSet<string> Set(JsonElement a, int max, Func<string, bool> ok, string what)
    {
        if (a.ValueKind != JsonValueKind.Array || a.GetArrayLength() > max) throw new FormatException("bad " + what);
        var s = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in a.EnumerateArray())
        {
            if (e.ValueKind != JsonValueKind.String || !ok(e.GetString()!) || !s.Add(e.GetString()!)) throw new FormatException("bad " + what);
        }
        return s;
    }
}