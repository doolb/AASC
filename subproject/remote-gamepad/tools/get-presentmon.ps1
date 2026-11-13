$ErrorActionPreference = 'Stop'
$url = 'https://github.com/GameTechDev/PresentMon/releases/download/v2.6.0/PresentMon-2.6.0-x64.exe'
$sha256 = 'B2A706BC6AD475749E3B7E3409263AA1E6906D45BDCF993F6DBC0F660188F1AF'
$target = Join-Path $PSScriptRoot 'PresentMon.exe'
if (Test-Path -LiteralPath $target) {
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $sha256) { throw 'Existing PresentMon.exe has a different hash; inspect it before replacing.' }
    Write-Output 'PresentMon is already available.'
    return
}
$download = Join-Path $PSScriptRoot 'PresentMon-2.6.0.download'
if (Test-Path -LiteralPath $download) { throw 'A previous download exists; inspect it before retrying.' }
Invoke-WebRequest -Uri $url -OutFile $download
if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash -ne $sha256) { throw "Unexpected SHA-256 for $download." }
Move-Item -LiteralPath $download -Destination $target
Write-Output 'Downloaded and verified PresentMon 2.6.0.'
