using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using Nefarius.ViGEm.Client;
using RemoteGamepad;

internal static class ControlServer
{
    public static async Task RunAsync(IPAddress address, int port, ViGEmClient vigem, CancellationToken stop)
    {
        var listener = new TcpListener(address, port);
        using var clients = new SemaphoreSlim(16, 16);
        using var padSlot = new SemaphoreSlim(1, 1);
        using var keyboardSlot = new SemaphoreSlim(1, 1);
        using var metricsSlot = new SemaphoreSlim(1, 1);
        using var autoSleep = new AutoSleepCoordinator(stop, PowerServer.SleepAfterDisconnect);
        var tasks = new ConcurrentDictionary<int, Task>();
        int nextId = 0;
        listener.Start();
        Console.WriteLine($"控制监听 {address}:{port}（手柄与键鼠）；Ctrl+C 退出。");
        try
        {
            while (!stop.IsCancellationRequested)
            {
                var peer = await listener.AcceptTcpClientAsync(stop);
                if (!clients.Wait(0)) { peer.Dispose(); continue; }
                int id = Interlocked.Increment(ref nextId);
                var task = HandleWithLimit(peer, vigem, padSlot, keyboardSlot, metricsSlot, clients, autoSleep, stop);
                tasks[id] = task;
                _ = task.ContinueWith(_ => tasks.TryRemove(id, out var ignored), TaskScheduler.Default);
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        finally
        {
            listener.Stop();
            await Task.WhenAll(tasks.Values.ToArray());
        }
    }

    private static async Task HandleWithLimit(TcpClient peer, ViGEmClient vigem, SemaphoreSlim padSlot, SemaphoreSlim keyboardSlot, SemaphoreSlim metricsSlot, SemaphoreSlim clients, AutoSleepCoordinator autoSleep, CancellationToken stop)
    {
        try { await Handle(peer, vigem, padSlot, keyboardSlot, metricsSlot, autoSleep, stop); }
        finally { clients.Release(); }
    }

    private static async Task Handle(TcpClient peer, ViGEmClient vigem, SemaphoreSlim padSlot, SemaphoreSlim keyboardSlot, SemaphoreSlim metricsSlot, AutoSleepCoordinator autoSleep, CancellationToken stop)
    {
        using (peer)
        {
            try
            {
                peer.NoDelay = true;
                using var stream = peer.GetStream();
                var magic = new byte[4];
                await ReadFrame(stream, magic, stop);
                if (magic.AsSpan().SequenceEqual(Report.Magic))
                {
                    if (!padSlot.Wait(0)) throw new InvalidOperationException("已有手柄客户端");
                    try { await HandlePad(stream, vigem, stop); } finally { padSlot.Release(); }
                }
                else if (magic.AsSpan().SequenceEqual("VGK3"u8))
                {
                    if (!keyboardSlot.Wait(0)) throw new InvalidOperationException("已有键鼠客户端");
                    try { await KeyboardServer.Receive(stream, stop); } finally { keyboardSlot.Release(); }
                }
                else if (magic.AsSpan().SequenceEqual("VGS1"u8))
                {
                    if (!metricsSlot.Wait(0)) throw new InvalidOperationException("已有性能监控客户端");
                    try { await TelemetryServer.RunAsync(stream, stop); } finally { metricsSlot.Release(); }
                }
                else if (magic.AsSpan().SequenceEqual("VGW1"u8))
                {
                    await PowerServer.HandleAsync(stream, stop, coordinator: autoSleep);
                }
                else if (magic.AsSpan().SequenceEqual("VGW2"u8))
                {
                    await PowerServer.HandleAutoAsync(stream, stop, autoSleep);
                }
                else if (magic.AsSpan().SequenceEqual("VGW3"u8))
                {
                    autoSleep.CancelPending();
                    await stream.WriteAsync(new byte[] { 1 }, stop);
                }
                else throw new InvalidDataException("未知控制协议，请同时更新两端");
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
            catch (Exception ex) { Console.WriteLine($"控制连接结束: {ex.Message}"); }
        }
    }

    private static async Task HandlePad(NetworkStream stream, ViGEmClient vigem, CancellationToken stop)
    {
        var pad = vigem.CreateXbox360Controller();
        pad.AutoSubmitReport = false;
        int motors = 0;
        pad.FeedbackReceived += (_, feedback) => Interlocked.Exchange(ref motors, feedback.LargeMotor | (feedback.SmallMotor << 8));
        pad.Connect();
        Console.WriteLine("手柄客户端已连接。");
        using var session = CancellationTokenSource.CreateLinkedTokenSource(stop);
        var feedbackTask = SendFeedback(stream, () => Volatile.Read(ref motors), session.Token);
        try
        {
            var data = new byte[Report.Size];
            while (true)
            {
                await ReadFrame(stream, data, session.Token);
                var report = Report.Read(data);
                pad.ButtonState = report.Buttons;
                pad.LeftTrigger = report.LeftTrigger; pad.RightTrigger = report.RightTrigger;
                pad.LeftThumbX = report.LeftX; pad.LeftThumbY = report.LeftY;
                pad.RightThumbX = report.RightX; pad.RightThumbY = report.RightY;
                pad.SubmitReport();
            }
        }
        finally
        {
            session.Cancel();
            try { await feedbackTask; } catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
            pad.Disconnect();
        }
    }

    private static async Task ReadFrame(NetworkStream stream, byte[] buffer, CancellationToken stop)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
        timeout.CancelAfter(TimeSpan.FromSeconds(1));
        await stream.ReadFrameExactlyAsync(buffer, timeout.Token);
    }

    private static async Task SendFeedback(NetworkStream stream, Func<int> readMotors, CancellationToken stop)
    {
        try
        {
            using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(50));
            do
            {
                int motors = readMotors();
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
                timeout.CancelAfter(TimeSpan.FromSeconds(1));
                await stream.WriteAsync(new byte[] { (byte)motors, (byte)(motors >> 8) }, timeout.Token);
            } while (await timer.WaitForNextTickAsync(stop));
        }
        catch { stream.Close(); throw; }
    }
}
