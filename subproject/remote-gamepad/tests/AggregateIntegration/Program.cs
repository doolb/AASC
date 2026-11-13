using System.Buffers.Binary;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using RemoteGamepad;

// Requires ViGEmBus, a free XInput slot and a default audio output device.
if (args.Length != 2) throw new ArgumentException("Arguments: dotnet executable, subproject root");
var occupied = Enumerable.Range(0, 4).Where(i => Native.GetState((uint)i, out _) == 0).ToHashSet();
var info = new ProcessStartInfo(args[0]) { UseShellExecute = false };
info.ArgumentList.Add(Path.Combine(Path.GetFullPath(args[1]), "src/Server/bin/Debug/net6.0/Server.dll"));
info.ArgumentList.Add("127.0.0.1"); info.ArgumentList.Add("29720");
using var server = Process.Start(info) ?? throw new Exception("Failed to start server");
using var stop = new CancellationTokenSource(TimeSpan.FromSeconds(20));
var listener = new TcpListener(IPAddress.Loopback, 0);
listener.Start();
int forwardedPort = ((IPEndPoint)listener.LocalEndpoint).Port;
var accepted = new TaskCompletionSource<TcpClient>(TaskCreationOptions.RunContinuationsAsynchronously);
int connectionCount = 0;
var forwardTask = Task.Run(async () =>
{
    while (!stop.IsCancellationRequested)
    {
        using var inbound = await listener.AcceptTcpClientAsync(stop.Token);
        Interlocked.Increment(ref connectionCount);
        using var outbound = new TcpClient();
        await outbound.ConnectAsync(IPAddress.Loopback, 29722, stop.Token);
        accepted.TrySetResult(inbound);
        try { await Task.WhenAny(inbound.GetStream().CopyToAsync(outbound.GetStream(), stop.Token), outbound.GetStream().CopyToAsync(inbound.GetStream(), stop.Token)); }
        catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
    }
});
try
{
    await Task.Delay(400, stop.Token);
    using var aggregate = new AggregateClient("127.0.0.1", forwardedPort);
    var aggregateTask = aggregate.RunAsync(stop.Token);
    await Until(() => aggregate.IsConnected, "aggregate connection");
    using var pad = await Connect(aggregate.GamepadPort);
    using var keyboard = await Connect(aggregate.KeyboardPort);
    using var audio = await Connect(aggregate.AudioPort);
    await pad.GetStream().WriteAsync(Report.Magic.ToArray(), stop.Token);
    await keyboard.GetStream().WriteAsync("VGK3"u8.ToArray(), stop.Token);
    await audio.GetStream().WriteAsync("VGA1"u8.ToArray(), stop.Token);
    var ack = new byte[1]; await keyboard.GetStream().ReadFrameExactlyAsync(ack, stop.Token);
    if (ack[0] != 1) throw new Exception("keyboard handshake");
    var formatLength = new byte[4]; await audio.GetStream().ReadFrameExactlyAsync(formatLength, stop.Token);
    int length = BinaryPrimitives.ReadInt32LittleEndian(formatLength);
    if (length is < 18 or > 128) throw new Exception("audio handshake");
    var format = new byte[length]; await audio.GetStream().ReadFrameExactlyAsync(format, stop.Token);
    using var heartbeat = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
    var padTask = Task.Run(async () =>
    {
        var data = new byte[Report.Size]; new Report(0x1000, 0, 0, 0, 0, 0, 0).Write(data);
        try { while (true) { await pad.GetStream().WriteAsync(data, heartbeat.Token); await Task.Delay(50, heartbeat.Token); } }
        catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
    });
    await Until(() => Enumerable.Range(0, 4).Any(i => !occupied.Contains(i) && Native.GetState((uint)i, out var s) == 0 && s.Gamepad.Buttons == 0x1000), "gamepad through aggregate");
    await keyboard.GetStream().WriteAsync(new KeyboardPacket(KeyboardPacket.Down, 0x87, 0, 0).Encode(), stop.Token); // F24
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) != 0, "keyboard through aggregate");
    if (Volatile.Read(ref connectionCount) != 1) throw new Exception("more than one forwarded connection");
    await keyboard.GetStream().WriteAsync(new KeyboardPacket(KeyboardPacket.Up, 0x87, 0, 0).Encode(), stop.Token);
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) == 0, "keyboard release");
    keyboard.Close();
    await Task.Delay(200, stop.Token);
    if (!Enumerable.Range(0, 4).Any(i => !occupied.Contains(i) && Native.GetState((uint)i, out var s) == 0 && s.Gamepad.Buttons == 0x1000))
        throw new Exception("closing keyboard unexpectedly closed gamepad");
    using var reopenedKeyboard = await Connect(aggregate.KeyboardPort);
    await reopenedKeyboard.GetStream().WriteAsync("VGK3"u8.ToArray(), stop.Token);
    await reopenedKeyboard.GetStream().ReadFrameExactlyAsync(ack, stop.Token);
    if (ack[0] != 1) throw new Exception("keyboard channel reopen");
    await reopenedKeyboard.GetStream().WriteAsync(new KeyboardPacket(KeyboardPacket.Down, 0x87, 0, 0).Encode(), stop.Token);
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) != 0, "reopened keyboard before tunnel disconnect");
    if (Volatile.Read(ref connectionCount) != 1) throw new Exception("reopening a channel created another outer connection");
    var forwardedSocket = await accepted.Task;
    forwardedSocket.Dispose();
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) == 0, "key release after tunnel closes");
    await Until(() => !Enumerable.Range(0, 4).Any(i => !occupied.Contains(i) && Native.GetState((uint)i, out _) == 0), "gamepad release after tunnel closes");
    heartbeat.Cancel(); await padTask;
    await Until(() => !aggregate.IsConnected, "aggregate disconnect detection");
    await Until(() => aggregate.IsConnected && Volatile.Read(ref connectionCount) == 2, "aggregate reconnect");
    using var keyboardAgain = await Connect(aggregate.KeyboardPort);
    await keyboardAgain.GetStream().WriteAsync("VGK3"u8.ToArray(), stop.Token);
    await keyboardAgain.GetStream().ReadFrameExactlyAsync(ack, stop.Token);
    if (ack[0] != 1) throw new Exception("keyboard handshake after reconnect");
    await keyboardAgain.GetStream().WriteAsync(new KeyboardPacket(KeyboardPacket.Down, 0x87, 0, 0).Encode(), stop.Token);
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) != 0, "keyboard after reconnect");
    await keyboardAgain.GetStream().WriteAsync(new KeyboardPacket(KeyboardPacket.Up, 0x87, 0, 0).Encode(), stop.Token);
    await Until(() => (Native.GetAsyncKeyState(0x87) & 0x8000) == 0, "key release after reconnect");
    stop.Cancel(); aggregate.Dispose();
    try { await aggregateTask; } catch (OperationCanceledException) { }
    try { await forwardTask; } catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
    Console.WriteLine("PASS: one forwarded TCP connection carries gamepad, keyboard and audio; tunnel failure releases input and reconnects");
}
finally
{
    stop.Cancel(); listener.Stop();
    Native.keybd_event(0x87, 0, 2, UIntPtr.Zero);
    if (!server.HasExited) { server.Kill(true); await server.WaitForExitAsync(); }
}

async Task<TcpClient> Connect(int port)
{
    var client = new TcpClient { NoDelay = true };
    await client.ConnectAsync(IPAddress.Loopback, port, stop.Token);
    return client;
}
static async Task Until(Func<bool> condition, string name)
{
    for (int i = 0; i < 200; i++) { if (condition()) return; await Task.Delay(20); }
    throw new Exception("Timed out: " + name);
}
static class Native
{
    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")] public static extern uint GetState(uint index, out State state);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [StructLayout(LayoutKind.Sequential)] public struct State { public uint Packet; public Gamepad Gamepad; }
    [StructLayout(LayoutKind.Sequential)] public struct Gamepad { public ushort Buttons; public byte LT, RT; public short LX, LY, RX, RY; }
}
