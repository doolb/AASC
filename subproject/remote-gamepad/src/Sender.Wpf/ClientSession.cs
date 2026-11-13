namespace RemoteGamepad.Wpf;

internal sealed class ClientSession
{
    private readonly CancellationTokenSource stop = new();
    private readonly SenderSettings settings;
    private readonly string host;
    private readonly object persistGate = new();
    private readonly AggregateClient? proxy;
    private Task? running;
    public KeyboardRouter Router { get; }
    public TelemetryState Telemetry { get; } = new();
    public PowerClient Power { get; }
    public int Port { get; }
    public uint Slot { get; }
    public bool Aggregate { get; }
    private readonly string connectHost;
    private readonly int controlPort, keyboardPort;

    public ClientSession(SenderSettings settings, string host, int port, uint slot, bool aggregate, bool relative, string? mac)
    {
        this.settings = settings; this.host = host; Port = port; Slot = slot; Aggregate = aggregate;
        settings.RememberHost(host);
        var saved = settings.Get(host);
        if (saved.RelativeMouse != relative) settings.Update(host, value => value with { RelativeMouse = relative });
        Router = new KeyboardRouter(relative, saved.InputEnabled);
        Router.PreferencesChanged += SaveInputSettings;
        proxy = aggregate ? new AggregateClient(host, port) : null;
        connectHost = aggregate ? "127.0.0.1" : host;
        controlPort = proxy?.GamepadPort ?? port;
        keyboardPort = proxy?.KeyboardPort ?? port;
        Power = new PowerClient(host, connectHost, keyboardPort, settings);
        try { if (!string.IsNullOrWhiteSpace(mac)) Power.SetMac(mac); }
        catch { proxy?.Dispose(); throw; }
    }
    private void SaveInputSettings()
    {
        lock (persistGate)
        {
            var value = Router.Preferences;
            try { settings.Update(host, old => old with { RelativeMouse = value.relativeMouse, InputEnabled = value.inputEnabled }); }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
            { SenderLog.WriteLine($"保存键鼠设置失败: {ex.Message}"); }
        }
    }
    public void Start() => running = Task.Run(RunAsync);
    private async Task RunAsync()
    {
        var token = stop.Token;
        var wake = Task.Run(async () =>
        {
            try
            {
                Power.LearnMac();
                if (Power.MacText != "未设置") await Power.WakeAsync();
                else SenderLog.WriteLine("自动唤醒需要服务端 MAC，可在界面设置。");
            }
            catch (Exception ex) { SenderLog.WriteLine($"自动唤醒失败: {ex.Message}"); }
        });
        var aggregateTask = proxy?.RunAsync(token) ?? Task.CompletedTask;
        var powerTask = Power.RunAutoAsync(token);
        var audioTask = proxy != null || Port < 65535 ? AudioClient.RunAsync(connectHost, proxy?.AudioPort ?? Port + 1, token) : Task.CompletedTask;
        var keyboardTask = KeyboardClient.RunAsync(connectHost, keyboardPort, Router, token);
        var metricsTask = TelemetryClient.RunAsync(connectHost, proxy?.MetricsPort ?? Port, Telemetry, token);
        try { await GamepadClient.RunAsync(connectHost, controlPort, host, Port, Slot, proxy, token); }
        finally
        {
            stop.Cancel();
            try { await Task.WhenAll(audioTask, keyboardTask, metricsTask, aggregateTask, powerTask, wake); }
            catch (OperationCanceledException) { }
            finally { proxy?.Dispose(); SaveInputSettings(); }
        }
    }
    public async Task StopAsync()
    {
        stop.Cancel();
        if (running != null) await running;
        else { proxy?.Dispose(); SaveInputSettings(); }
        stop.Dispose();
    }
}
