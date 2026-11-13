namespace RemoteGamepad;

public sealed record TelemetrySample(
    DateTime TimestampUtc, double? CpuPercent, ulong? MemoryUsedBytes, ulong? MemoryTotalBytes,
    double? GpuPercent, ulong? GpuMemoryUsedBytes, ulong? GpuMemoryTotalBytes,
    string? GpuName, string? ForegroundApp, uint? ForegroundPid, double? ForegroundFps, string? FpsStatus,
    double? CpuPowerWatts = null, double? GpuPowerWatts = null);
