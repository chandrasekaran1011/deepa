# Deepa CLI Installation Script for Windows

$ErrorActionPreference = "Stop"

Write-Host "Installing Deepa CLI..." -ForegroundColor Cyan

# GitHub repository details
$RepoOwner = "chandrasekaran1011"
$RepoName = "deepa"

# Detect Architecture
$Architecture = $env:PROCESSOR_ARCHITECTURE
if ($Architecture -eq "AMD64") {
    $TargetArch = "x64"
} elseif ($Architecture -eq "ARM64") {
    $TargetArch = "arm64"
} else {
    Write-Error "Unsupported architecture: $Architecture"
    exit 1
}

$BinaryName = "deepa-win-$TargetArch.exe"
$DownloadUrl = "https://github.com/$RepoOwner/$RepoName/releases/latest/download/$BinaryName"

$InstallDir = "$env:LOCALAPPDATA\deepa\bin"
$ExecutablePath = "$InstallDir\deepa.exe"

Write-Host "Detected OS: Windows, Architecture: $TargetArch"
Write-Host "Downloading Deepa from $DownloadUrl..."

# Create install directory if it doesn't exist
if (-not (Test-Path -Path $InstallDir)) {
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
}

# Download the executable
try {
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ExecutablePath -UseBasicParsing
} catch {
    Write-Error "Failed to download Deepa. Please ensure you have an active internet connection and GitHub is accessible."
    Write-Error $_
    exit 1
}

Write-Host "`nSuccessfully installed Deepa to $ExecutablePath" -ForegroundColor Green

# Add to User PATH if not already present
$UserPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($UserPath -notmatch [regex]::Escape($InstallDir)) {
    Write-Host "Adding $InstallDir to your PATH..."
    $NewUserPath = if ($UserPath.EndsWith(";")) { "$UserPath$InstallDir" } else { "$UserPath;$InstallDir" }
    [Environment]::SetEnvironmentVariable("PATH", $NewUserPath, "User")
    
    Write-Host "=========================================================" -ForegroundColor Yellow
    Write-Host "Deepa has been added to your PATH." -ForegroundColor Yellow
    Write-Host "Please restart your terminal session for the changes to take effect." -ForegroundColor Yellow
    Write-Host "After restarting, you can run 'deepa' from your terminal!" -ForegroundColor Yellow
    Write-Host "=========================================================" -ForegroundColor Yellow
} else {
    Write-Host "You can now run 'deepa' from your terminal!" -ForegroundColor Green
}
