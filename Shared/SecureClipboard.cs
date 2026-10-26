// AI generated code.
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace VierLinkRemote.Shared;

/// <summary>Clipboard writes that opt out of Windows clipboard history and cloud sync, with optional auto-clear.</summary>
public static class SecureClipboard
{
    private const uint CF_UNICODETEXT = 13, GMEM_MOVEABLE = 2;
    [DllImport("user32.dll", SetLastError = true)] private static extern bool OpenClipboard(nint h);
    [DllImport("user32.dll")] private static extern bool CloseClipboard();
    [DllImport("user32.dll")] private static extern bool EmptyClipboard();
    [DllImport("user32.dll")] private static extern nint SetClipboardData(uint fmt, nint h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll")] private static extern uint GetClipboardSequenceNumber();
    [DllImport("kernel32.dll")] private static extern nint GlobalAlloc(uint flags, nuint size);
    [DllImport("kernel32.dll")] private static extern nint GlobalLock(nint h);
    [DllImport("kernel32.dll")] private static extern bool GlobalUnlock(nint h);
    [DllImport("kernel32.dll")] private static extern nint GlobalFree(nint h);

    private static uint ourSeq; private static DateTime clearAt = DateTime.MaxValue;

    private static nint Alloc(byte[] b)
    {
        var h = GlobalAlloc(GMEM_MOVEABLE, (nuint)b.Length); if (h == 0) return 0;
        var p = GlobalLock(h); Marshal.Copy(b, 0, p, b.Length); GlobalUnlock(h); return h;
    }

    private static bool Open() { for (var i = 0; i < 10; i++) { if (OpenClipboard(0)) return true; System.Threading.Thread.Sleep(10); } return false; }

    /// <summary>Sets text excluded from history/cloud. clearAfterSeconds &gt; 0 clears it later if still ours.</summary>
    public static bool Set(string text, int clearAfterSeconds = 0)
    {
        if (!Open()) return false;
        try
        {
            EmptyClipboard();
            var h = Alloc(Encoding.Unicode.GetBytes(text + "\0"));
            if (h == 0 || SetClipboardData(CF_UNICODETEXT, h) == 0) { if (h != 0) GlobalFree(h); return false; }
            var zero = BitConverter.GetBytes(0u);
            foreach (var f in new[] { "CanIncludeInClipboardHistory", "CanUploadToCloudClipboard" })
            { var hz = Alloc(zero); if (hz != 0 && SetClipboardData(RegisterClipboardFormat(f), hz) == 0) GlobalFree(hz); }
            var hx = Alloc(zero); if (hx != 0 && SetClipboardData(RegisterClipboardFormat("ExcludeClipboardContentFromMonitorProcessing"), hx) == 0) GlobalFree(hx);
        }
        finally { CloseClipboard(); }
        ourSeq = GetClipboardSequenceNumber();
        clearAt = clearAfterSeconds > 0 ? DateTime.UtcNow.AddSeconds(clearAfterSeconds) : DateTime.MaxValue;
        return true;
    }

    public static void ClearIfOurs() { if (clearAt != DateTime.MaxValue && GetClipboardSequenceNumber() == ourSeq) Clear(); }

    public static void Clear() { if (Open()) { try { EmptyClipboard(); } finally { CloseClipboard(); } } clearAt = DateTime.MaxValue; }

    /// <summary>Call every frame/tick: clears our text when its timer runs out, unless something else was copied since.</summary>
    public static void Tick()
    {
        if (DateTime.UtcNow < clearAt) return;
        clearAt = DateTime.MaxValue;
        if (GetClipboardSequenceNumber() == ourSeq) Clear();
    }
}
