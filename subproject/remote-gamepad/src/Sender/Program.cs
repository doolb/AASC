using System.Net.Sockets;
using System.Runtime.InteropServices;
using RemoteGamepad;

if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("发送端需要 Windows XInput。"); return 1; }
if (!PowerArguments.TryExtract(args, out var remainingArgs, out var macArgument, out var argumentError))
{ Console.Error.WriteLine(argumentError); return 1; }
args = remainingArgs;
bool aggregate = args.Contains("--aggregate");
args = args.Where(a => a != "--aggregate").ToArray();
var modeFlags = args.Where(a => a is "--relative" or "--absolute").ToArray();
if (modeFlags.Length > 1)
{
    Console.Error.WriteLine("鼠标模式只能指定一次：--relative 或 --absolute。"); return 1;
}
args = args.Where(a => a is not ("--relative" or "--absolute")).ToArray();
SenderSettings settings;
try { settings = new SenderSettings(); }
catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
{ Console.Error.WriteLine($"无法读取或迁移控制端设置: {ex.Message}"); return 1; }
bool usingLastHost = args.Length == 0 && !string.IsNullOrWhiteSpace(settings.LastHost);
args = PowerArguments.UseLastHost(args, settings.LastHost);
if (usingLastHost) SenderLog.WriteLine($"使用上次的服务端地址: {args[0]}");
if (args.Length == 0 && !Console.IsInputRedirected)
{
    Console.Write("服务端 IP 或主机名: ");
    string? entered = Console.ReadLine()?.Trim();
    if (!string.IsNullOrWhiteSpace(entered)) args = new[] { entered };
}
if (args.Length is < 1 or > 3 || (args.Length > 1 && (!int.TryParse(args[1], out var p) || p is < 1 or > 65535)) ||
    (args.Length > 2 && (!uint.TryParse(args[2], out var i) || i > 3)))
{
    Console.Error.WriteLine("用法: Sender <服务端IP或主机名> [端口] [XInput编号0-3] [--absolute|--relative] [--aggregate] [--mac MAC地址]");
    Console.Error.WriteLine("普通模式端口默认 26760；聚合模式端口默认 26762。"); return 1;
}
var host = args[0];
var port = args.Length > 1 ? int.Parse(args[1]) : aggregate ? 26762 : 26760;
var index = args.Length > 2 ? uint.Parse(args[2]) : 0;
try { settings.RememberHost(host); }
catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
{ Console.Error.WriteLine($"无法保存服务端地址: {ex.Message}"); return 1; }
var initial = settings.Get(host);
bool relativeMouse = modeFlags.Length == 1 ? modeFlags[0] == "--relative" : initial.RelativeMouse;
if (modeFlags.Length == 1 && relativeMouse != initial.RelativeMouse)
{
    try { settings.Update(host, value => value with { RelativeMouse = relativeMouse }); }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
    { Console.Error.WriteLine($"无法保存鼠标模式: {ex.Message}"); return 1; }
}
using var stop = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
var router = new KeyboardRouter(relativeMouse, initial.InputEnabled);
var persistGate = new object();
void SaveInputSettings()
{
    lock (persistGate)
    {
        var preferences = router.Preferences;
        try { settings.Update(host, value => value with { RelativeMouse = preferences.relativeMouse, InputEnabled = preferences.inputEnabled }); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        { SenderLog.WriteLine($"保存键鼠设置失败: {ex.Message}"); }
    }
}
router.PreferencesChanged += SaveInputSettings;
var telemetry = new TelemetryState();
using var proxy = aggregate ? new AggregateClient(host, port) : null;
string connectHost = aggregate ? "127.0.0.1" : host;
int controlPort = proxy?.GamepadPort ?? port;
int keyboardPort = proxy?.KeyboardPort ?? port;
var power = new PowerClient(host, connectHost, keyboardPort, settings);
if (macArgument != null)
{
    try { power.SetMac(macArgument); }
    catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.Text.Json.JsonException or ArgumentException)
    { Console.Error.WriteLine($"无法保存 MAC 地址: {ex.Message}"); return 1; }
}
using var dashboard = TerminalDashboard.TryStart(host, port, index, router, telemetry, power, aggregate, stop);
_ = Task.Run(async () =>
{
    try
    {
        power.LearnMac();
        if (power.MacText != "未设置") await power.WakeAsync();
        else SenderLog.WriteLine("自动唤醒需要服务端 MAC，可在界面设置。");
    }
    catch (Exception ex) { SenderLog.WriteLine($"自动唤醒失败: {ex.Message}"); }
});
var proxyTask = proxy?.RunAsync(stop.Token) ?? Task.CompletedTask;
var powerTask = power.RunAutoAsync(stop.Token);
var audioTask = proxy != null || port < 65535 ? AudioClient.RunAsync(connectHost, proxy?.AudioPort ?? port + 1, stop.Token) : Task.CompletedTask;
var keyboardTask = KeyboardClient.RunAsync(connectHost, keyboardPort, router, stop.Token);
var metricsTask = TelemetryClient.RunAsync(connectHost, proxy?.MetricsPort ?? port, telemetry, stop.Token);
if (!aggregate && port == 65535) SenderLog.WriteLine("端口 65535 无法分配音频端口，音频已禁用。");
await GamepadClient.RunAsync(connectHost, controlPort, host, port, index, proxy, stop.Token);
stop.Cancel();
await Task.WhenAll(audioTask, keyboardTask, metricsTask, proxyTask, powerTask);
SaveInputSettings();
return 0;
