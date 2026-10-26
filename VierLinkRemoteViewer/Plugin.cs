// AI generated code.
using System;
using Dalamud.Game.Command;
using Dalamud.Interface.Windowing;
using Dalamud.IoC;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;

namespace VierLinkRemoteViewer;

public sealed class Plugin : IDalamudPlugin
{
    [PluginService] internal static IDalamudPluginInterface Pi { get; private set; } = null!;
    [PluginService] internal static IObjectTable Objects { get; private set; } = null!;
    [PluginService] internal static IFramework Framework { get; private set; } = null!;
    [PluginService] internal static ICommandManager Commands { get; private set; } = null!;
    [PluginService] internal static IClientState Client { get; private set; } = null!;

    private readonly WindowSystem ws = new("VierLinkRemoteViewer");
    internal static ViewerWindow Win = null!;

    public Plugin()
    {
        Win = new ViewerWindow(); ws.AddWindow(Win);
        Pi.UiBuilder.Draw += ws.Draw;
        Pi.UiBuilder.OpenMainUi += () => Win.IsOpen = true;
        Pi.UiBuilder.OpenConfigUi += () => Win.IsOpen = true;
        Commands.AddHandler("/vlrview", new CommandInfo((_, _) => Win.Toggle()) { HelpMessage = "Open the VierLink Remote viewer." });
        Framework.Update += OnUpdate;
        Client.Logout += OnLogout;
    }

    private void OnLogout(int type, int code) => Win.EndAll("logged out");

    private void OnUpdate(IFramework _) { VierLinkRemote.Shared.SecureClipboard.Tick(); try { Win.Tick(); } catch { } }

    public void Dispose()
    {
        Framework.Update -= OnUpdate;
        Client.Logout -= OnLogout;
        Win.EndAll("plugin unloaded");
        Commands.RemoveHandler("/vlrview");
        Pi.UiBuilder.Draw -= ws.Draw;
        ws.RemoveAllWindows();
    }
}
