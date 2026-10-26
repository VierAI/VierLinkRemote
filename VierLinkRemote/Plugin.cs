// AI generated code.
using System;
using Dalamud.Configuration;
using Dalamud.Game.Command;
using Dalamud.Interface.Windowing;
using Dalamud.IoC;
using Dalamud.Plugin;
using Dalamud.Plugin.Services;

namespace VierLinkRemote;

[Serializable]
public sealed class Config : IPluginConfiguration
{
    public int Version { get; set; } = 1;
    /// <summary>Off until the tester turns it on after reading the disclaimer.</summary>
    public bool Enabled { get; set; } = false;
    /// <summary>Scope version the tester last agreed to; a newer Pinned.Scope forces consent again.</summary>
    public int ConsentedScope { get; set; } = 0;
}

public sealed class Plugin : IDalamudPlugin
{
    [PluginService] internal static IDalamudPluginInterface Pi { get; private set; } = null!;
    [PluginService] internal static IPluginLog Log { get; private set; } = null!;
    [PluginService] internal static IObjectTable Objects { get; private set; } = null!;
    [PluginService] internal static IFramework Framework { get; private set; } = null!;
    [PluginService] internal static IDataManager Data { get; private set; } = null!;
    [PluginService] internal static ICommandManager Commands { get; private set; } = null!;

    internal static Config Cfg = new();
    internal static Session? Current;
    private readonly WindowSystem ws = new("VierLinkRemote");
    internal static MainWindow Main = null!;
    internal static SessionWindow SessionWin = null!;

    public Plugin()
    {
        Cfg = Pi.GetPluginConfig() as Config ?? new Config();
        Main = new MainWindow(); SessionWin = new SessionWindow();
        ws.AddWindow(Main); ws.AddWindow(SessionWin);
        Pi.UiBuilder.Draw += ws.Draw;
        Pi.UiBuilder.OpenMainUi += () => Main.IsOpen = true;
        Pi.UiBuilder.OpenConfigUi += () => Main.IsOpen = true;
        Commands.AddHandler("/vlremote", new CommandInfo((_, _) => Main.Toggle()) { HelpMessage = "Open VierLink Remote (disclaimer, export, sessions)." });
        Framework.Update += OnUpdate;
    }

    internal static bool Allowed => Cfg.Enabled && Cfg.ConsentedScope == Shared.Pinned.Scope;
    internal static void Save() => Pi.SavePluginConfig(Cfg);

    private void OnUpdate(IFramework _)
    {
        try { Current?.Tick(); } catch (Exception e) { Current?.Note("error: " + e.GetType().Name); }
        if (Current != null && !Allowed) Current.End("plugin disabled");
    }

    public void Dispose()
    {
        Framework.Update -= OnUpdate;
        Current?.End("plugin unloaded");
        Commands.RemoveHandler("/vlremote");
        Pi.UiBuilder.Draw -= ws.Draw;
        ws.RemoveAllWindows();
    }
}
