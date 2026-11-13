using System.Buffers.Binary;
using System.Net.Sockets;
using System.Text.Json;

internal static class TelemetryServer
{
    public static async Task RunAsync(NetworkStream stream, CancellationToken stop)
    {
        using var sampler = new PerformanceSampler();
        Console.WriteLine("性能监控客户端已连接。");
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        do
        {
            var sample = await sampler.ReadAsync(stop);
            var data = JsonSerializer.SerializeToUtf8Bytes(sample);
            var header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, data.Length);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
            timeout.CancelAfter(TimeSpan.FromSeconds(2));
            await stream.WriteAsync(header, timeout.Token);
            await stream.WriteAsync(data, timeout.Token);
        } while (await timer.WaitForNextTickAsync(stop));
    }
}
