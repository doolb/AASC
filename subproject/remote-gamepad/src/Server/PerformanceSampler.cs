using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using RemoteGamepad;

internal sealed class PerformanceSampler : IDisposable
{
    private ulong? previousIdle, previousKernel, previousUser;
    private readonly PresentMonSampler fps = new();
    private readonly RtssSampler rtss = new();
    private readonly GpuCounters counters = new();

    public async Task<TelemetrySample> ReadAsync(CancellationToken stop)
    {
        double? cpu = null;
        if (GetSystemTimes(out var idleTime, out var kernelTime, out var userTime))
        {
            ulong idle = ToUInt64(idleTime), kernel = ToUInt64(kernelTime), user = ToUInt64(userTime);
            if (previousIdle is ulong pi && previousKernel is ulong pk && previousUser is ulong pu && idle >= pi && kernel >= pk && user >= pu)
            {
                ulong total = (kernel - pk) + (user - pu);
                if (total > 0) cpu = Math.Clamp(100.0 * (1 - (double)(idle - pi) / total), 0, 100);
            }
            previousIdle = idle; previousKernel = kernel; previousUser = user;
        }
        var memory = new MemoryStatus { Length = (uint)Marshal.SizeOf<MemoryStatus>() };
        bool memoryOk = GlobalMemoryStatusEx(ref memory);
        uint pid = 0;
        var foreground = GetForegroundWindow();
        if (foreground != IntPtr.Zero) GetWindowThreadProcessId(foreground, out pid);
        string? name = null;
        if (pid != 0) try { using var process = Process.GetProcessById((int)pid); name = process.ProcessName; } catch (Exception ex) when (ex is ArgumentException or InvalidOperationException or System.ComponentModel.Win32Exception) { }
        var descendants = ProcessTree.Descendants(pid);
        fps.SetForeground(pid, descendants);
        var (rate, fpsStatus) = fps.Read();
        var (rtssRate, rtssSource) = rtss.Read(pid, descendants);
        if (rtssRate != null) { rate = rtssRate; fpsStatus = rtssSource!; }
        var gpu = await ReadNvidiaAsync(stop);
        if (gpu == null)
        {
            var (usage, used) = counters.Read();
            gpu = (usage, used, null, "Windows GPU 引擎峰值", null);
        }
        var (cpuWatts, gpuWatts) = PowerSampler.Instance.Read(gpu.Value.name == "Windows GPU 引擎峰值" ? null : gpu.Value.name);
        return new(DateTime.UtcNow, cpu, memoryOk ? memory.TotalPhysical - memory.AvailablePhysical : null,
            memoryOk ? memory.TotalPhysical : null, gpu.Value.usage, gpu.Value.used, gpu.Value.total,
            gpu.Value.name, name, pid == 0 ? null : pid, rate, fpsStatus, cpuWatts, gpu.Value.power ?? gpuWatts);
    }

    private static async Task<(double? usage, ulong? used, ulong? total, string? name, double? power)?> ReadNvidiaAsync(CancellationToken stop)
    {
        string path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "nvidia-smi.exe");
        if (!File.Exists(path)) return null;
        using var process = new Process { StartInfo = new ProcessStartInfo(path)
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            Arguments = "--query-gpu=name,utilization.gpu,memory.used,memory.total,power.draw --format=csv,noheader,nounits"
        } };
        try
        {
            if (!process.Start()) return null;
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stop);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(900));
            var output = process.StandardOutput.ReadToEndAsync();
            var error = process.StandardError.ReadToEndAsync();
            try { await process.WaitForExitAsync(timeout.Token); }
            catch (OperationCanceledException) { if (!process.HasExited) process.Kill(true); if (stop.IsCancellationRequested) throw; return null; }
            await error;
            if (process.ExitCode != 0) return null;
            var first = (await output).Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault();
            var parts = first?.Split(',').Select(s => s.Trim()).ToArray();
            if (parts?.Length != 5 || !double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var usage) ||
                !ulong.TryParse(parts[2], out var used) || !ulong.TryParse(parts[3], out var total)) return null;
            double? power = double.TryParse(parts[4], NumberStyles.Float, CultureInfo.InvariantCulture, out double watts) && double.IsFinite(watts) && watts >= 0 ? watts : null;
            return (Math.Clamp(usage, 0, 100), used * 1024 * 1024, total * 1024 * 1024, parts[0], power);
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or IOException or InvalidOperationException) { return null; }
    }

    public void Dispose() { fps.Dispose(); counters.Dispose(); }
    private static ulong ToUInt64(System.Runtime.InteropServices.ComTypes.FILETIME value) => ((ulong)(uint)value.dwHighDateTime << 32) | (uint)value.dwLowDateTime;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)] private struct MemoryStatus
    {
        public uint Length, MemoryLoad;
        public ulong TotalPhysical, AvailablePhysical, TotalPageFile, AvailablePageFile, TotalVirtual, AvailableVirtual, AvailableExtendedVirtual;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetSystemTimes(out System.Runtime.InteropServices.ComTypes.FILETIME idle, out System.Runtime.InteropServices.ComTypes.FILETIME kernel, out System.Runtime.InteropServices.ComTypes.FILETIME user);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
}
