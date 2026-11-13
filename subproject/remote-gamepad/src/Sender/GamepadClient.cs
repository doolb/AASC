using System.Net.Sockets;
using System.Runtime.InteropServices;
using RemoteGamepad;

internal static class GamepadClient
{
    public static async Task RunAsync(string connectHost, int controlPort, string displayHost, int displayPort, uint index, AggregateClient? proxy, CancellationToken stop, IGamepadDevice? device = null)
    {
        device ??= new XInputDevice();
        while (!stop.IsCancellationRequested)
        {
            try
            {
                if (proxy != null) await proxy.WaitUntilConnectedAsync(stop);
                using var client = new TcpClient { NoDelay = true };
                using var connectTimeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
                connectTimeout.CancelAfter(TimeSpan.FromSeconds(5));
                await client.ConnectAsync(connectHost, controlPort, connectTimeout.Token);
                using var stream = client.GetStream();
                await stream.WriteAsync(Report.Magic.ToArray(), stop);
                SenderLog.WriteLine($"已连接 {displayHost}:{displayPort}，读取手柄 {index}。");
                using var session = CancellationTokenSource.CreateLinkedTokenSource(stop);
                Task input = SendInput(stream, index, device, session.Token);
                Task feedback = ReceiveFeedback(stream, index, device, session.Token);
                try { await await Task.WhenAny(input, feedback); }
                finally
                {
                    session.Cancel(); client.Close();
                    try { await Task.WhenAll(input, feedback); } catch { }
                    device.SetMotors(index, 0, 0);
                }
            }
            catch (OperationCanceledException) when (stop.IsCancellationRequested) { break; }
            catch (Exception ex) when (ex is IOException or SocketException or OperationCanceledException or ObjectDisposedException)
            {
                SenderLog.WriteLine($"连接中断: {ex.Message}；2 秒后重试。");
                try { await Task.Delay(2000, stop); } catch (OperationCanceledException) { break; }
            }
        }
    }
    private static async Task SendInput(NetworkStream stream, uint index, IGamepadDevice device, CancellationToken stop)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMilliseconds(16));
        var data = new byte[Report.Size]; bool? connected = null;
        do
        {
            bool present = device.TryRead(index, out var report);
            if (connected != present) { SenderLog.WriteLine(present ? "手柄已连接" : "手柄未连接，发送中性状态"); connected = present; }
            if (!present) report = default;
            report.Write(data);
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop); timeout.CancelAfter(TimeSpan.FromSeconds(1));
            await stream.WriteAsync(data, timeout.Token);
        } while (await timer.WaitForNextTickAsync(stop));
    }
    private static async Task ReceiveFeedback(NetworkStream stream, uint index, IGamepadDevice device, CancellationToken stop)
    {
        var data = new byte[2];
        while (true)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop); timeout.CancelAfter(TimeSpan.FromSeconds(1));
            await stream.ReadFrameExactlyAsync(data, timeout.Token);
            device.SetMotors(index, data[0], data[1]);
        }
    }
}

internal interface IGamepadDevice
{
    bool TryRead(uint index, out Report report);
    void SetMotors(uint index, byte large, byte small);
}

internal sealed class XInputDevice : IGamepadDevice
{
    public bool TryRead(uint index, out Report report)
    {
        bool present = XInput.GetState(index, out var state) == 0;
        var g = state.Gamepad;
        report = present ? new Report(g.Buttons, g.LeftTrigger, g.RightTrigger, g.LeftX, g.LeftY, g.RightX, g.RightY) : default;
        return present;
    }
    public void SetMotors(uint index, byte large, byte small) => XInput.SetMotors(index, large, small);
}

internal static class XInput
{
    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")] public static extern uint GetState(uint index, out State state);
    [DllImport("xinput1_4.dll", EntryPoint = "XInputSetState")] private static extern uint SetState(uint index, ref Vibration vibration);
    public static void SetMotors(uint index, byte large, byte small)
    {
        var vibration = new Vibration { LeftMotor = (ushort)(large * 257), RightMotor = (ushort)(small * 257) };
        SetState(index, ref vibration);
    }
    [StructLayout(LayoutKind.Sequential)] public struct State { public uint Packet; public Gamepad Gamepad; }
    [StructLayout(LayoutKind.Sequential)] public struct Gamepad
    {
        public ushort Buttons; public byte LeftTrigger, RightTrigger; public short LeftX, LeftY, RightX, RightY;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Vibration { public ushort LeftMotor, RightMotor; }
}
