using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Text.Json;
using RemoteGamepad;

internal static class ScreenServer
{
    private const int MaxMetadata = 4096;
    private const int MaxImage = 32 * 1024 * 1024;

    public static async Task RunAsync(IPAddress address, int port, CancellationToken stop)
    {
        var listener = new TcpListener(address, port);
        using var slots = new SemaphoreSlim(2);
        var tasks = new List<Task>();
        listener.Start();
        Console.WriteLine($"画面监听 {address}:{port}（JPEG 单帧）。");
        try
        {
            while (!stop.IsCancellationRequested)
            {
                var peer = await listener.AcceptTcpClientAsync(stop);
                if (!slots.Wait(0)) { peer.Dispose(); continue; }
                tasks.RemoveAll(t => t.IsCompleted);
                tasks.Add(HandleAsync(peer, slots, stop));
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        finally { listener.Stop(); await Task.WhenAll(tasks); }
    }

    private static async Task HandleAsync(TcpClient peer, SemaphoreSlim slots, CancellationToken stop)
    {
        using (peer)
        using (var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop))
        {
            timeout.CancelAfter(TimeSpan.FromSeconds(15));
            var token = timeout.Token;
            try
            {
                var stream = peer.GetStream();
                var magic = new byte[4];
                await stream.ReadFrameExactlyAsync(magic, token);
                if (!magic.AsSpan().SequenceEqual("VDF1"u8)) throw new InvalidDataException("画面协议版本不支持");
                await WriteMetadataAsync(stream, new { type = "capabilities", version = 1, snapshot = true, formats = new[] { "jpeg" }, encoders = new[] { "cpu" }, gpu = false, video = false }, token);
                var header = new byte[4];
                await stream.ReadFrameExactlyAsync(header, token);
                int size = BinaryPrimitives.ReadInt32LittleEndian(header);
                if (size is < 2 or > MaxMetadata) throw new InvalidDataException("请求长度无效");
                var bytes = new byte[size];
                await stream.ReadFrameExactlyAsync(bytes, token);
                using var json = JsonDocument.Parse(bytes);
                var request = json.RootElement;
                string? type = request.GetProperty("type").GetString();
                if (type != "snapshot") throw new InvalidDataException("仅支持单帧请求");
                int quality = request.GetProperty("quality").GetInt32();
                if (quality is < 1 or > 100) throw new InvalidDataException("JPEG 画质必须为 1–100");
                string? encoder = request.GetProperty("encoder").GetString();
                if (encoder != "cpu") throw new InvalidDataException("当前仅支持 CPU JPEG 编码");
                var frame = GdiCapture.Capture(quality);
                if (frame.Data.Length > MaxImage) throw new InvalidDataException("截图超过大小限制");
                await WriteMetadataAsync(stream, new { type = "frame", version = 1, format = "jpeg", encoder = "cpu", width = frame.Width, height = frame.Height, sequence = 0, timestampUnixMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), length = frame.Data.Length }, token);
                await stream.WriteAsync(frame.Data, token);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                try { await WriteMetadataAsync(peer.GetStream(), new { type = "error", message = ex.Message }, token); } catch { }
                Console.WriteLine($"单帧连接结束: {ex.Message}");
            }
            finally { slots.Release(); }
        }
    }

    private static async Task WriteMetadataAsync(NetworkStream stream, object metadata, CancellationToken stop)
    {
        byte[] data = JsonSerializer.SerializeToUtf8Bytes(metadata);
        if (data.Length > MaxMetadata) throw new InvalidDataException("响应元数据过大");
        var header = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(header, data.Length);
        await stream.WriteAsync(header, stop);
        await stream.WriteAsync(data, stop);
    }
}
