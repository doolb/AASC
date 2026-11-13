param([int]$Seconds = 6)

$ErrorActionPreference = 'Stop'
if ($Seconds -lt 1 -or $Seconds -gt 30) { throw 'Seconds must be between 1 and 30.' }
$presentMon = Join-Path $PSScriptRoot 'PresentMon.exe'
if (-not (Test-Path -LiteralPath $presentMon)) { throw "PresentMon.exe not found: $presentMon" }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RemoteGamepadFpsForeground {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
}
'@
$foregroundId = [uint32]0
[void][RemoteGamepadFpsForeground]::GetWindowThreadProcessId([RemoteGamepadFpsForeground]::GetForegroundWindow(), [ref]$foregroundId)
$foreground = Get-CimInstance Win32_Process -Filter "ProcessId = $foregroundId" -ErrorAction SilentlyContinue
Write-Host "Foreground at start: $($foreground.Name) PID=$foregroundId Path=$($foreground.ExecutablePath)"
Write-Host "Collecting presentation events for $Seconds seconds; switch to the target application now..."

$session = 'RemoteGamepad_diagnose_' + [Guid]::NewGuid().ToString('N')
$info = [Diagnostics.ProcessStartInfo]::new()
$info.FileName = $presentMon
$info.Arguments = "--output_stdout --no_console_stats --v1_metrics --no_track_gpu --no_track_input --session_name $session --timed $Seconds --terminate_after_timed"
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$process = [Diagnostics.Process]::Start($info)
try {
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(($Seconds + 10) * 1000)) {
        $process.Kill()
        & $presentMon --terminate_existing_session --session_name $session 2>$null | Out-Null
        throw 'PresentMon timed out.'
    }
    $output = $stdout.GetAwaiter().GetResult()
    $errors = $stderr.GetAwaiter().GetResult()
    [void][RemoteGamepadFpsForeground]::GetWindowThreadProcessId([RemoteGamepadFpsForeground]::GetForegroundWindow(), [ref]$foregroundId)
    $foreground = Get-CimInstance Win32_Process -Filter "ProcessId = $foregroundId" -ErrorAction SilentlyContinue
    Write-Host "Foreground at end: $($foreground.Name) PID=$foregroundId Path=$($foreground.ExecutablePath)"
    if ($errors) { Write-Host "PresentMon messages: $errors" }
    if ($process.ExitCode -ne 0) { Write-Host "PresentMon exit code: $($process.ExitCode)" }
    $lines = @($output -split "`r?`n" | Where-Object { $_ })
    $header = -1
    for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^Application,ProcessID,') { $header = $i; break } }
    if ($header -lt 0) { Write-Host 'No CSV data returned.'; if ($output) { Write-Host $output }; return }
    $rows = $lines[$header..($lines.Length - 1)] | ConvertFrom-Csv
    if (-not $rows) { Write-Host 'No present events recorded.'; return }
    Write-Host 'Most active processes (all presents, including dropped):'
    $rows | Group-Object Application,ProcessID | Sort-Object Count -Descending | Select-Object -First 12 Count,Name | Format-Table -AutoSize
    $target = @($rows | Where-Object { $_.ProcessID -eq $foregroundId })
    $displayed = @($target | Where-Object { $_.Dropped -eq '0' })
    Write-Host "Foreground presents: $($target.Count); displayed: $($displayed.Count)"
} finally { $process.Dispose() }
