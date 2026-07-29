[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$projectPath = Split-Path -Parent $PSScriptRoot
$nodePath = 'C:\Program Files\nodejs\node.exe'
$ollamaPath = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
$entryPoint = Join-Path $projectPath 'dist\src\index.js'
$stdoutLog = Join-Path $env:TEMP 'jarvis-native.out.log'
$stderrLog = Join-Path $env:TEMP 'jarvis-native.err.log'
$ollamaStdoutLog = Join-Path $env:TEMP 'jarvis-ollama.out.log'
$ollamaStderrLog = Join-Path $env:TEMP 'jarvis-ollama.err.log'
$ollamaHealthUrl = 'http://127.0.0.1:11434/api/tags'
$nodeArguments = @("""$entryPoint""")
$windowsEntryPoint = $entryPoint.Replace('/', '\')
$portableEntryPoint = $entryPoint.Replace('\', '/')
$processEntryPointPatterns = @(
    "*""$windowsEntryPoint""*"
    "*""$portableEntryPoint""*"
)

if ($DryRun) {
    [PSCustomObject]@{
        ProjectPath = $projectPath
        NodePath = $nodePath
        OllamaPath = $ollamaPath
        EntryPoint = $entryPoint
        NodeArguments = $nodeArguments
        ProcessEntryPointPatterns = $processEntryPointPatterns
        UsesDocker = $false
        PreventsDuplicateJarvis = $true
        WaitsForOllama = $true
    } | ConvertTo-Json
    exit 0
}

foreach ($requiredPath in @($projectPath, $nodePath, $ollamaPath, $entryPoint)) {
    if (-not (Test-Path -LiteralPath $requiredPath)) {
        throw "Required Jarvis startup path is unavailable: $requiredPath"
    }
}

$existingJarvis = Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
        $commandLine = $_.CommandLine
        @(
            $processEntryPointPatterns |
                Where-Object { $commandLine -like $_ }
        ).Count -gt 0
    }

if ($null -ne $existingJarvis) {
    exit 0
}

function Test-OllamaReady {
    try {
        $null = Invoke-RestMethod `
            -Uri $ollamaHealthUrl `
            -Method Get `
            -TimeoutSec 2
        return $true
    }
    catch {
        return $false
    }
}

for ($attempt = 0; $attempt -lt 10 -and -not (Test-OllamaReady); $attempt++) {
    Start-Sleep -Seconds 1
}

if (-not (Test-OllamaReady)) {
    Start-Process `
        -FilePath $ollamaPath `
        -ArgumentList @('serve') `
        -RedirectStandardOutput $ollamaStdoutLog `
        -RedirectStandardError $ollamaStderrLog `
        -WindowStyle Hidden
}

for ($attempt = 0; $attempt -lt 30 -and -not (Test-OllamaReady); $attempt++) {
    Start-Sleep -Seconds 1
}

if (-not (Test-OllamaReady)) {
    throw 'Ollama did not become ready before the startup timeout.'
}

Start-Process `
    -FilePath $nodePath `
    -ArgumentList $nodeArguments `
    -WorkingDirectory $projectPath `
    -RedirectStandardOutput $stdoutLog `
    -RedirectStandardError $stderrLog `
    -WindowStyle Hidden
