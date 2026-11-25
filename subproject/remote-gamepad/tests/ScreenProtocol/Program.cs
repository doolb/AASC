using System.Buffers.Binary;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

// 用可控截图替身验证实际画面监听器，不依赖 Windows 桌面。
using var reserve = new TcpListener(IPAddress.Loopback, 0);
reserve.Start();
int port = ((IPEndPoint)reserve.LocalEndpoint).Port;
reserve.Stop();
using var stop = new CancellationTokenSource();
var server = ScreenServer.RunAsync(IPAddress.Loopback, port, stop.Token);
try
{
    await Run("{\"type\":\"snapshot\",\"quality\":42,\"encoder\":\"cpu\"}", "frame");
    await Run("{\"type\":\"snapshot\",\"quality\":101,\"encoder\":\"cpu\"}", "error");
    await Run("{\"type\":\"snapshot\",\"quality\":85,\"encoder\":\"gpu\"}", "error");
    await Run("{\"type\":\"video\",\"quality\":85,\"encoder\":\"cpu\"}", "error");
    Console.WriteLine("画面协议监听、能力、截图和错误分支通过。");
}
finally { stop.Cancel(); await server; }

async Task Run(string request, string expected)
{
    using var tcp = new TcpClient();
    await tcp.ConnectAsync(IPAddress.Loopback, port);
    var stream = tcp.GetStream();
    await stream.WriteAsync("VDF1"u8.ToArray());
    using var caps = await ReadJson(stream);
    if (caps.RootElement.GetProperty("version").GetInt32() != 1 || caps.RootElement.GetProperty("gpu").GetBoolean()) throw new Exception("能力响应错误");
    var payload = Encoding.UTF8.GetBytes(request);
    var header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, payload.Length);
    await stream.WriteAsync(header); await stream.WriteAsync(payload);
    using var response = await ReadJson(stream);
    if (response.RootElement.GetProperty("type").GetString() != expected) throw new Exception("响应类型错误");
    if (expected == "frame")
    {
        var root = response.RootElement;
        int length = root.GetProperty("length").GetInt32();
        var jpeg = new byte[length]; await stream.ReadExactlyAsync(jpeg);
        if (root.GetProperty("width").GetInt32() != 2 || !jpeg.SequenceEqual(new byte[] { 255, 216, 255, 217 })) throw new Exception("图片数据错误");
    }
}

static async Task<JsonDocument> ReadJson(NetworkStream stream)
{
    var header = new byte[4]; await stream.ReadExactlyAsync(header);
    int length = BinaryPrimitives.ReadInt32LittleEndian(header);
    var data = new byte[length]; await stream.ReadExactlyAsync(data);
    return JsonDocument.Parse(data);
}

internal static class GdiCapture
{
    internal sealed record Frame(byte[] Data, int Width, int Height);
    public static Frame Capture(int quality) => quality == 42 ? new Frame(new byte[] { 255, 216, 255, 217 }, 2, 3) : throw new Exception("画质未正确传递");
}
