$ErrorActionPreference = 'Stop'
$request = ConvertFrom-Json $env:SPROUTG_WINDOW_PLACEMENT

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class SproutWindowPlacement {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect {
        public int left, top, right, bottom;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Placement {
        public int size, flags, show, minX, minY, maxX, maxY;
        public Rect normal;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo {
        public int size;
        public Rect monitor, work;
        public int flags;
    }
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool GetWindowPlacement(IntPtr window, ref Placement placement);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, int flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(
        IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);

    private static void CheckOwner(IntPtr window, uint expectedPid) {
        uint pid;
        if (GetWindowThreadProcessId(window, out pid) == 0 || pid != expectedPid)
            throw new InvalidOperationException("Window owner changed.");
    }
    public static Rect Get(IntPtr window, uint pid) {
        CheckOwner(window, pid);
        if (IsIconic(window) || IsZoomed(window)) {
            var state = new Placement { size = Marshal.SizeOf(typeof(Placement)) };
            var area = new MonitorInfo { size = Marshal.SizeOf(typeof(MonitorInfo)) };
            if (!GetWindowPlacement(window, ref state) ||
                !GetMonitorInfo(MonitorFromWindow(window, 2), ref area))
                throw new Win32Exception();
            // WINDOWPLACEMENT stores normal bounds relative to the work-area origin.
            int dx = area.work.left - area.monitor.left;
            int dy = area.work.top - area.monitor.top;
            return new Rect {
                left = state.normal.left + dx, right = state.normal.right + dx,
                top = state.normal.top + dy, bottom = state.normal.bottom + dy
            };
        }
        Rect rect;
        if (!GetWindowRect(window, out rect)) throw new Win32Exception();
        return rect;
    }
    public static Rect Run(IntPtr window, uint pid, bool restore, int x, int y, int w, int h) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (previous == IntPtr.Zero) throw new InvalidOperationException("Per-monitor DPI unavailable.");
        try {
            CheckOwner(window, pid);
            const uint noZOrderOrActivation = 0x0214;
            if (restore && !SetWindowPos(window, IntPtr.Zero, x, y, w, h, noZOrderOrActivation))
                throw new Win32Exception();
            return Get(window, pid);
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
}
'@

$window = [IntPtr]([long]$request.hwnd)
$rect = $request.rect
$result = [SproutWindowPlacement]::Run($window, [uint32]$request.pid, ($null -ne $rect),
    [int]$rect.x, [int]$rect.y, [int]$rect.width, [int]$rect.height)
@{ x = $result.left; y = $result.top; width = $result.right - $result.left
   height = $result.bottom - $result.top } | ConvertTo-Json -Compress
