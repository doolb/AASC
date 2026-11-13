using System.Diagnostics;
using System.IO.MemoryMappedFiles;

// RTSS SDK's v2 shared-memory header provides the entry size and array offset.
// Open read-only and never inject into or change the observed process.
internal sealed class RtssSampler
{
    private readonly string mappingName;
    private readonly Dictionary<uint, ((uint start, uint end, uint frames) value, long changed)> observations = new();
    private uint foreground;

    public RtssSampler(string mappingName = "RTSSSharedMemoryV2") => this.mappingName = mappingName;

    public (double? fps, string? source) Read(uint pid, IEnumerable<uint> descendants)
    {
        if (foreground != pid) { foreground = pid; observations.Clear(); }
        if (pid == 0 || !OperatingSystem.IsWindows()) return (null, null);
        var targets = new HashSet<uint>(descendants) { pid };
        try
        {
            using var mapping = MemoryMappedFile.OpenExisting(mappingName, MemoryMappedFileRights.Read);
            using var view = mapping.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
            if (view.Capacity < 20 || view.ReadUInt32(0) != 0x52545353 || (view.ReadUInt32(4) >> 16) != 2) return (null, null);
            uint entrySize = view.ReadUInt32(8), offset = view.ReadUInt32(12), count = view.ReadUInt32(16);
            if (entrySize < 284 || count > 4096 || (ulong)offset + (ulong)entrySize * count > (ulong)view.Capacity) return (null, null);
            long now = Stopwatch.GetTimestamp();
            (double? fps, string? source) child = (null, null);
            for (uint i = 0; i < count; i++)
            {
                long pos = (long)offset + (long)i * entrySize;
                uint processId = view.ReadUInt32(pos);
                if (!targets.Contains(processId)) continue;
                var value = (start: view.ReadUInt32(pos + 268), end: view.ReadUInt32(pos + 272), frames: view.ReadUInt32(pos + 276));
                if (!observations.TryGetValue(processId, out var prior))
                {
                    observations[processId] = (value, 0);
                    continue; // Wait for a fresh sample rather than displaying an old entry.
                }
                long changed = prior.value != value ? now : prior.changed;
                observations[processId] = (value, changed);
                uint elapsed = unchecked(value.end - value.start);
                if (changed == 0 || now - changed > 3 * Stopwatch.Frequency || value.start == 0 || elapsed == 0 || elapsed > 10000 || value.frames == 0) continue;
                double fps = 1000.0 * value.frames / elapsed;
                if (!double.IsFinite(fps) || fps <= 0 || fps > 10000) continue;
                if (processId == pid) return (fps, "RTSS");
                child = (fps, "RTSS 子进程");
            }
            return child;
        }
        catch (Exception ex) when (ex is FileNotFoundException or IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            observations.Clear();
            return (null, null);
        }
    }
}
