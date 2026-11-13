using System.Buffers.Binary;
using System.Net.Sockets;
using System.Text.Json;
using RemoteGamepad;

internal sealed class TelemetryState
{
    private readonly object gate = new();
    private TelemetrySample? sample;
    private DateTime received;
    private int version;
    public void Update(TelemetrySample value) { lock (gate) { sample = value; received = DateTime.UtcNow; version++; } }
    public (TelemetrySample? Sample, int Version, bool Stale) Read()
    { lock (gate) return (sample, version, sample == null || DateTime.UtcNow - received > TimeSpan.FromSeconds(4)); }
}

internal static class TelemetryClient
{
    public static async Task RunAsync(string host, int port, TelemetryState state, CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                using var client = new TcpClient { NoDelay = true };
                using var connect = CancellationTokenSource.CreateLinkedTokenSource(stop);
                connect.CancelAfter(TimeSpan.FromSeconds(5));
                await client.ConnectAsync(host, port, connect.Token);
                using var stream = client.GetStream();
                await stream.WriteAsync("VGS1"u8.ToArray(), connect.Token);
                var lengthBytes = new byte[4];
                while (true)
                {
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
                    timeout.CancelAfter(TimeSpan.FromSeconds(5));
                    await stream.ReadFrameExactlyAsync(lengthBytes, timeout.Token);
                    int length = BinaryPrimitives.ReadInt32LittleEndian(lengthBytes);
                    if (length is < 2 or > 8192) throw new InvalidDataException("无效性能数据长度");
                    var data = new byte[length];
                    await stream.ReadFrameExactlyAsync(data, timeout.Token);
                    var sample = JsonSerializer.Deserialize<TelemetrySample>(data) ?? throw new InvalidDataException("无效性能数据");
                    state.Update(sample);
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or InvalidDataException or JsonException or ObjectDisposedException)
            { SenderLog.WriteLine($"性能监控连接中断: {ex.Message}；2 秒后重试。"); }
            try { await Task.Delay(2000, stop); } catch (OperationCanceledException) { break; }
        }
    }
}
