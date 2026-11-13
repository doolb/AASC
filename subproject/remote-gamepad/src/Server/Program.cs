using System.Net;
using Nefarius.ViGEm.Client;

if (!OperatingSystem.IsWindows()) { Console.Error.WriteLine("需要 Windows 和 ViGEmBus。"); return 1; }
if (args.Length > 2 || (args.Length > 0 && !IPAddress.TryParse(args[0], out _)) ||
    (args.Length > 1 && (!int.TryParse(args[1], out var p) || p is < 1 or > 65535)))
{
    Console.Error.WriteLine("用法: Server [监听IP，默认127.0.0.1] [控制端口，默认26760]"); return 1;
}
var address = args.Length > 0 ? IPAddress.Parse(args[0]) : IPAddress.Loopback;
var port = args.Length > 1 ? int.Parse(args[1]) : 26760;
using var stop = new CancellationTokenSource();
Console.CancelKeyPress += (_, e) => { e.Cancel = true; stop.Cancel(); };
try
{
    using var vigem = new ViGEmClient();
    var audioTask = port < 65535 ? AudioServer.RunAsync(address, port + 1, stop.Token) : Task.CompletedTask;
    var aggregateTask = port < 65534 ? AggregateServer.RunAsync(address, port + 2, port, stop.Token) : Task.CompletedTask;
    if (port == 65535) Console.WriteLine("端口过大，音频不可用。");
    if (port >= 65534) Console.WriteLine("端口过大，聚合端口不可用。");
    try { await ControlServer.RunAsync(address, port, vigem, stop.Token); }
    finally { stop.Cancel(); await Task.WhenAll(audioTask, aggregateTask); }
}
catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
catch (Exception ex) { Console.Error.WriteLine($"服务端错误: {ex.Message}。请确认 ViGEmBus 已安装且端口可用。"); return 1; }
return 0;
