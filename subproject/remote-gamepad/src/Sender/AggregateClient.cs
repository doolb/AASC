using System.Net;
using System.Net.Sockets;
using RemoteGamepad;

// Local loopback adapters let the existing protocols share one SSH-forwarded socket.
internal sealed class AggregateClient : IDisposable
{
    private readonly string host;
    private readonly int port;
    private readonly TcpListener gamepad = new(IPAddress.Loopback, 0);
    private readonly TcpListener keyboard = new(IPAddress.Loopback, 0);
    private readonly TcpListener audio = new(IPAddress.Loopback, 0);
    private readonly TcpListener metrics = new(IPAddress.Loopback, 0);
    private readonly object gate = new();
    private MultiplexSession? current;
    internal bool IsConnected { get { lock (gate) return current != null; } }
    public int GamepadPort => ((IPEndPoint)gamepad.LocalEndpoint).Port;
    public int KeyboardPort => ((IPEndPoint)keyboard.LocalEndpoint).Port;
    public int AudioPort => ((IPEndPoint)audio.LocalEndpoint).Port;
    public int MetricsPort => ((IPEndPoint)metrics.LocalEndpoint).Port;

    public async Task WaitUntilConnectedAsync(CancellationToken stop)
    {
        while (!IsConnected) await Task.Delay(100, stop);
    }

    public AggregateClient(string host, int port)
    {
        this.host = host; this.port = port;
        try { gamepad.Start(); keyboard.Start(); audio.Start(); metrics.Start(); }
        catch { Dispose(); throw; }
    }
    public async Task RunAsync(CancellationToken stop)
    {
        var listeners = new[] { Accept(gamepad, MultiplexSession.Gamepad, stop), Accept(keyboard, MultiplexSession.Keyboard, stop), Accept(audio, MultiplexSession.Audio, stop), Accept(metrics, MultiplexSession.Metrics, stop) };
        try
        {
            while (!stop.IsCancellationRequested)
            {
                try
                {
                    using var peer = new TcpClient { NoDelay = true };
                    using var handshake = CancellationTokenSource.CreateLinkedTokenSource(stop);
                    handshake.CancelAfter(TimeSpan.FromSeconds(5));
                    await peer.ConnectAsync(host, port, handshake.Token);
                    var stream = peer.GetStream();
                    await stream.WriteAsync("VGM2"u8.ToArray(), handshake.Token);
                    var ack = new byte[1];
                    await stream.ReadFrameExactlyAsync(ack, handshake.Token);
                    if (ack[0] != 1) throw new InvalidDataException("聚合协议不匹配");
                    using var session = new MultiplexSession(peer);
                    lock (gate) current = session;
                    SenderLog.WriteLine($"聚合已连接 {host}:{port}");
                    try { await session.RunAsync(stop); }
                    finally { lock (gate) { if (ReferenceEquals(current, session)) current = null; } }
                }
                catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
                catch (Exception ex) { SenderLog.WriteLine($"聚合连接中断: {ex.Message}；2 秒后重试。"); }
                try { await Task.Delay(2000, stop); } catch (OperationCanceledException) { break; }
            }
        }
        finally
        {
            Dispose();
            try { await Task.WhenAll(listeners); } catch (OperationCanceledException) { } catch (ObjectDisposedException) { } catch (SocketException) { }
        }
    }
    private async Task Accept(TcpListener listener, byte kind, CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            var local = await listener.AcceptTcpClientAsync(stop);
            MultiplexSession? session;
            lock (gate) session = current;
            if (session == null) { local.Dispose(); continue; }
            try { await session.OpenLocalAsync(kind, local); }
            catch (Exception ex) when (ex is IOException or SocketException or InvalidOperationException or OperationCanceledException or ObjectDisposedException) { local.Dispose(); }
        }
    }
    public void Dispose()
    {
        lock (gate) { current?.Dispose(); current = null; }
        gamepad.Stop(); keyboard.Stop(); audio.Stop(); metrics.Stop();
    }
}
