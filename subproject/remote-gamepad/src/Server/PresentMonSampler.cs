using System.Diagnostics;
using System.Globalization;

internal sealed class PresentMonSampler : IDisposable
{
    private readonly object gate = new();
    private readonly Dictionary<(uint pid, string chain), Queue<(long time, double ms)>> samples = new();
    private Process? process;
    private readonly string executablePath;
    private readonly string sessionName = $"RemoteGamepad_{Environment.ProcessId}_{Guid.NewGuid():N}";
    private uint foreground;
    private HashSet<uint> targetProcesses = new();
    private string status = "等待前台或其子进程呈现";
    private bool disposed;

    public PresentMonSampler()
    {
        string? configured = Environment.GetEnvironmentVariable("REMOTE_GAMEPAD_PRESENTMON");
        executablePath = string.IsNullOrWhiteSpace(configured) ? Path.Combine(AppContext.BaseDirectory, "PresentMon.exe") : configured;
        if (!File.Exists(executablePath)) { status = "未找到 PresentMon.exe"; return; }
        try
        {
            var info = new ProcessStartInfo(executablePath) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            foreach (var argument in new[] { "--output_stdout", "--no_console_stats", "--v1_metrics", "--exclude_dropped", "--no_track_gpu", "--no_track_input", "--stop_existing_session", "--session_name", sessionName })
                info.ArgumentList.Add(argument);
            process = Process.Start(info);
            if (process == null) { status = "无法启动 PresentMon"; return; }
            _ = ReadOutput(process);
            _ = DrainErrors(process);
        }
        catch (Exception ex) when (ex is System.ComponentModel.Win32Exception or InvalidOperationException or IOException)
        { status = "PresentMon 启动失败"; }
    }

    public void SetForeground(uint pid, IEnumerable<uint>? descendants = null)
    {
        lock (gate)
        {
            if (foreground != pid) { foreground = pid; samples.Clear(); }
            targetProcesses = descendants == null ? new HashSet<uint>() : new HashSet<uint>(descendants);
            if (pid != 0) targetProcesses.Add(pid);
            foreach (var key in samples.Keys.Where(key => !targetProcesses.Contains(key.pid)).ToArray()) samples.Remove(key);
        }
    }

    public (double? fps, string status) Read()
    {
        lock (gate)
        {
            long cutoff = Stopwatch.GetTimestamp() - 2 * Stopwatch.Frequency;
            var candidates = new List<((uint pid, string chain) key, Queue<(long time, double ms)> queue)>();
            foreach (var (key, queue) in samples)
            {
                while (queue.Count > 0 && queue.Peek().time < cutoff) queue.Dequeue();
                if (queue.Count > 0) candidates.Add((key, queue));
            }
            if (candidates.Count == 0) return (null, status);
            var selected = candidates.Where(q => q.key.pid == foreground).DefaultIfEmpty().MaxBy(q => q.queue?.Count ?? -1);
            if (selected.queue == null) selected = candidates.MaxBy(q => q.queue.Count);
            double total = selected.queue.Sum(v => v.ms);
            return total > 0 ? (Math.Clamp(1000.0 * selected.queue.Count / total, 0, 10000), selected.key.pid == foreground ? "前台进程" : "前台子进程") : (null, status);
        }
    }

    private async Task ReadOutput(Process source)
    {
        try
        {
            int pidColumn = -1, chainColumn = -1, timeColumn = -1;
            while (await source.StandardOutput.ReadLineAsync() is { } line)
            {
                var fields = ParseCsv(line);
                if (pidColumn < 0)
                {
                    pidColumn = fields.FindIndex(s => s.Equals("ProcessID", StringComparison.OrdinalIgnoreCase));
                    chainColumn = fields.FindIndex(s => s.Equals("SwapChainAddress", StringComparison.OrdinalIgnoreCase));
                    timeColumn = fields.FindIndex(s => s.Equals("msBetweenPresents", StringComparison.OrdinalIgnoreCase));
                    if (pidColumn < 0 || chainColumn < 0 || timeColumn < 0) { pidColumn = -1; continue; }
                    continue;
                }
                if (fields.Count <= Math.Max(pidColumn, Math.Max(chainColumn, timeColumn)) ||
                    !uint.TryParse(fields[pidColumn], out uint pid) ||
                    !double.TryParse(fields[timeColumn], NumberStyles.Float, CultureInfo.InvariantCulture, out double ms) ||
                    !double.IsFinite(ms) || ms <= 0 || ms > 10000) continue;
                lock (gate)
                {
                    if (!targetProcesses.Contains(pid) || foreground == 0) continue;
                    var key = (pid, fields[chainColumn]);
                    if (!samples.TryGetValue(key, out var queue))
                    {
                        if (samples.Count >= 32) samples.Clear();
                        samples[key] = queue = new();
                    }
                    long now = Stopwatch.GetTimestamp();
                    queue.Enqueue((now, ms));
                    while (queue.Count > 2048 || (queue.Count > 0 && queue.Peek().time < now - 2 * Stopwatch.Frequency)) queue.Dequeue();
                }
            }
        }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException) { }
        finally { lock (gate) { if (!disposed) status = "PresentMon 已退出，请检查权限"; samples.Clear(); } }
    }

    private static async Task DrainErrors(Process source)
    {
        try { while (await source.StandardError.ReadLineAsync() != null) { } }
        catch (Exception ex) when (ex is IOException or ObjectDisposedException or InvalidOperationException) { }
    }
    internal static List<string> ParseCsv(string line)
    {
        var fields = new List<string>(); var text = new System.Text.StringBuilder(); bool quoted = false;
        for (int i = 0; i < line.Length; i++)
        {
            char c = line[i];
            if (c == '"') { if (quoted && i + 1 < line.Length && line[i + 1] == '"') { text.Append('"'); i++; } else quoted = !quoted; }
            else if (c == ',' && !quoted) { fields.Add(text.ToString()); text.Clear(); }
            else text.Append(c);
        }
        fields.Add(text.ToString()); return fields;
    }
    public void Dispose()
    {
        lock (gate) disposed = true;
        if (process == null) return;
        // PresentMon's ETW session outlives a forcibly killed consumer. Stop only
        // the session uniquely named for this server process before cleanup.
        try
        {
            var info = new ProcessStartInfo(executablePath) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            info.ArgumentList.Add("--terminate_existing_session"); info.ArgumentList.Add("--session_name"); info.ArgumentList.Add(sessionName);
            using var terminator = Process.Start(info);
            if (terminator != null && !terminator.WaitForExit(1500)) terminator.Kill(true);
        }
        catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception or IOException) { }
        try { if (!process.HasExited) process.Kill(true); } catch (Exception ex) when (ex is InvalidOperationException or System.ComponentModel.Win32Exception) { }
        process.Dispose(); process = null;
    }
}
