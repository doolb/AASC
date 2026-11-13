using System.ComponentModel;
using System.Runtime.InteropServices;

internal static class PowerServer
{
    internal static async Task HandleAutoAsync(Stream stream, CancellationToken stop, AutoSleepCoordinator coordinator)
    {
        bool disarmed = false;
        coordinator.Connect();
        try
        {
            await stream.WriteAsync(new byte[] { 1 }, stop);
            var message = new byte[1];
            while (true)
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop); timeout.CancelAfter(TimeSpan.FromSeconds(8));
                int count = await stream.ReadAsync(message, timeout.Token);
                if (count == 0) break;
                if (message[0] == 0) { disarmed = true; await stream.WriteAsync(new byte[] { 0 }, stop); break; }
                if (message[0] != 1) throw new InvalidDataException("未知自动电源指令");
            }
        }
        finally { coordinator.Disconnect(disarmed); }
    }
    internal static async Task SleepAfterDisconnect()
    {
        byte result = Prepare();
        if (result != 1) { Console.WriteLine(result == 2 ? "自动睡眠失败：设备不支持睡眠。" : "自动睡眠失败：权限不足。"); return; }
        Console.WriteLine("自动睡眠倒计时结束，正在睡眠。");
        int error = await Task.Run(Suspend);
        if (error != 0) Console.WriteLine($"自动睡眠失败: {new Win32Exception(error).Message}");
        else Console.WriteLine("服务端已从自动睡眠恢复。");
    }
    internal static async Task HandleAsync(Stream stream, CancellationToken stop, Func<byte>? prepare = null, Func<int>? suspend = null, AutoSleepCoordinator? coordinator = null)
    {
        // 1 means accepted, not that sleep has already succeeded.
        byte result = (prepare ?? Prepare)();
        if (result == 1) coordinator?.BeginManualSleep();
        try
        {
            await stream.WriteAsync(new byte[] { result }, stop);
            if (result != 1) return;
            Console.WriteLine("收到睡眠请求。");
            await Task.Delay(400, stop); // Give the acknowledgement time to reach the client.
            int error = await Task.Run(suspend ?? Suspend, stop);
            if (error != 0) Console.WriteLine($"服务端睡眠失败: {new Win32Exception(error).Message}");
            else Console.WriteLine("服务端已从睡眠恢复。");
        }
        finally { if (result == 1) coordinator?.EndManualSleep(); }
    }

    private static byte Prepare()
    {
        if (!OpenProcessToken(GetCurrentProcess(), 0x20 | 0x8, out var token)) return 3;
        try
        {
            if (!LookupPrivilegeValue(null, "SeShutdownPrivilege", out var luid)) return 3;
            var privileges = new TokenPrivileges { Count = 1, Luid = luid, Attributes = 2 };
            SetLastError(0);
            return AdjustTokenPrivileges(token, false, ref privileges, 0, IntPtr.Zero, IntPtr.Zero) && Marshal.GetLastWin32Error() == 0 ? (byte)1 : (byte)3;
        }
        finally { CloseHandle(token); }
    }
    private static int Suspend() => SetSuspendState(false, false, false) ? 0 : Marshal.GetLastWin32Error() is int e && e != 0 ? e : 1;
    [StructLayout(LayoutKind.Sequential)] private struct Luid { public uint LowPart; public int HighPart; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenPrivileges { public uint Count; public Luid Luid; public uint Attributes; }
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern void SetLastError(uint error);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool LookupPrivilegeValue(string? system, string name, out Luid luid);
    [DllImport("advapi32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool AdjustTokenPrivileges(IntPtr token, [MarshalAs(UnmanagedType.Bool)] bool disableAll, ref TokenPrivileges newState, uint length, IntPtr previous, IntPtr returned);
    [DllImport("powrprof.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.U1)] private static extern bool SetSuspendState([MarshalAs(UnmanagedType.U1)] bool hibernate, [MarshalAs(UnmanagedType.U1)] bool force, [MarshalAs(UnmanagedType.U1)] bool disableWake);
}
