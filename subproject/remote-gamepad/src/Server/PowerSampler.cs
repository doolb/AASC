using LibreHardwareMonitor.Hardware;

// One hardware monitor is shared by all telemetry connections so reconnecting
// does not repeatedly initialize low-level hardware access.
internal sealed class PowerSampler
{
    private static readonly Lazy<PowerSampler> instance = new(() => new PowerSampler());
    private readonly object gate = new();
    private readonly Computer? computer;
    public static PowerSampler Instance => instance.Value;

    private PowerSampler()
    {
        try
        {
            var monitor = new Computer { IsCpuEnabled = true, IsGpuEnabled = true };
            try { monitor.Open(); }
            catch { monitor.Close(); throw; }
            computer = monitor;
            AppDomain.CurrentDomain.ProcessExit += (_, _) => { try { monitor.Close(); } catch { } };
        }
        catch (Exception) { computer = null; } // Hardware access is optional; keep telemetry working.
    }

    public (double? cpuWatts, double? gpuWatts) Read(string? gpuName)
    {
        lock (gate)
        {
            if (computer == null) return (null, null);
            double? cpu = null, gpu = null;
            foreach (var hardware in computer.Hardware)
            {
                try
                {
                    hardware.Update();
                    if (hardware.HardwareType == HardwareType.Cpu)
                    {
                        var sensor = hardware.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Power &&
                            (s.Name.Equals("CPU Package", StringComparison.OrdinalIgnoreCase) || s.Name.Equals("Package", StringComparison.OrdinalIgnoreCase)));
                        if (Valid(sensor?.Value) is double value) cpu = (cpu ?? 0) + value;
                    }
                    else if (hardware.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd or HardwareType.GpuIntel &&
                        (gpuName == null || hardware.Name.Equals(gpuName, StringComparison.OrdinalIgnoreCase)))
                    {
                        var sensor = hardware.Sensors.FirstOrDefault(s => s.SensorType == SensorType.Power &&
                            (s.Name.Equals("GPU Power", StringComparison.OrdinalIgnoreCase) || s.Name.Equals("GPU Total", StringComparison.OrdinalIgnoreCase)));
                        gpu ??= Valid(sensor?.Value);
                    }
                }
                catch (Exception) { /* An unavailable sensor must not disconnect telemetry. */ }
            }
            return (cpu, gpu);
        }
    }

    private static double? Valid(float? value) => value is float n && float.IsFinite(n) && n >= 0 && n <= 2000 ? n : null;
}
