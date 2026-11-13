using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Threading.Channels;
using NAudio.Wave;
using RemoteGamepad;

internal static class AudioServer
{
    public static async Task RunAsync(IPAddress address, int port, CancellationToken stop)
    {
        var listener = new TcpListener(address, port);
        try
        {
            listener.Start();
            Console.WriteLine($"音频监听 {address}:{port}");
            while (!stop.IsCancellationRequested)
            {
                using var peer = await listener.AcceptTcpClientAsync(stop);
                peer.NoDelay = true;
                try { await StreamAudio(peer, stop); }
                catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
                catch (Exception ex) { Console.WriteLine($"音频连接结束: {ex.Message}"); }
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        catch (Exception ex) { Console.WriteLine($"音频服务不可用: {ex.Message}"); }
        finally { listener.Stop(); }
    }

    private static async Task StreamAudio(TcpClient peer, CancellationToken stop)
    {
        using var stream = peer.GetStream();
        using var handshake = CancellationTokenSource.CreateLinkedTokenSource(stop);
        handshake.CancelAfter(TimeSpan.FromSeconds(2));
        var magic = new byte[4];
        await stream.ReadFrameExactlyAsync(magic, handshake.Token);
        if (!magic.AsSpan().SequenceEqual("VGA1"u8)) throw new InvalidDataException("音频协议不匹配");

        using var capture = new WasapiLoopbackCapture();
        using var formatStream = new MemoryStream();
        using (var writer = new BinaryWriter(formatStream, System.Text.Encoding.UTF8, true)) capture.WaveFormat.Serialize(writer);
        await stream.WriteAsync(formatStream.ToArray(), stop);

        // The capture thread never waits on the network; drop old buffers when congested.
        var frames = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(12) { FullMode = BoundedChannelFullMode.DropOldest, SingleReader = true, SingleWriter = true });
        capture.DataAvailable += (_, e) =>
        {
            if (e.BytesRecorded == 0) return;
            var copy = new byte[e.BytesRecorded];
            Buffer.BlockCopy(e.Buffer, 0, copy, 0, copy.Length);
            frames.Writer.TryWrite(copy);
        };
        capture.RecordingStopped += (_, e) => frames.Writer.TryComplete(e.Exception);
        capture.StartRecording();
        Console.WriteLine($"音频已连接：{capture.WaveFormat}");
        using var session = CancellationTokenSource.CreateLinkedTokenSource(stop);
        var send = SendFrames(stream, frames.Reader, session.Token);
        var disconnected = WaitForDisconnect(stream, session.Token);
        try { await await Task.WhenAny(send, disconnected); }
        finally
        {
            session.Cancel();
            capture.StopRecording();
            peer.Close();
            try { await Task.WhenAll(send, disconnected); } catch { }
        }
    }

    private static async Task SendFrames(NetworkStream stream, ChannelReader<byte[]> frames, CancellationToken stop)
    {
        await foreach (var frame in frames.ReadAllAsync(stop))
        {
            var length = new byte[4];
            BinaryPrimitives.WriteInt32LittleEndian(length, frame.Length);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
            timeout.CancelAfter(TimeSpan.FromSeconds(1));
            await stream.WriteAsync(length, timeout.Token);
            await stream.WriteAsync(frame, timeout.Token);
        }
    }

    private static async Task WaitForDisconnect(NetworkStream stream, CancellationToken stop)
    {
        var data = new byte[1];
        if (await stream.ReadAsync(data, stop) != 0) throw new InvalidDataException("意外的音频客户端数据");
    }
}
