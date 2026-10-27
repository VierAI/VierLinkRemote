// AI generated code.
using System;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Org.BouncyCastle.Crypto.Agreement;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Crypto.Signers;
using Org.BouncyCastle.Security;

namespace VierLinkRemote.Shared;

/// <summary>Values pinned at build time. Only public keys live here.</summary>
public static class Pinned
{
    // Placeholder until a neutral hostname is chosen; connecting is refused while it ends in ".invalid".
    public const string RelayHost = "relay.lafxrfz8x1.workers.dev";
    public const string XPub = "0BSjtgkq7MLcNveyw60nMOpcGrJXj4GJ-RWPcDKx3D8";
    public const string EdPub = "IoYptqyr-rn4SptqhjHxcDIAnxexZFpsa5zG4av3jiM";
    /// <summary>First 16 bytes of SHA-256(XPub || EdPub), hex.</summary>
    public const string Fingerprint = "3fc91495a6dfaa226937138c7cc2a4e0";
    public const int Protocol = 1;
    /// <summary>Bump when the shared fields change; testers must consent again.</summary>
    public const int Scope = 2; // v2: sessions are viewed by an automated assistant
    public const int TokenTtlSeconds = 3600;
    public static bool HostConfigured => !RelayHost.EndsWith(".invalid", StringComparison.Ordinal);
    public static string RelayBase => "wss://" + RelayHost + "/s/";

    public static bool FingerprintMatches()
    {
        var x = B64.Dec(XPub); var e = B64.Dec(EdPub);
        var all = new byte[64]; x.CopyTo(all, 0); e.CopyTo(all, 32);
        return Convert.ToHexString(SHA256.HashData(all)).ToLowerInvariant()[..32] == Fingerprint;
    }
}

public static class B64
{
    public static string Enc(ReadOnlySpan<byte> b) => Convert.ToBase64String(b).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    public static byte[] Dec(string s)
    {
        s = s.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(s + new string('=', (4 - s.Length % 4) % 4));
    }
}

/// <summary>Signed session token body. k is the throwaway per-session secret and is never sent to the relay.</summary>
public sealed class TokenBody
{
    public int v { get; set; } = Pinned.Protocol;
    public int scope { get; set; } = Pinned.Scope;
    public string sid { get; set; } = "";
    public string url { get; set; } = "";
    public string k { get; set; } = "";
    public long exp { get; set; }
    /// <summary>HMAC (session self key) of the receiver's lower-cased "name@world"; empty if unknown.</summary>
    public string self { get; set; } = "";
}

public static class Crypto
{
    private static readonly SecureRandom Rng = new();
    public static byte[] Random(int n) { var b = new byte[n]; RandomNumberGenerator.Fill(b); return b; }

    public static byte[] Hkdf(byte[] ikm, byte[] salt, string info, int len = 32)
        => HKDF.DeriveKey(HashAlgorithmName.SHA256, ikm, len, salt, Encoding.UTF8.GetBytes(info));

    public static byte[] AuthKey(byte[] k, byte[] sid) => Hkdf(k, sid, "vlr1 tester-auth");
    public static byte[] HashKey(byte[] k, byte[] sid) => Hkdf(k, sid, "vlr1 hash");
    public static byte[] SelfKey(byte[] k, byte[] sid) => Hkdf(k, sid, "vlr1 self");

    /// <summary>Per-session keyed hash, 12 bytes base64url. Never stable across sessions.</summary>
    public static string H(byte[] key, string kind, string value)
        => B64.Enc(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(kind + "\0" + value)).AsSpan(0, 12));

    public static byte[] XPublic(byte[] priv) => new X25519PrivateKeyParameters(priv, 0).GeneratePublicKey().GetEncoded();
    public static byte[] EdPublic(byte[] priv) => new Ed25519PrivateKeyParameters(priv, 0).GeneratePublicKey().GetEncoded();

    private static byte[] Agree(byte[] priv, byte[] pub)
    {
        var a = new X25519Agreement(); a.Init(new X25519PrivateKeyParameters(priv, 0));
        var s = new byte[32]; a.CalculateAgreement(new X25519PublicKeyParameters(pub, 0), s, 0); return s;
    }

    private static byte[] ContentKey(byte[] shared, byte[]? k, byte[] sid, byte[] epk, byte[] rpub)
    {
        var ikm = new byte[shared.Length + (k?.Length ?? 0)]; shared.CopyTo(ikm, 0); k?.CopyTo(ikm, shared.Length);
        var info = "vlr1 content" + B64.Enc(epk) + B64.Enc(rpub);
        var ck = Hkdf(ikm, sid, info); CryptographicOperations.ZeroMemory(ikm); return ck;
    }

    private static byte[] Aad(byte[] sid, ulong seq) { var a = new byte[4 + sid.Length + 8]; Encoding.ASCII.GetBytes("vlr1").CopyTo(a, 0); sid.CopyTo(a, 4); BitConverter.TryWriteBytes(a.AsSpan(4 + sid.Length), seq); return a; }

    /// <summary>ECIES to the pinned receiver key: ephemeral X25519 + HKDF(shared||k) + AES-256-GCM.
    /// Layout: 0x01 | epk(32) | nonce(12) | seq(8) | tag(16) | ct.</summary>
    public static byte[] Seal(byte[] plain, byte[] rpub, byte[]? k, byte[] sid, ulong seq)
    {
        var epriv = new X25519PrivateKeyParameters(Rng);
        var epk = epriv.GeneratePublicKey().GetEncoded();
        var a = new X25519Agreement(); a.Init(epriv); var shared = new byte[32]; a.CalculateAgreement(new X25519PublicKeyParameters(rpub, 0), shared, 0);
        var ck = ContentKey(shared, k, sid, epk, rpub); CryptographicOperations.ZeroMemory(shared);
        var nonce = Random(12); var tag = new byte[16]; var ct = new byte[plain.Length];
        using (var g = new AesGcm(ck, 16)) g.Encrypt(nonce, plain, ct, tag, Aad(sid, seq));
        CryptographicOperations.ZeroMemory(ck);
        var o = new byte[1 + 32 + 12 + 8 + 16 + ct.Length]; o[0] = 1;
        epk.CopyTo(o, 1); nonce.CopyTo(o, 33); BitConverter.TryWriteBytes(o.AsSpan(45), seq); tag.CopyTo(o, 53); ct.CopyTo(o, 69);
        return o;
    }

    public static byte[] Open(byte[] blob, byte[] xpriv, byte[]? k, byte[] sid, out ulong seq)
    {
        if (blob.Length < 69 || blob[0] != 1) throw new CryptographicException("bad blob");
        var epk = blob[1..33]; var nonce = blob[33..45]; seq = BitConverter.ToUInt64(blob, 45); var tag = blob[53..69]; var ct = blob[69..];
        var shared = Agree(xpriv, epk);
        var ck = ContentKey(shared, k, sid, epk, XPublic(xpriv)); CryptographicOperations.ZeroMemory(shared);
        var pt = new byte[ct.Length];
        try { using var g = new AesGcm(ck, 16); g.Decrypt(nonce, ct, tag, pt, Aad(sid, seq)); }
        finally { CryptographicOperations.ZeroMemory(ck); }
        return pt;
    }

    public static byte[] Sign(byte[] edPriv, string msg)
    {
        var s = new Ed25519Signer(); s.Init(true, new Ed25519PrivateKeyParameters(edPriv, 0));
        var m = Encoding.UTF8.GetBytes(msg); s.BlockUpdate(m, 0, m.Length); return s.GenerateSignature();
    }

    public static bool Verify(byte[] edPub, string msg, byte[] sig)
    {
        var s = new Ed25519Signer(); s.Init(false, new Ed25519PublicKeyParameters(edPub, 0));
        var m = Encoding.UTF8.GetBytes(msg); s.BlockUpdate(m, 0, m.Length); return s.VerifySignature(sig);
    }

    public static string MakeToken(TokenBody body, byte[] edPriv)
    {
        var head = "vlr1." + B64.Enc(JsonSerializer.SerializeToUtf8Bytes(body));
        return head + "." + B64.Enc(Sign(edPriv, head));
    }

    /// <summary>Verifies against the pinned public key, the pinned relay, protocol and expiry. Throws with a user-facing reason.</summary>
    public static TokenBody ReadToken(string token)
    {
        token = token.Trim();
        var parts = token.Split('.');
        if (parts.Length != 3 || parts[0] != "vlr1") throw new FormatException("not a session token");
        if (!Verify(B64.Dec(Pinned.EdPub), parts[0] + "." + parts[1], B64.Dec(parts[2]))) throw new FormatException("signature does not match the pinned key");
        var b = JsonSerializer.Deserialize<TokenBody>(B64.Dec(parts[1])) ?? throw new FormatException("empty token");
        if (b.v != Pinned.Protocol) throw new FormatException("protocol version mismatch");
        if (b.scope != Pinned.Scope) throw new FormatException("scope version mismatch; update the plugin and consent again");
        if (b.url != Pinned.RelayBase) throw new FormatException("token points at a different relay");
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (b.exp <= now) throw new FormatException("token expired");
        if (b.exp > now + Pinned.TokenTtlSeconds + 120) throw new FormatException("token lifetime too long");
        if (B64.Dec(b.sid).Length != 16 || B64.Dec(b.k).Length != 32) throw new FormatException("malformed token");
        return b;
    }

    /// <summary>Clipboard export: vlrx1.&lt;sid&gt;.&lt;unix ts&gt;.&lt;blob&gt;. The timestamp is the GCM sequence/AAD, so it cannot be altered.
    /// Note: anyone holding the public key can still create an export; exports are not proof of origin.</summary>
    public static string SealExport(string json)
    {
        var sid = Random(16); var ts = (ulong)DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        return "vlrx1." + B64.Enc(sid) + "." + ts + "." + B64.Enc(Seal(Encoding.UTF8.GetBytes(json), B64.Dec(Pinned.XPub), null, sid, ts));
    }

    public static string OpenExport(string text, byte[] xpriv, out DateTimeOffset at)
    {
        var p = text.Trim().Split('.');
        if (p.Length != 4 || p[0] != "vlrx1" || !ulong.TryParse(p[2], out var ts)) throw new FormatException("not an export");
        var pt = Open(B64.Dec(p[3]), xpriv, null, B64.Dec(p[1]), out var seq);
        if (seq != ts) throw new CryptographicException("timestamp mismatch");
        at = DateTimeOffset.FromUnixTimeSeconds((long)ts);
        return Encoding.UTF8.GetString(pt);
    }

    public static string CreateProofMessage(string sid, long exp, string auth, long ts) => $"vlr1-create|{sid}|{exp}|{auth}|{ts}";
    public static string JoinMac(byte[] authKey, string sid, long ts, string n)
        => B64.Enc(HMACSHA256.HashData(authKey, Encoding.UTF8.GetBytes($"vlr1-join|{sid}|{ts}|{n}")));
}
