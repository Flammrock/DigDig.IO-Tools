param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
  [string] $Tag,
  [string] $DeployDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not $DeployDirectory) { $DeployDirectory = Join-Path $PSScriptRoot '../deploy' }
$directory = (Resolve-Path -LiteralPath $DeployDirectory).Path
$version = $Tag.Substring(1)
$manifestPath = Join-Path $directory 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -cne $version -or $manifest.platform -cne 'win32' -or $manifest.architecture -cne 'x64') {
  throw 'The deployment manifest does not match this Windows x64 release tag.'
}

# An explicit list prevents local files, pairing tokens, or old archives being published.
$names = @('DigDig-Map-Observatory.exe', 'digdig.user.js', 'README.txt')
if (@($manifest.files).Count -ne $names.Count) { throw 'Unexpected deployment manifest entries.' }
foreach ($name in $names) {
  $entries = @($manifest.files | Where-Object { $_.name -ceq $name })
  if ($entries.Count -ne 1) { throw "Missing or duplicate manifest entry: $name" }
  $file = Join-Path $directory $name
  $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ((Get-Item -LiteralPath $file).Length -ne $entries[0].bytes -or $hash -cne $entries[0].sha256) {
    throw "Deployment checksum mismatch: $name"
  }
}

$exe = Join-Path $directory $names[0]
$info = (Get-Item -LiteralPath $exe).VersionInfo
if ($info.FileVersion -cne "$version.0" -or $info.ProductVersion -cne "$version.0" -or $info.CompanyName -cne 'Flammrock') {
  throw 'The executable version or company metadata does not match the release.'
}
$script = [System.IO.File]::ReadAllText((Join-Path $directory 'digdig.user.js'))
if (-not $script.StartsWith('// ==UserScript==') -or
    $script -cnotmatch ('(?m)^// @version\s+' + [regex]::Escape($version) + '\s*$') -or
    [regex]::Matches($script, '__DIGDIG_PAIRING_TOKEN__').Count -ne 1) {
  throw 'Expected the versioned generic userscript, without personalized credentials.'
}
$binaryText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($exe))
if (-not $binaryText.Contains($script)) { throw 'The executable does not contain this exact userscript.' }

$files = @($names + 'manifest.json' | ForEach-Object { Join-Path $directory $_ })
$archive = Join-Path $directory "digdig-tools-$Tag-windows-x64.zip"
Compress-Archive -LiteralPath $files -DestinationPath $archive -CompressionLevel Optimal -Force
$checksums = @($files + $archive | ForEach-Object {
  $hash = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $([System.IO.Path]::GetFileName($_))"
})
[System.IO.File]::WriteAllLines((Join-Path $directory 'SHA256SUMS.txt'), [string[]] $checksums,
  (New-Object System.Text.UTF8Encoding $false))
Write-Output "Verified Windows release: $archive"
