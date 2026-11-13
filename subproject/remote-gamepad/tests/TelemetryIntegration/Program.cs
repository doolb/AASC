using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.IO.MemoryMappedFiles;
using System.Text.Json;
using RemoteGamepad;

if (args.Length is < 2 or > 3) throw new ArgumentException("Arguments: dotnet executable, subproject root, [--fps-only]");
var root = Path.GetFullPath(args[1]);
var fields = PresentMonSampler.ParseCsv("\"app,name.exe\",123,\"0x01\",20.0");
if (fields.Count != 4 || fields[0] != "app,name.exe" || fields[1] != "123") throw new Exception("CSV parsing");
var powerSample = new TelemetrySample(DateTime.UtcNow, null, null, null, null, null, null, null, null, null, null, null, 37.5, 64.13);
var powerRoundTrip = JsonSerializer.Deserialize<TelemetrySample>(JsonSerializer.Serialize(powerSample));
if (powerRoundTrip?.CpuPowerWatts != 37.5 || powerRoundTrip.GpuPowerWatts != 64.13) throw new Exception("power telemetry round trip");
var oldSample = JsonSerializer.Deserialize<TelemetrySample>("{\"TimestampUtc\":\"2026-01-01T00:00:00Z\"}");
if (oldSample == null || oldSample.CpuPowerWatts != null || oldSample.GpuPowerWatts != null) throw new Exception("old telemetry must leave power unavailable");
Console.WriteLine("PASS: power telemetry and compatibility with older samples");
var priorPresentMon = Environment.GetEnvironmentVariable("REMOTE_GAMEPAD_PRESENTMON");
var fakePresentMon = Path.Combine(root, "tests/FpsStub/bin/Debug/net6.0/win-x64/FpsStub.exe");
if (!File.Exists(fakePresentMon)) throw new Exception("Build tests/FpsStub for win-x64 first");
Environment.SetEnvironmentVariable("REMOTE_GAMEPAD_PRESENTMON", fakePresentMon);
try
{
    using var fps = new PresentMonSampler();
    fps.SetForeground(4242);
    for (int i = 0; i < 100 && fps.Read().fps == null; i++) await Task.Delay(20);
    if (fps.Read().fps is not double rate || Math.Abs(rate - 50) > 0.01) throw new Exception("foreground FPS calculation");
    fps.SetForeground(5555);
    await Task.Delay(100);
    if (fps.Read().fps != null) throw new Exception("stale FPS after foreground switch");
    fps.SetForeground(5555, new uint[] { 4242 });
    for (int i = 0; i < 100 && fps.Read().fps == null; i++) await Task.Delay(20);
    if (fps.Read() is not (double childRate, "前台子进程") || Math.Abs(childRate - 50) > 0.01) throw new Exception("child renderer FPS");
    fps.SetForeground(5555);
    if (fps.Read().fps != null) throw new Exception("removed child still contributes FPS");
    Console.WriteLine("PASS: PresentMon FPS parsing, foreground switch, and child renderer");
}
finally { Environment.SetEnvironmentVariable("REMOTE_GAMEPAD_PRESENTMON", priorPresentMon); }
string mappingName = "RemoteGamepadTest_" + Guid.NewGuid().ToString("N");
using (var mapping = MemoryMappedFile.CreateNew(mappingName, 1024))
using (var memory = mapping.CreateViewAccessor())
{
    memory.Write(0, 0x52545353u); memory.Write(4, 0x00020015u);
    memory.Write(8, 300u); memory.Write(12, 64u); memory.Write(16, 2u);
    memory.Write(64, 4242u); memory.Write(64 + 268, 100u); memory.Write(64 + 272, 1100u); memory.Write(64 + 276, 50u);
    var rtss = new RtssSampler(mappingName);
    if (rtss.Read(5555, new uint[] { 4242 }).fps != null) throw new Exception("RTSS must wait for a new sample");
    memory.Write(64 + 272, 1120u); memory.Write(64 + 276, 51u);
    var reading = rtss.Read(5555, new uint[] { 4242 });
    if (reading.fps is not double rtssRate || Math.Abs(rtssRate - 50) > 0.01 || reading.source != "RTSS 子进程") throw new Exception("RTSS child FPS");
    if (rtss.Read(5555, Array.Empty<uint>()).fps != null) throw new Exception("RTSS must ignore unrelated processes");
    memory.Write(8, 3u);
    if (rtss.Read(5555, new uint[] { 4242 }).fps != null) throw new Exception("RTSS must reject invalid entry size");
    Console.WriteLine("PASS: RTSS fresh matching process, child process, and bounds checks");
}
var childInfo = new ProcessStartInfo(fakePresentMon) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
using (var child = Process.Start(childInfo) ?? throw new Exception("Failed to start child process"))
{
    try
    {
        if (!ProcessTree.Descendants((uint)Environment.ProcessId).Contains((uint)child.Id)) throw new Exception("process tree did not include child");
        if (ProcessTree.Descendants(0).Count != 0) throw new Exception("zero foreground must have no descendants");
        Console.WriteLine("PASS: Windows process tree identifies child process");
    }
    finally { if (!child.HasExited) { child.Kill(true); await child.WaitForExitAsync(); } }
}
if (args.Length == 3 && args[2] == "--fps-live")
{
    var realPresentMon = Path.Combine(root, "tools/PresentMon.exe");
    Environment.SetEnvironmentVariable("REMOTE_GAMEPAD_PRESENTMON", realPresentMon);
    try
    {
        using var first = new PresentMonSampler();
        using var second = new PresentMonSampler();
        await Task.Delay(2000);
        async Task<int> SessionCount()
        {
            var query = new ProcessStartInfo("logman.exe") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true };
            query.ArgumentList.Add("query"); query.ArgumentList.Add("-ets");
            using var command = Process.Start(query) ?? throw new Exception("Cannot query ETW sessions");
            string result = await command.StandardOutput.ReadToEndAsync();
            await command.WaitForExitAsync();
            return result.Split('\n').Count(line => line.Contains($"RemoteGamepad_{Environment.ProcessId}_", StringComparison.OrdinalIgnoreCase));
        }
        if (await SessionCount() != 2) throw new Exception("two independent PresentMon sessions did not start");
        first.Dispose();
        await Task.Delay(500);
        if (await SessionCount() != 1 || second.Read().status.Contains("已退出")) throw new Exception("stopping one sampler interrupted the other");
        Console.WriteLine("PASS: independent live PresentMon sessions and cleanup");
    }
    finally { Environment.SetEnvironmentVariable("REMOTE_GAMEPAD_PRESENTMON", priorPresentMon); }
    return;
}
if (args.Length == 3 && args[2] == "--fps-only") return;
using (var counters = new GpuCounters())
{
    counters.Read(); await Task.Delay(1100);
    var (usage, memory) = counters.Read();
    if (usage is double u && (u < 0 || u > 100)) throw new Exception("GPU counter range");
    Console.WriteLine($"GPU performance counters: usage={usage?.ToString("F1") ?? "unavailable"}, dedicated bytes={memory?.ToString() ?? "unavailable"}");
}
var info = new ProcessStartInfo(args[0]) { UseShellExecute = false };
info.ArgumentList.Add(Path.Combine(root, "src/Server/bin/Debug/net6.0/Server.dll"));
info.ArgumentList.Add("127.0.0.1"); info.ArgumentList.Add("29730");
using var server = Process.Start(info) ?? throw new Exception("Failed to start server");
using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(25));
try
{
    using (var direct = new TcpClient())
    {
        for (;;)
        {
            try { await direct.ConnectAsync(IPAddress.Loopback, 29730, stop.Token); break; }
            catch (SocketException) { await Task.Delay(100, stop.Token); }
        }
        await direct.GetStream().WriteAsync("VGS1"u8.ToArray(), stop.Token);
        await ReadSample(direct.GetStream());
        var sample = await ReadSample(direct.GetStream());
        Validate(sample);
        Console.WriteLine($"PASS: direct telemetry CPU={sample.CpuPercent:F1}%, RAM={sample.MemoryUsedBytes}/{sample.MemoryTotalBytes}, GPU={sample.GpuPercent}, VRAM={sample.GpuMemoryUsedBytes}/{sample.GpuMemoryTotalBytes}, FPS={sample.ForegroundFps?.ToString() ?? sample.FpsStatus}");
    }
    await Task.Delay(1500, stop.Token);
    using var aggregate = new AggregateClient("127.0.0.1", 29732);
    var aggregateTask = aggregate.RunAsync(stop.Token);
    for (int i = 0; !aggregate.IsConnected && i < 100; i++) await Task.Delay(50, stop.Token);
    if (!aggregate.IsConnected) throw new Exception("Aggregate connection unavailable");
    using var local = new TcpClient();
    await local.ConnectAsync(IPAddress.Loopback, aggregate.MetricsPort, stop.Token);
    await local.GetStream().WriteAsync("VGS1"u8.ToArray(), stop.Token);
    await ReadSample(local.GetStream());
    var forwarded = await ReadSample(local.GetStream());
    Validate(forwarded);
    Console.WriteLine("PASS: telemetry is carried through aggregate channel");
    stop.Cancel(); aggregate.Dispose();
    try { await aggregateTask; } catch (OperationCanceledException) { }
    // Let the server observe the closed stream and stop its ETW session before this test kills it.
    await Task.Delay(3500);
}
finally
{
    stop.Cancel();
    if (!server.HasExited) { server.Kill(true); await server.WaitForExitAsync(); }
}
async Task<TelemetrySample> ReadSample(NetworkStream stream)
{
    var length = new byte[4]; await stream.ReadFrameExactlyAsync(length, stop.Token);
    int size = BinaryPrimitives.ReadInt32LittleEndian(length);
    if (size is < 2 or > 8192) throw new Exception("Invalid telemetry frame");
    var body = new byte[size]; await stream.ReadFrameExactlyAsync(body, stop.Token);
    return JsonSerializer.Deserialize<TelemetrySample>(body) ?? throw new Exception("Invalid telemetry JSON");
}
static void Validate(TelemetrySample sample)
{
    if (sample.CpuPercent is not double cpu || cpu < 0 || cpu > 100) throw new Exception("CPU percentage");
    if (sample.MemoryTotalBytes is not ulong total || total == 0 || sample.MemoryUsedBytes > total) throw new Exception("memory values");
    if (sample.GpuPercent is double gpu && (gpu < 0 || gpu > 100)) throw new Exception("GPU percentage");
    if (sample.GpuMemoryTotalBytes is ulong gt && sample.GpuMemoryUsedBytes > gt) throw new Exception("GPU memory values");
    if (sample.ForegroundFps is double fps && (fps <= 0 || fps > 10000)) throw new Exception("FPS value");
}
