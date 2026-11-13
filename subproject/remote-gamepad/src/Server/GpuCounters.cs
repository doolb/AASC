using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

// Windows GPU engine counters are per process and engine; sum each engine and
// report the busiest engine rather than incorrectly summing unrelated engines.
internal sealed class GpuCounters : IDisposable
{
    private IntPtr query, engine, memory;
    public GpuCounters()
    {
        if (PdhOpenQuery(null, IntPtr.Zero, out query) != 0) { query = IntPtr.Zero; return; }
        if (PdhAddEnglishCounter(query, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out engine) != 0) engine = IntPtr.Zero;
        if (PdhAddEnglishCounter(query, @"\GPU Adapter Memory(*)\Dedicated Usage", IntPtr.Zero, out memory) != 0) memory = IntPtr.Zero;
        PdhCollectQueryData(query);
    }
    public (double? usage, ulong? memoryUsed) Read()
    {
        if (query == IntPtr.Zero || PdhCollectQueryData(query) != 0) return (null, null);
        var engines = Values(engine);
        var grouped = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        foreach (var (name, value) in engines)
        {
            string key = Regex.Replace(name, @"^pid_\d+_", "", RegexOptions.IgnoreCase);
            grouped[key] = grouped.GetValueOrDefault(key) + Math.Max(0, value);
        }
        var memories = Values(memory);
        double? usage = grouped.Count == 0 ? null : Math.Clamp(grouped.Values.Max(), 0, 100);
        ulong? used = memories.Count == 0 ? null : (ulong)Math.Max(0, memories.Sum(x => x.value));
        return (usage, used);
    }
    private static List<(string name, double value)> Values(IntPtr counter)
    {
        var output = new List<(string, double)>();
        if (counter == IntPtr.Zero) return output;
        uint size = 0, count = 0;
        uint result = PdhGetFormattedCounterArray(counter, 0x200, ref size, ref count, IntPtr.Zero);
        if (result != 0x800007D2 || size == 0 || size > 16 * 1024 * 1024) return output;
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (PdhGetFormattedCounterArray(counter, 0x200, ref size, ref count, buffer) != 0) return output;
            int itemSize = Marshal.SizeOf<CounterItem>();
            if ((long)count * itemSize > size) return output;
            for (int i = 0; i < count; i++)
            {
                var item = Marshal.PtrToStructure<CounterItem>(IntPtr.Add(buffer, i * itemSize));
                string? name = Marshal.PtrToStringUni(item.Name);
                if (name != null && item.Status <= 1 && double.IsFinite(item.Value)) output.Add((name, item.Value));
            }
            return output;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    public void Dispose() { if (query != IntPtr.Zero) { PdhCloseQuery(query); query = IntPtr.Zero; } }
    [StructLayout(LayoutKind.Sequential)] private struct CounterItem { public IntPtr Name; public uint Status; public double Value; }
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhOpenQuery(string? dataSource, IntPtr userData, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] private static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr userData, out IntPtr counter);
    [DllImport("pdh.dll")] private static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll", EntryPoint = "PdhGetFormattedCounterArrayW")] private static extern uint PdhGetFormattedCounterArray(IntPtr counter, uint format, ref uint size, ref uint count, IntPtr items);
    [DllImport("pdh.dll")] private static extern uint PdhCloseQuery(IntPtr query);
}
