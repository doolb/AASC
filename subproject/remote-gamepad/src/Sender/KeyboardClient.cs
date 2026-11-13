using System.Net.Sockets;
using System.Threading.Channels;
using RemoteGamepad;

internal static class KeyboardClient
{
    public static async Task RunAsync(string host, int port, KeyboardRouter router, CancellationToken stop)
    {
        router.Status += message => SenderLog.WriteLine(message);
        using var hook = new KeyboardHook(router);
        try { await hook.StartAsync(); }
        catch (Exception ex) { SenderLog.WriteLine($"键鼠捕获不可用: {ex.Message}"); return; }
        while (!stop.IsCancellationRequested)
        {
            try { await RunSession(host, port, router, stop); }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception ex) { SenderLog.WriteLine($"键鼠连接中断: {ex.Message}；2 秒后重试。"); }
            try { await Task.Delay(2000, stop); } catch (OperationCanceledException) { break; }
        }
    }

    private static async Task RunSession(string host, int port, KeyboardRouter router, CancellationToken stop)
    {
        using var client = new TcpClient { NoDelay = true };
        using var handshake = CancellationTokenSource.CreateLinkedTokenSource(stop);
        handshake.CancelAfter(TimeSpan.FromSeconds(5));
        await client.ConnectAsync(host, port, handshake.Token);
        using var stream = client.GetStream();
        await stream.WriteAsync("VGK3"u8.ToArray(), handshake.Token);
        var ack = new byte[1];
        await stream.ReadFrameExactlyAsync(ack, handshake.Token);
        if (ack[0] != 1) throw new InvalidDataException("键鼠协议不匹配");
        using var session = CancellationTokenSource.CreateLinkedTokenSource(stop);
        var channel = Channel.CreateBounded<KeyboardPacket>(new BoundedChannelOptions(512) { FullMode = BoundedChannelFullMode.Wait, SingleReader = true, SingleWriter = true });
        void OnOverflow() => session.Cancel();
        router.Overflow += OnOverflow;
        router.Attach(channel.Writer);
        var send = SendFrames(stream, channel.Reader, session.Token);
        var read = WaitForDisconnect(stream, session.Token);
        try { await await Task.WhenAny(send, read); }
        finally
        {
            router.Detach();
            router.Overflow -= OnOverflow;
            session.Cancel();
            client.Close();
            try { await Task.WhenAll(send, read); } catch { }
        }
    }

    private static async Task SendFrames(NetworkStream stream, ChannelReader<KeyboardPacket> input, CancellationToken stop)
    {
        var heartbeat = new KeyboardPacket(KeyboardPacket.Heartbeat, 0, 0, 0).Encode();
        var nextHeartbeat = Environment.TickCount64;
        while (true)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
            timeout.CancelAfter(TimeSpan.FromSeconds(1));
            var batch = new byte[KeyboardPacket.Size * 64];
            int used = 0;
            while (used < batch.Length && input.TryRead(out var packet))
            {
                packet.Encode().CopyTo(batch, used);
                used += KeyboardPacket.Size;
            }
            if (used != 0) await stream.WriteAsync(batch.AsMemory(0, used), timeout.Token);
            if (Environment.TickCount64 >= nextHeartbeat)
            {
                await stream.WriteAsync(heartbeat, timeout.Token);
                nextHeartbeat = Environment.TickCount64 + 250;
            }
            if (used < batch.Length) await Task.Delay(10, stop);
        }
    }

    private static async Task WaitForDisconnect(NetworkStream stream, CancellationToken stop)
    {
        var data = new byte[1];
        if (await stream.ReadAsync(data, stop) != 0) throw new InvalidDataException("意外的键盘服务端数据");
    }
}
