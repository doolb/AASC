using System.Net;
using System.Net.Sockets;
using System.Threading.Channels;
using RemoteGamepad;

var originalConsoleOut = Console.Out;
var capturedLog = new List<string>();
Action<string> sink = capturedLog.Add;
SenderLog.Use(sink);
SenderLog.WriteLine("test application event");
if (!ReferenceEquals(Console.Out, originalConsoleOut) || capturedLog.Count != 1 || capturedLog[0] != "test application event") throw new Exception("application log routing must not replace the terminal output writer");
SenderLog.Clear(sink);
Console.WriteLine("PASS: application logging leaves terminal output untouched");
if (!PowerClient.TryParseMac("30-9c-23-6d-0d-be", out var mac) || PowerClient.TryParseMac("FF-FF-FF-FF-FF-FF", out _) || PowerClient.TryParseMac("00-00-00-00-00-00", out _)) throw new Exception("MAC validation");
var magic = PowerClient.MagicPacket(mac);
if (magic.Length != 102 || magic.Take(6).Any(b => b != 255) || Enumerable.Range(0, 16).Any(i => !magic.AsSpan(6 + i * 6, 6).SequenceEqual(mac))) throw new Exception("WOL magic packet");
Console.WriteLine("PASS: WOL address validation and magic packet");
if (!PowerArguments.TryExtract(new[] { "192.168.1.101", "--mac", "30:9c:23:6d:0d:be", "--aggregate" }, out var rest, out var address, out _) ||
    address != "30-9C-23-6D-0D-BE" || !rest.SequenceEqual(new[] { "192.168.1.101", "--aggregate" }) ||
    !PowerArguments.TryExtract(new[] { "--mac=309c236d0dbe", "127.0.0.1" }, out _, out _, out _) ||
    PowerArguments.TryExtract(new[] { "--mac" }, out _, out _, out _) ||
    PowerArguments.TryExtract(new[] { "--mac", "invalid" }, out _, out _, out _) ||
    PowerArguments.TryExtract(new[] { "--mac", "309c236d0dbe", "--mac", "309c236d0dbe" }, out _, out _, out _)) throw new Exception("MAC command-line parsing");
Console.WriteLine("PASS: --mac parsing and invalid arguments");
string testRoot = Path.Combine(Path.GetTempPath(), "remote-gamepad-settings-" + Guid.NewGuid().ToString("N"));
string newSettings = Path.Combine(testRoot, "current"), oldSettings = Path.Combine(testRoot, "old");
Directory.CreateDirectory(newSettings); Directory.CreateDirectory(oldSettings);
File.WriteAllText(Path.Combine(oldSettings, "wol.json"), "{\"test-target\":\"30-9C-23-6D-0D-BE\"}");
File.WriteAllText(Path.Combine(oldSettings, "auto-power.json"), "{\"test-target\":true}");
File.WriteAllText(Path.Combine(newSettings, "wol.json"), "{\"test-target\":\"02-00-00-00-00-02\"}");
var store = new SenderSettings(newSettings, oldSettings);
if (store.LastHost != "test-target" || PowerArguments.UseLastHost(Array.Empty<string>(), store.LastHost).Single() != "test-target" ||
    PowerArguments.UseLastHost(new[] { "192.168.1.101" }, store.LastHost).Single() != "192.168.1.101" ||
    PowerArguments.UseLastHost(Array.Empty<string>(), null).Length != 0) throw new Exception("remembered target selection");
var migrated = new PowerClient("test-target", "127.0.0.1", 1, store);
if (migrated.MacText != "02-00-00-00-00-02" || !migrated.AutoEnabled ||
    !File.Exists(Path.Combine(newSettings, "settings.json"))) throw new Exception("settings migration");
migrated.SetMac("02-00-00-00-00-01"); migrated.SetAutoEnabled(false);
store.Update("test-target", value => value with { RelativeMouse = true, InputEnabled = true });
store.RememberHost("192.168.1.101");
var restoredStore = new SenderSettings(newSettings, oldSettings);
if (restoredStore.LastHost != "192.168.1.101") throw new Exception("last host must persist");
var reread = new PowerClient("test-target", "127.0.0.1", 1, restoredStore);
if (reread.MacText != "02-00-00-00-00-01" || reread.AutoEnabled || !File.ReadAllText(Path.Combine(oldSettings, "auto-power.json")).Contains("true")) throw new Exception("settings must prefer new location and preserve old files");
var prefs = restoredStore.Get("test-target");
if (!prefs.RelativeMouse || !prefs.InputEnabled) throw new Exception("mouse and input settings must persist");
if (restoredStore.Theme != "dark") throw new Exception("legacy configuration must default to dark theme");
restoredStore.SetTheme("light");
restoredStore.SetZoom(1.3);
var cliStore = new SenderSettings(newSettings, oldSettings);
if (cliStore.Theme != "light" || cliStore.Zoom != 1.3) throw new Exception("theme and zoom must be stored in the shared settings file");
cliStore.Update("test-target", value => value with { RelativeMouse = false });
var afterCliSave = new SenderSettings(newSettings, oldSettings);
if (afterCliSave.Theme != "light" || afterCliSave.Zoom != 1.3) throw new Exception("CLI settings updates must preserve theme and zoom");
var restoredRouter = new KeyboardRouter(prefs.RelativeMouse, prefs.InputEnabled);
var input = Channel.CreateUnbounded<KeyboardPacket>();
restoredRouter.Attach(input.Writer);
if (!restoredRouter.RelativeMouse || !restoredRouter.InputEnabled) throw new Exception("initial input settings not restored");
var preferenceChanged = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
restoredRouter.PreferencesChanged += () => preferenceChanged.TrySetResult(true);
if (!restoredRouter.Process(0xA2, 0x1D, 0, true) || !restoredRouter.Process(0x1B, 1, 0, true) || restoredRouter.Preferences.inputEnabled) throw new Exception("restored input must be switchable off and update its preference");
await preferenceChanged.Task.WaitAsync(TimeSpan.FromSeconds(2));
restoredRouter.Process(0x1B, 1, 0, false); restoredRouter.Process(0xA2, 0x1D, 0, false);
// Simulate another launch with the previously saved enabled state.
restoredRouter = new KeyboardRouter(prefs.RelativeMouse, prefs.InputEnabled);
restoredRouter.Attach(input.Writer);
restoredRouter.Detach(); restoredRouter.Attach(input.Writer);
if (restoredRouter.InputEnabled || !restoredRouter.Preferences.inputEnabled) throw new Exception("reconnect must pause forwarding without losing the saved preference");
restoredRouter.Detach();
Console.WriteLine("PASS: unified settings migration, mouse mode and initial input restoration");
string priorDirectory = Path.Combine(testRoot, "prior"); Directory.CreateDirectory(priorDirectory);
File.WriteAllText(Path.Combine(priorDirectory, "settings.json"), "{\"one\":{\"Mac\":\"02-00-00-00-00-01\",\"InputEnabled\":true},\"two\":{\"AutoSleep\":true}}");
var prior = new SenderSettings(priorDirectory, oldSettings);
if (prior.LastHost != null || !prior.Get("one").InputEnabled || !prior.Get("two").AutoSleep) throw new Exception("older target settings were not preserved");
prior.RememberHost("one");
var upgraded = new SenderSettings(priorDirectory, oldSettings);
if (upgraded.LastHost != "one" || !upgraded.Get("one").InputEnabled || !upgraded.Get("two").AutoSleep) throw new Exception("last host upgrade must preserve all targets");
Console.WriteLine("PASS: last target, explicit override and legacy settings upgrade");

// Exercise the shared sender without a physical or virtual gamepad.
using (var padStop = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
{
    var padListener = new TcpListener(IPAddress.Loopback, 0); padListener.Start();
    var padPort = ((IPEndPoint)padListener.LocalEndpoint).Port;
    var device = new FakeGamepad();
    var padTask = GamepadClient.RunAsync("127.0.0.1", padPort, "127.0.0.1", padPort, 0, null, padStop.Token, device);
    using (var peer = await padListener.AcceptTcpClientAsync(padStop.Token))
    {
        var stream = peer.GetStream(); var greeting = new byte[4];
        await stream.ReadFrameExactlyAsync(greeting, padStop.Token);
        if (!greeting.AsSpan().SequenceEqual(Report.Magic)) throw new Exception("gamepad handshake");
        var payload = new byte[Report.Size]; await stream.ReadFrameExactlyAsync(payload, padStop.Token);
        if (Report.Read(payload).Buttons != 0x1000) throw new Exception("gamepad input report");
        await stream.WriteAsync(new byte[] { 12, 34 }, padStop.Token);
        await device.Received.Task.WaitAsync(padStop.Token);
        padStop.Cancel();
    }
    await padTask; padListener.Stop();
    if (!device.Stopped) throw new Exception("gamepad motors not reset after disconnect");
}
Console.WriteLine("PASS: shared gamepad reports, vibration and motor reset (fake device)");

// The target may be asleep at startup, then come online or drop the first
// connection while the operating system resumes. No real devices are used.
using (var retryStop = new CancellationTokenSource(TimeSpan.FromSeconds(15)))
{
    var retryListener = new TcpListener(IPAddress.Loopback, 0); retryListener.Start();
    int retryPort = ((IPEndPoint)retryListener.LocalEndpoint).Port; retryListener.Stop();
    var firstFailure = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
    Action<string> retryLog = line => { if (line.StartsWith("连接中断:")) firstFailure.TrySetResult(true); };
    SenderLog.Use(retryLog);
    var retryTask = GamepadClient.RunAsync("127.0.0.1", retryPort, "127.0.0.1", retryPort, 0, null, retryStop.Token, new FakeGamepad());
    await firstFailure.Task.WaitAsync(retryStop.Token);
    retryListener = new TcpListener(IPAddress.Loopback, retryPort); retryListener.Start();
    for (int i = 0; i < 2; i++)
    {
        using var peer = await retryListener.AcceptTcpClientAsync(retryStop.Token);
        var greeting = new byte[4];
        await peer.GetStream().ReadFrameExactlyAsync(greeting, retryStop.Token);
        if (!greeting.AsSpan().SequenceEqual(Report.Magic)) throw new Exception("reconnection handshake");
        peer.Close();
    }
    retryStop.Cancel(); await retryTask; retryListener.Stop(); SenderLog.Clear(retryLog);
}
Console.WriteLine("PASS: automatic connection after delayed startup and reconnection (fake server)");

using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
var listener = new TcpListener(IPAddress.Loopback, 0);
listener.Start();
int serverPort = ((IPEndPoint)listener.LocalEndpoint).Port;
int calls = 0;
async Task AcceptFake(byte result)
{
    using var peer = await listener.AcceptTcpClientAsync(timeout.Token);
    using var stream = peer.GetStream();
    var handshake = new byte[4]; await stream.ReadFrameExactlyAsync(handshake, timeout.Token);
    if (!handshake.AsSpan().SequenceEqual("VGW1"u8)) throw new Exception("power handshake");
    await PowerServer.HandleAsync(stream, timeout.Token, () => result, () => { Interlocked.Increment(ref calls); return 0; });
}
var client = new PowerClient("test-target", "127.0.0.1", serverPort, store);
var rejected = AcceptFake(3);
try { await client.SleepAsync(timeout.Token); throw new Exception("permission rejection was not returned"); }
catch (InvalidOperationException ex) when (ex.Message.Contains("权限")) { }
await rejected;
if (calls != 0) throw new Exception("sleep called after rejection");
var accepted = AcceptFake(1);
await client.SleepAsync(timeout.Token); await accepted;
if (calls != 1) throw new Exception("fake sleep was not invoked once");
Console.WriteLine("PASS: direct sleep request, acknowledgement and rejection (fake sleep)");

int autoCalls = 0;
using var coordinator = new AutoSleepCoordinator(timeout.Token, () => { Interlocked.Increment(ref autoCalls); return Task.CompletedTask; }, TimeSpan.FromMilliseconds(250));
async Task<(TcpClient client, Task task)> AutoSession()
{
    var open = new TcpClient(); await open.ConnectAsync(IPAddress.Loopback, serverPort, timeout.Token);
    var peer = await listener.AcceptTcpClientAsync(timeout.Token);
    var task = Task.Run(async () => { using (peer) await PowerServer.HandleAutoAsync(peer.GetStream(), timeout.Token, coordinator); });
    var ack = new byte[1]; await open.GetStream().ReadFrameExactlyAsync(ack, timeout.Token);
    if (ack[0] != 1) throw new Exception("auto policy ack");
    return (open, task);
}
var auto = await AutoSession();
await auto.client.GetStream().WriteAsync(new byte[] { 1, 0 }, timeout.Token);
var disarmAck = new byte[1]; await auto.client.GetStream().ReadFrameExactlyAsync(disarmAck, timeout.Token);
auto.client.Dispose(); await auto.task; await Task.Delay(350);
if (disarmAck[0] != 0 || autoCalls != 0) throw new Exception("disabling should prevent sleep");
auto = await AutoSession(); auto.client.Dispose(); await auto.task;
await Task.Delay(50);
var reconnected = await AutoSession(); await Task.Delay(300);
if (autoCalls != 0) throw new Exception("reconnect did not cancel countdown");
reconnected.client.Dispose(); await reconnected.task; await Task.Delay(350);
if (autoCalls != 1) throw new Exception("disconnect did not trigger sleep");
auto = await AutoSession(); auto.client.Dispose(); await auto.task; coordinator.CancelPending(); await Task.Delay(350);
if (autoCalls != 1) throw new Exception("explicit cancellation did not stop countdown");
using (var fakeSleepRelease = new ManualResetEventSlim())
using (var fakeSleepStream = new MemoryStream())
{
    coordinator.Connect();
    var manual = PowerServer.HandleAsync(fakeSleepStream, timeout.Token, () => 1, () => { fakeSleepRelease.Wait(timeout.Token); return 0; }, coordinator);
    await Task.Delay(30);
    coordinator.Disconnect(false);
    await Task.Delay(350);
    if (autoCalls != 1) throw new Exception("manual sleep scheduled an unwanted second sleep");
    fakeSleepRelease.Set(); await manual;
}
Console.WriteLine("PASS: auto-sleep disarm, delayed disconnect, reconnect and cancellation (fake sleep)");

var aggregateListener = new TcpListener(IPAddress.Loopback, 0);
aggregateListener.Start();
int aggregatePort = ((IPEndPoint)aggregateListener.LocalEndpoint).Port;
async Task ServeAggregate()
{
    using var peer = await aggregateListener.AcceptTcpClientAsync(timeout.Token);
    var stream = peer.GetStream(); var handshake = new byte[4]; await stream.ReadFrameExactlyAsync(handshake, timeout.Token);
    if (!handshake.AsSpan().SequenceEqual("VGM2"u8)) throw new Exception("aggregate handshake");
    await stream.WriteAsync(new byte[] { 1 }, timeout.Token);
    using var session = new MultiplexSession(peer, async (_, token) => { var local = new TcpClient(); await local.ConnectAsync(IPAddress.Loopback, serverPort, token); return local; });
    try { await session.RunAsync(timeout.Token); } catch (Exception ex) when (ex is OperationCanceledException or IOException or ObjectDisposedException) { }
}
var relay = ServeAggregate();
using var aggregate = new AggregateClient("127.0.0.1", aggregatePort);
var aggregateTask = aggregate.RunAsync(timeout.Token);
await aggregate.WaitUntilConnectedAsync(timeout.Token);
var fake = AcceptFake(1);
var aggregatePower = new PowerClient("test-target", "127.0.0.1", aggregate.KeyboardPort, store);
await aggregatePower.SleepAsync(timeout.Token); await fake;
if (calls != 2) throw new Exception("aggregate fake sleep");
Console.WriteLine("PASS: sleep request over aggregate transport (fake sleep)");
async Task ServeAuto()
{
    using var peer = await listener.AcceptTcpClientAsync(timeout.Token);
    using var stream = peer.GetStream(); var name = new byte[4]; await stream.ReadFrameExactlyAsync(name, timeout.Token);
    if (!name.AsSpan().SequenceEqual("VGW2"u8)) throw new Exception("aggregate auto handshake");
    await PowerServer.HandleAutoAsync(stream, timeout.Token, coordinator);
}
var autoRelay = ServeAuto();
using (var local = new TcpClient())
{
    await local.ConnectAsync(IPAddress.Loopback, aggregate.KeyboardPort, timeout.Token);
    var stream = local.GetStream(); await stream.WriteAsync("VGW2"u8.ToArray(), timeout.Token);
    var ack = new byte[1]; await stream.ReadFrameExactlyAsync(ack, timeout.Token);
    if (ack[0] != 1) throw new Exception("aggregate auto ack");
    await stream.WriteAsync(new byte[] { 0 }, timeout.Token); await stream.ReadFrameExactlyAsync(ack, timeout.Token);
    if (ack[0] != 0) throw new Exception("aggregate disarm ack");
}
await autoRelay; await Task.Delay(350);
if (autoCalls != 1) throw new Exception("aggregate disarm caused sleep");
Console.WriteLine("PASS: automatic sleep control over aggregate transport");
timeout.Cancel(); aggregate.Dispose();
try { await aggregateTask; } catch (Exception ex) when (ex is OperationCanceledException or IOException or ObjectDisposedException or SocketException) { }
await relay;
listener.Stop(); aggregateListener.Stop();
File.Delete(Path.Combine(newSettings, "settings.json")); File.Delete(Path.Combine(newSettings, "wol.json"));
File.Delete(Path.Combine(oldSettings, "wol.json")); File.Delete(Path.Combine(oldSettings, "auto-power.json"));
Directory.Delete(newSettings); Directory.Delete(oldSettings);
File.Delete(Path.Combine(priorDirectory, "settings.json")); Directory.Delete(priorDirectory);
Directory.Delete(testRoot);

sealed class FakeGamepad : IGamepadDevice
{
    public readonly TaskCompletionSource<bool> Received = new(TaskCreationOptions.RunContinuationsAsynchronously);
    public bool Stopped { get; private set; }
    public bool TryRead(uint index, out Report report) { report = new Report(0x1000, 0, 0, 0, 0, 0, 0); return true; }
    public void SetMotors(uint index, byte large, byte small)
    {
        if (large == 12 && small == 34) Received.TrySetResult(true);
        if (large == 0 && small == 0) Stopped = true;
    }
}
