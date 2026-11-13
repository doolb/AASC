using System.Runtime.InteropServices;

// Include renderer subprocesses without confusing other unrelated applications
// with the active window. Snapshot once per telemetry sample, not per frame.
internal static class ProcessTree
{
    public static HashSet<uint> Descendants(uint root)
    {
        var result = new HashSet<uint>();
        if (root == 0) return result;
        var snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) return result;
        var children = new Dictionary<uint, List<uint>>();
        try
        {
            var entry = new ProcessEntry { Size = (uint)Marshal.SizeOf<ProcessEntry>() };
            if (Process32First(snapshot, ref entry)) do
            {
                if (!children.TryGetValue(entry.ParentProcessId, out var list)) children[entry.ParentProcessId] = list = new();
                list.Add(entry.ProcessId);
            } while (Process32Next(snapshot, ref entry));
        }
        finally { CloseHandle(snapshot); }
        var pending = new Queue<uint>();
        pending.Enqueue(root);
        while (pending.TryDequeue(out var parent))
            if (children.TryGetValue(parent, out var list)) foreach (var child in list)
                if (child != root && result.Add(child)) pending.Enqueue(child);
        return result;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ProcessEntry
    {
        public uint Size, Usage, ProcessId;
        public IntPtr DefaultHeapId;
        public uint ModuleId, Threads, ParentProcessId;
        public int BasePriority;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
    }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", EntryPoint = "Process32FirstW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", EntryPoint = "Process32NextW", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
