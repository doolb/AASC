using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using RemoteGamepad;

internal sealed class PowerClient
{
    private readonly string host, controlHost;
    private readonly int controlPort;
    private readonly object gate = new();
    private readonly SenderSettings settings;
    private byte[]? mac;
    private bool autoEnabled;
    public string MacText { get { lock (gate) return mac == null ? "未设置" : FormatMac(mac); } }
    public bool AutoEnabled { get { lock (gate) return autoEnabled; } }
    public PowerClient(string host, string controlHost, int controlPort, SenderSettings? settings = null)
    {
        this.host = host; this.controlHost = controlHost; this.controlPort = controlPort;
        this.settings = settings ?? new SenderSettings();
        var saved = this.settings.Get(host);
        if (saved.Mac != null && TryParseMac(saved.Mac, out var parsed)) mac = parsed;
        autoEnabled = saved.AutoSleep;
    }
    public void LearnMac()
    {
        if (MacText != "未设置" || !IPAddress.TryParse(host, out var address) || address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address)) return;
        try
        {
            var buffer = new byte[6]; int length = buffer.Length;
            if (SendARP(BitConverter.ToUInt32(address.GetAddressBytes(), 0), 0, buffer, ref length) == 0 && length == 6 && TryParseMac(FormatMac(buffer), out _))
                SetMac(FormatMac(buffer));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or System.ComponentModel.Win32Exception) { SenderLog.WriteLine($"MAC 自动获取失败: {ex.Message}"); }
    }
    public void SetMac(string text)
    {
        if (!TryParseMac(text, out var parsed)) throw new ArgumentException("MAC 地址应为 6 字节的单播地址，例如 30-9C-23-6D-0D-BE。");
        lock (gate)
        {
            settings.Update(host, value => value with { Mac = FormatMac(parsed) });
            mac = parsed;
        }
        SenderLog.WriteLine($"已保存 {host} 的唤醒 MAC: {FormatMac(parsed)}");
    }
    public void SetAutoEnabled(bool enabled)
    {
        lock (gate)
        {
            settings.Update(host, value => value with { AutoSleep = enabled });
            autoEnabled = enabled;
        }
        SenderLog.WriteLine(enabled ? "断线后 60 秒自动睡眠已开启。" : "断线后自动睡眠已关闭。");
    }
    internal static bool TryParseMac(string text, out byte[] bytes)
    {
        bytes = Array.Empty<byte>();
        string compact = text.Trim().Replace(":", "").Replace("-", "");
        if (compact.Length != 12) return false;
        try { bytes = Convert.FromHexString(compact); }
        catch (FormatException) { return false; }
        return (bytes[0] & 1) == 0 && bytes.Any(b => b != 0);
    }
    internal static string FormatMac(byte[] bytes) => string.Join("-", bytes.Select(b => b.ToString("X2")));
    internal static byte[] MagicPacket(byte[] mac)
    {
        if (mac.Length != 6 || (mac[0] & 1) != 0 || mac.All(b => b == 0)) throw new ArgumentException("Invalid MAC address");
        var packet = new byte[102]; Array.Fill(packet, (byte)0xff, 0, 6);
        for (int i = 0; i < 16; i++) mac.CopyTo(packet, 6 + 6 * i);
        return packet;
    }
    public async Task WakeAsync()
    {
        byte[]? target; lock (gate) target = mac?.ToArray();
        if (target == null) throw new InvalidOperationException("请先设置服务端有线网卡的 MAC 地址。");
        var packet = MagicPacket(target);
        var routes = new HashSet<(IPAddress source, IPAddress destination)>();
        if (IPAddress.TryParse(host, out var remote) && remote.AddressFamily == AddressFamily.InterNetwork)
        {
            byte[] address = remote.GetAddressBytes();
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up))
            foreach (var local in nic.GetIPProperties().UnicastAddresses.Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork && a.IPv4Mask != null))
            {
                byte[] ip = local.Address.GetAddressBytes(), mask = local.IPv4Mask!.GetAddressBytes();
                if (Enumerable.Range(0, 4).All(i => (ip[i] & mask[i]) == (address[i] & mask[i])))
                {
                    routes.Add((local.Address, IPAddress.Broadcast));
                    routes.Add((local.Address, new IPAddress(Enumerable.Range(0, 4).Select(i => (byte)(ip[i] | ~mask[i])).ToArray())));
                }
            }
        }
        // Bind to each matching local interface so the limited broadcast does not
        // accidentally leave through a VPN or a different network adapter.
        if (routes.Count == 0) routes.Add((IPAddress.Any, IPAddress.Broadcast));
        int sent = 0; Exception? last = null;
        // A few short retries help when an adapter or switch is still entering
        // its low-power state; both conventional WOL UDP ports use the same packet.
        for (int attempt = 0; attempt < 3; attempt++)
        {
            foreach (var group in routes.GroupBy(route => route.source))
            {
                try
                {
                    using var udp = new UdpClient(new IPEndPoint(group.Key, 0)) { EnableBroadcast = true };
                    foreach (var route in group)
                    foreach (int port in new[] { 9, 7 })
                        try { await udp.SendAsync(packet, packet.Length, new IPEndPoint(route.destination, port)); sent++; }
                        catch (SocketException ex) { last = ex; }
                }
                catch (SocketException ex) { last = ex; }
            }
            if (attempt < 2) await Task.Delay(150);
        }
        if (sent == 0) throw new IOException("唤醒包发送失败", last);
        SenderLog.WriteLine($"已发送 WOL 唤醒包到 {FormatMac(target)}（唤醒后自动重连）。");
    }
    public async Task SleepAsync(CancellationToken stop)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop); timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var client = new TcpClient { NoDelay = true };
        await client.ConnectAsync(controlHost, controlPort, timeout.Token);
        using var stream = client.GetStream();
        await stream.WriteAsync("VGW1"u8.ToArray(), timeout.Token);
        var response = new byte[1]; await stream.ReadFrameExactlyAsync(response, timeout.Token);
        if (response[0] == 2) throw new InvalidOperationException("服务端不支持睡眠状态。");
        if (response[0] == 3) throw new InvalidOperationException("服务端没有睡眠所需权限。");
        if (response[0] != 1) throw new InvalidDataException("服务端不支持睡眠指令，请更新服务端。");
        SenderLog.WriteLine("服务端已接受睡眠请求；连接可能很快断开。");
    }
    public async Task RunAutoAsync(CancellationToken stop)
    {
        while (!stop.IsCancellationRequested)
        {
            try
            {
                if (!AutoEnabled) { await Task.Delay(500, stop); continue; }
                await RunAutoSession(stop);
                if (AutoEnabled) await Task.Delay(2000, stop);
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception ex) when (ex is IOException or SocketException or InvalidOperationException or OperationCanceledException or ObjectDisposedException)
            {
                SenderLog.WriteLine($"自动电源连接中断: {ex.Message}");
                try { await Task.Delay(2000, stop); } catch (OperationCanceledException) { break; }
            }
        }
    }
    public async Task CancelPendingSleepAsync()
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        using var client = new TcpClient { NoDelay = true };
        await client.ConnectAsync(controlHost, controlPort, timeout.Token);
        using var stream = client.GetStream();
        await stream.WriteAsync("VGW3"u8.ToArray(), timeout.Token);
        var ack = new byte[1]; await stream.ReadFrameExactlyAsync(ack, timeout.Token);
        if (ack[0] != 1) throw new InvalidDataException("服务端未确认取消自动睡眠。");
        SenderLog.WriteLine("服务端已取消尚未执行的自动睡眠。");
    }
    private async Task RunAutoSession(CancellationToken stop)
    {
        using var client = new TcpClient { NoDelay = true };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop); timeout.CancelAfter(TimeSpan.FromSeconds(5));
        await client.ConnectAsync(controlHost, controlPort, timeout.Token);
        using var stream = client.GetStream();
        await stream.WriteAsync("VGW2"u8.ToArray(), timeout.Token);
        var reply = new byte[1]; await stream.ReadFrameExactlyAsync(reply, timeout.Token);
        if (reply[0] != 1) throw new InvalidDataException("服务端不支持自动电源，请更新两端。");
        SenderLog.WriteLine("自动电源已连接；断线 60 秒后服务端将睡眠。");
        try
        {
            while (!stop.IsCancellationRequested && AutoEnabled)
            {
                using var write = CancellationTokenSource.CreateLinkedTokenSource(stop); write.CancelAfter(TimeSpan.FromSeconds(3));
                await stream.WriteAsync(new byte[] { 1 }, write.Token);
                await Task.Delay(500, stop);
            }
        }
        catch (OperationCanceledException) when (stop.IsCancellationRequested) { }
        finally
        {
            if (!AutoEnabled)
            {
                using var disarm = new CancellationTokenSource(TimeSpan.FromSeconds(2));
                await stream.WriteAsync(new byte[] { 0 }, disarm.Token);
                var ack = new byte[1]; await stream.ReadFrameExactlyAsync(ack, disarm.Token);
                if (ack[0] != 0) throw new InvalidDataException("服务端未确认关闭自动睡眠。");
            }
        }
    }
    [DllImport("iphlpapi.dll")] private static extern int SendARP(uint destination, uint source, byte[] mac, ref int length);
}
