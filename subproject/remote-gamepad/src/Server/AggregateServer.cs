using System.Net;
using System.Net.Sockets;
using RemoteGamepad;

internal static class AggregateServer
{
    public static async Task RunAsync(IPAddress address, int aggregatePort, int controlPort, CancellationToken stop)
    {
        var listener = new TcpListener(address, aggregatePort);
        var target = address.Equals(IPAddress.Any) ? IPAddress.Loopback :
            address.Equals(IPAddress.IPv6Any) ? IPAddress.IPv6Loopback : address;
        try
        {
            listener.Start();
            Console.WriteLine($"聚合监听 {address}:{aggregatePort}（控制与音频）");
            while (!stop.IsCancellationRequested)
            {
                using var peer = await listener.AcceptTcpClientAsync(stop);
                try
                {
                    peer.NoDelay = true;
                    using var handshake = CancellationTokenSource.CreateLinkedTokenSource(stop);
                    handshake.CancelAfter(TimeSpan.FromSeconds(3));
                    var stream = peer.GetStream(); var magic = new byte[4];
                    await stream.ReadFrameExactlyAsync(magic, handshake.Token);
                    if (!magic.AsSpan().SequenceEqual("VGM2"u8)) throw new InvalidDataException("聚合协议不匹配，请同时更新两端");
                    await stream.WriteAsync(new byte[] { 1 }, handshake.Token);
                    using var session = new MultiplexSession(peer, async (kind, cancellation) =>
                    {
                        var local = new TcpClient(target.AddressFamily) { NoDelay = true };
                        try { await local.ConnectAsync(target, kind == MultiplexSession.Audio ? controlPort + 1 : controlPort, cancellation); return local; }
                        catch { local.Dispose(); throw; }
                    });
                    Console.WriteLine("聚合客户端已连接。");
                    await session.RunAsync(stop);
                }
                catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
                catch (Exception ex) { Console.WriteLine($"聚合连接结束: {ex.Message}"); }
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        catch (Exception ex) { Console.WriteLine($"聚合服务不可用: {ex.Message}"); }
        finally { listener.Stop(); }
    }
}
