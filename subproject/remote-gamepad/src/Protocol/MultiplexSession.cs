using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net.Sockets;
using System.Threading.Channels;

namespace RemoteGamepad;

// One ordered TCP connection carries independent byte streams. The client opens
// streams; the server maps kinds to gamepad, keyboard/mouse, audio and telemetry.
public sealed class MultiplexSession : IDisposable
{
    public const byte Gamepad = 1, Keyboard = 2, Audio = 3, Metrics = 4;
    private const byte Open = 1, Data = 2, Close = 3;
    private const int HeaderSize = 8, MaxPayload = 8192, MaxStreams = 12;
    private readonly TcpClient transport;
    private readonly NetworkStream stream;
    private readonly Func<byte, CancellationToken, Task<TcpClient>>? connectTarget;
    private readonly ConcurrentDictionary<uint, Bridge> bridges = new();
    private readonly SemaphoreSlim writeGate = new(1, 1);
    private readonly CancellationTokenSource stopped = new();
    private int nextId, disposed;

    public MultiplexSession(TcpClient transport, Func<byte, CancellationToken, Task<TcpClient>>? connectTarget = null)
    {
        this.transport = transport;
        this.connectTarget = connectTarget;
        transport.NoDelay = true;
        stream = transport.GetStream();
    }

    public async Task OpenLocalAsync(byte kind, TcpClient local)
    {
        if (connectTarget != null || kind is < Gamepad or > Metrics || bridges.Count >= MaxStreams)
        { local.Dispose(); throw new InvalidOperationException("无法打开聚合通道"); }
        uint id = unchecked((uint)Interlocked.Increment(ref nextId));
        if (id == 0) { local.Dispose(); throw new InvalidOperationException("聚合通道编号耗尽"); }
        var bridge = new Bridge(this, id, kind, local);
        if (!bridges.TryAdd(id, bridge)) { local.Dispose(); throw new InvalidOperationException("聚合通道编号冲突"); }
        try { await SendFrame(Open, kind, id, ReadOnlyMemory<byte>.Empty); bridge.Start(); }
        catch { CloseBridge(id, false); throw; }
    }

    public async Task RunAsync(CancellationToken cancellation)
    {
        using var stop = CancellationTokenSource.CreateLinkedTokenSource(cancellation, stopped.Token);
        try
        {
            var header = new byte[HeaderSize];
            while (true)
            {
                await stream.ReadFrameExactlyAsync(header, stop.Token);
                byte type = header[0], kind = header[1];
                uint id = BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(2));
                int length = BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(6));
                if (id == 0 || kind is < Gamepad or > Metrics || length > MaxPayload ||
                    (type != Data && length != 0) || type is < Open or > Close || (type == Data && length == 0))
                    throw new InvalidDataException("无效的聚合帧");
                byte[] payload = new byte[length];
                if (length != 0) await stream.ReadFrameExactlyAsync(payload, stop.Token);
                if (type == Open)
                {
                    if (connectTarget == null || bridges.ContainsKey(id) || bridges.Count >= MaxStreams) throw new InvalidDataException("无效的聚合通道");
                    try
                    {
                        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop.Token);
                        timeout.CancelAfter(TimeSpan.FromSeconds(2));
                        var local = await connectTarget(kind, timeout.Token);
                        var bridge = new Bridge(this, id, kind, local);
                        if (!bridges.TryAdd(id, bridge)) { local.Dispose(); throw new InvalidDataException("重复的聚合通道"); }
                        bridge.Start();
                    }
                    catch (Exception ex) when (ex is SocketException or IOException or OperationCanceledException)
                    { await SendFrame(Close, kind, id, ReadOnlyMemory<byte>.Empty); }
                }
                else if (bridges.TryGetValue(id, out var bridge))
                {
                    if (bridge.Kind != kind) throw new InvalidDataException("聚合通道类型不匹配");
                    if (type == Close) CloseBridge(id, false);
                    else if (!bridge.Inbound.Writer.TryWrite(payload)) CloseBridge(id, true);
                }
            }
        }
        finally { Dispose(); }
    }

    private async Task SendFrame(byte type, byte kind, uint id, ReadOnlyMemory<byte> payload)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopped.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(2));
        try
        {
            await writeGate.WaitAsync(timeout.Token);
            try
            {
                var frame = new byte[HeaderSize + payload.Length];
                frame[0] = type; frame[1] = kind;
                BinaryPrimitives.WriteUInt32LittleEndian(frame.AsSpan(2), id);
                BinaryPrimitives.WriteUInt16LittleEndian(frame.AsSpan(6), (ushort)payload.Length);
                payload.CopyTo(frame.AsMemory(HeaderSize));
                await stream.WriteAsync(frame, timeout.Token);
            }
            finally { writeGate.Release(); }
        }
        catch { Dispose(); throw; }
    }

    private void CloseBridge(uint id, bool notify)
    {
        if (!bridges.TryRemove(id, out var bridge)) return;
        bridge.Inbound.Writer.TryComplete();
        bridge.Local.Dispose();
        if (notify && !stopped.IsCancellationRequested) _ = NotifyClosed(bridge);
    }
    private async Task NotifyClosed(Bridge bridge)
    {
        try { await SendFrame(Close, bridge.Kind, bridge.Id, ReadOnlyMemory<byte>.Empty); } catch { }
    }
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        stopped.Cancel(); transport.Dispose();
        foreach (uint id in bridges.Keys) CloseBridge(id, false);
    }

    private sealed class Bridge
    {
        private readonly MultiplexSession owner;
        public readonly uint Id;
        public readonly byte Kind;
        public readonly TcpClient Local;
        public readonly Channel<byte[]> Inbound = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(32)
        { FullMode = BoundedChannelFullMode.Wait, SingleReader = true, SingleWriter = true });
        public Bridge(MultiplexSession owner, uint id, byte kind, TcpClient local)
        { this.owner = owner; Id = id; Kind = kind; Local = local; local.NoDelay = true; }
        public void Start() { _ = ReadLocal(); _ = WriteLocal(); }
        private async Task ReadLocal()
        {
            try
            {
                var local = Local.GetStream(); var buffer = new byte[MaxPayload];
                while (true)
                {
                    int count = await local.ReadAsync(buffer, owner.stopped.Token);
                    if (count == 0) break;
                    await owner.SendFrame(Data, Kind, Id, buffer.AsMemory(0, count));
                }
            }
            catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
            finally { owner.CloseBridge(Id, true); }
        }
        private async Task WriteLocal()
        {
            try
            {
                var local = Local.GetStream();
                await foreach (var bytes in Inbound.Reader.ReadAllAsync(owner.stopped.Token))
                {
                    using var timeout = CancellationTokenSource.CreateLinkedTokenSource(owner.stopped.Token);
                    timeout.CancelAfter(TimeSpan.FromSeconds(2));
                    await local.WriteAsync(bytes, timeout.Token);
                }
            }
            catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException) { }
            finally { owner.CloseBridge(Id, true); }
        }
    }
}
