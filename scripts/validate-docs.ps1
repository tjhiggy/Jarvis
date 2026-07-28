$ErrorActionPreference = 'Stop'

$repositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$excludedDirectories = @(
  'data'
  'database'
  'databases'
  'dist'
  'log'
  'logs'
  'node_modules'
)
$documentExtensions = @('.md', '.yml', '.yaml')
$unfinishedPatterns = @(
  '(?i)\b(?:TODO|TBD|FIXME)\b'
  '(?i)\bCHANGEME\b'
  '(?i)\{\{[^}\r\n]+\}\}'
  '(?i)<\s*(?:add|insert|replace)\b[^>\r\n]*>'
)
$dummyContactPatterns = @(
  '(?i)\b(?:[A-Z0-9._%+-]+@example\.(?:com|invalid|net|org)|example@example|your@email(?:\.[A-Z]{2,})?)\b'
)
$secretPatterns = @(
  '\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b'
  '\btvly-[A-Za-z0-9_-]{16,}\b'
  '\b[A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b'
  '-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'
)
$rgOptionsWithValues = @(
  '-A'
  '--after-context'
  '-B'
  '--before-context'
  '--colors'
  '-C'
  '--context'
  '--context-separator'
  '--dfa-size-limit'
  '-E'
  '--encoding'
  '--engine'
  '--field-context-separator'
  '--field-match-separator'
  '-g'
  '--glob'
  '--iglob'
  '-j'
  '--threads'
  '-m'
  '--max-count'
  '-M'
  '--max-columns'
  '--max-depth'
  '--path-separator'
  '--pre'
  '--pre-glob'
  '-r'
  '--replace'
  '--sort'
  '--sortr'
  '-t'
  '--type'
  '--type-add'
  '--type-clear'
  '-T'
  '--type-not'
)
$rgPatternOptions = @('-e', '--regexp')
$rgPatternFileOptions = @('-f', '--file')
$requiredReadmeLinks = @(
  'CHANGELOG.md'
  'CODE_OF_CONDUCT.md'
  'CONTRIBUTING.md'
  'LICENSE.md'
  'SECURITY.md'
  'SUPPORT.md'
  'docs/ARCHITECTURE.md'
  'docs/CONFIGURATION.md'
  'docs/DEVELOPMENT.md'
  'docs/DEPLOYMENT.md'
  'docs/DISCORD_SETUP.md'
  'docs/OPERATIONS.md'
  'docs/RELEASES.md'
  'docs/ROADMAP.md'
  'docs/SECURITY_MODEL.md'
  'docs/TROUBLESHOOTING.md'
  'docs/extensions/README.md'
)
$errors = @()

function ConvertTo-RepositoryPath {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  $normalizedPath = $Path.Replace('\', '/')
  while ($normalizedPath.StartsWith('./')) {
    $normalizedPath = $normalizedPath.Substring(2)
  }

  return $normalizedPath
}

function Test-IsExcludedPath {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  $segments = (ConvertTo-RepositoryPath -Path $Path).Split('/')
  foreach ($directory in $excludedDirectories) {
    if ($segments -contains $directory) {
      return $true
    }
  }

  return $false
}

function Get-CommandArgumentTokens {
  param(
    [Parameter(Mandatory)]
    [AllowEmptyString()]
    [string]$Text,

    [Parameter(Mandatory)]
    [int]$Offset
  )

  $tokenMatches = [regex]::Matches(
    $Text,
    '(?<token>"[^"\r\n]*"|''[^''\r\n]*''|\S+)'
  )
  foreach ($tokenMatch in $tokenMatches) {
    [pscustomobject]@{
      Value = $tokenMatch.Groups['token'].Value
      Start = $Offset + $tokenMatch.Groups['token'].Index
      Length = $tokenMatch.Groups['token'].Length
    }
  }
}

function Remove-DetectorPatternArguments {
  param(
    [Parameter(Mandatory)]
    [AllowEmptyString()]
    [string]$Line
  )

  $maskSpans = @()
  $rgCommands = [regex]::Matches($Line, '(?i)(?<![A-Z0-9_-])rg(?=\s)')
  foreach ($rgCommand in $rgCommands) {
    $argumentStart = $rgCommand.Index + $rgCommand.Length
    $tokens = @(
      Get-CommandArgumentTokens `
        -Text $Line.Substring($argumentStart) `
        -Offset $argumentStart
    )
    $hasExplicitPattern = $false

    for ($tokenIndex = 0; $tokenIndex -lt $tokens.Count; $tokenIndex += 1) {
      $token = $tokens[$tokenIndex]
      $value = $token.Value

      if ($value -eq '--') {
        if (-not $hasExplicitPattern -and $tokenIndex + 1 -lt $tokens.Count) {
          $maskSpans += $tokens[$tokenIndex + 1]
        }
        break
      }

      if ($value.StartsWith('--')) {
        $equalsIndex = $value.IndexOf('=')
        $optionName = if ($equalsIndex -ge 0) {
          $value.Substring(0, $equalsIndex)
        } else {
          $value
        }

        if ($rgPatternOptions -contains $optionName) {
          $hasExplicitPattern = $true
          if ($equalsIndex -ge 0) {
            $maskSpans += [pscustomobject]@{
              Start = $token.Start + $equalsIndex + 1
              Length = $token.Length - $equalsIndex - 1
            }
          } elseif ($tokenIndex + 1 -lt $tokens.Count) {
            $tokenIndex += 1
            $maskSpans += $tokens[$tokenIndex]
          }
          continue
        }

        if ($rgPatternFileOptions -contains $optionName) {
          $hasExplicitPattern = $true
          if ($equalsIndex -lt 0 -and $tokenIndex + 1 -lt $tokens.Count) {
            $tokenIndex += 1
          }
          continue
        }

        if (
          $rgOptionsWithValues -contains $optionName -and
          $equalsIndex -lt 0 -and
          $tokenIndex + 1 -lt $tokens.Count
        ) {
          $tokenIndex += 1
        }
        continue
      }

      if ($value.StartsWith('-') -and $value.Length -gt 1) {
        $matchedShortOption = $false
        foreach ($optionName in @($rgPatternOptions + $rgPatternFileOptions + $rgOptionsWithValues)) {
          if (-not $optionName.StartsWith('-') -or $optionName.StartsWith('--')) {
            continue
          }

          if ($value -eq $optionName) {
            $matchedShortOption = $true
            if ($rgPatternOptions -contains $optionName) {
              $hasExplicitPattern = $true
              if ($tokenIndex + 1 -lt $tokens.Count) {
                $tokenIndex += 1
                $maskSpans += $tokens[$tokenIndex]
              }
            } elseif ($rgPatternFileOptions -contains $optionName) {
              $hasExplicitPattern = $true
              if ($tokenIndex + 1 -lt $tokens.Count) {
                $tokenIndex += 1
              }
            } elseif ($tokenIndex + 1 -lt $tokens.Count) {
              $tokenIndex += 1
            }
            break
          }

          if ($value.StartsWith($optionName) -and $value.Length -gt $optionName.Length) {
            $matchedShortOption = $true
            if ($rgPatternOptions -contains $optionName) {
              $hasExplicitPattern = $true
              $maskSpans += [pscustomobject]@{
                Start = $token.Start + $optionName.Length
                Length = $token.Length - $optionName.Length
              }
            } elseif ($rgPatternFileOptions -contains $optionName) {
              $hasExplicitPattern = $true
            }
            break
          }
        }

        if ($matchedShortOption -or $value -match '^-[A-Z0-9-]+$') {
          continue
        }
      }

      if (-not $hasExplicitPattern) {
        $maskSpans += $token
      }
      break
    }
  }

  $selectStringCommands = [regex]::Matches(
    $Line,
    '(?i)(?<![A-Z0-9_-])Select-String(?=\s)'
  )
  foreach ($selectStringCommand in $selectStringCommands) {
    $argumentStart = $selectStringCommand.Index + $selectStringCommand.Length
    $tokens = @(
      Get-CommandArgumentTokens `
        -Text $Line.Substring($argumentStart) `
        -Offset $argumentStart
    )
    for ($tokenIndex = 0; $tokenIndex -lt $tokens.Count; $tokenIndex += 1) {
      $token = $tokens[$tokenIndex]
      if ($token.Value -eq '-Pattern' -and $tokenIndex + 1 -lt $tokens.Count) {
        $maskSpans += $tokens[$tokenIndex + 1]
        break
      }

      if ($token.Value -match '^(?i)-Pattern[:=](.+)$') {
        $separatorIndex = $token.Value.IndexOfAny(@(':', '='))
        $maskSpans += [pscustomobject]@{
          Start = $token.Start + $separatorIndex + 1
          Length = $token.Length - $separatorIndex - 1
        }
        break
      }
    }
  }

  $maskedLine = $Line
  $uniqueSpans = @(
    $maskSpans |
      Sort-Object -Property Start, Length -Unique |
      Sort-Object -Property Start -Descending
  )
  foreach ($span in $uniqueSpans) {
    $maskedLine = $maskedLine.Remove($span.Start, $span.Length)
  }

  return $maskedLine
}

function Add-ContentPatternErrors {
  param(
    [Parameter(Mandatory)]
    [string]$RelativePath,

    [Parameter(Mandatory)]
    [AllowEmptyCollection()]
    [AllowEmptyString()]
    [string[]]$Lines,

    [Parameter(Mandatory)]
    [string[]]$Patterns,

    [Parameter(Mandatory)]
    [string]$Message,

    [switch]$MaskDetectorPatterns
  )

  for ($lineIndex = 0; $lineIndex -lt $Lines.Count; $lineIndex += 1) {
    $searchableLine = if ($MaskDetectorPatterns) {
      Remove-DetectorPatternArguments -Line $Lines[$lineIndex]
    } else {
      $Lines[$lineIndex]
    }
    $matches = @($searchableLine | Select-String -Pattern $Patterns -AllMatches)

    if ($matches.Count -gt 0) {
      $script:errors += "${RelativePath}:$($lineIndex + 1): $Message"
    }
  }
}

$trackedOutput = @(& git -C $repositoryRoot ls-files -- '*.md' '*.yml' '*.yaml')
if ($LASTEXITCODE -ne 0) {
  throw 'Unable to enumerate tracked documentation files with git.'
}

$trackedFiles = @(
  $trackedOutput |
    ForEach-Object { ConvertTo-RepositoryPath -Path $_ } |
    Where-Object {
      $extension = [System.IO.Path]::GetExtension($_).ToLowerInvariant()
      $documentExtensions -contains $extension -and -not (Test-IsExcludedPath -Path $_)
    } |
    Sort-Object -Unique
)

foreach ($relativePath in $trackedFiles) {
  $absolutePath = Join-Path $repositoryRoot $relativePath
  $lines = @(Get-Content -LiteralPath $absolutePath)

  Add-ContentPatternErrors `
    -RelativePath $relativePath `
    -Lines $lines `
    -Patterns $unfinishedPatterns `
    -Message 'unfinished placeholder marker' `
    -MaskDetectorPatterns
  Add-ContentPatternErrors `
    -RelativePath $relativePath `
    -Lines $lines `
    -Patterns $dummyContactPatterns `
    -Message 'dummy contact address' `
    -MaskDetectorPatterns
  Add-ContentPatternErrors `
    -RelativePath $relativePath `
    -Lines $lines `
    -Patterns $secretPatterns `
    -Message 'likely secret or private key'

  if ([System.IO.Path]::GetExtension($relativePath) -ne '.md') {
    continue
  }

  $sourceDirectory = Split-Path -Parent $absolutePath
  for ($lineIndex = 0; $lineIndex -lt $lines.Count; $lineIndex += 1) {
    $linkTargets = @()
    $linkMatches = [regex]::Matches(
      $lines[$lineIndex],
      '!?\[[^\]]*\]\((?<target><[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|''[^'']*''))?\)',
      [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    )

    foreach ($linkMatch in $linkMatches) {
      $linkTargets += $linkMatch.Groups['target'].Value.Trim('<', '>')
    }

    $referenceDefinition = [regex]::Match(
      $lines[$lineIndex],
      '^\s{0,3}\[[^\]]+\]:\s*(?<target><[^>]+>|[^\s]+)(?:\s+(?:"[^"]*"|''[^'']*''|\([^)]*\)))?\s*$',
      [System.Text.RegularExpressions.RegexOptions]::CultureInvariant
    )
    if ($referenceDefinition.Success) {
      $linkTargets += $referenceDefinition.Groups['target'].Value.Trim('<', '>')
    }

    foreach ($target in $linkTargets) {
      if (
        $target.StartsWith('#') -or
        $target -match '^(?i:https?|mailto):'
      ) {
        continue
      }

      $pathPart = ($target -split '[?#]', 2)[0]
      if ([string]::IsNullOrWhiteSpace($pathPart)) {
        continue
      }

      $decodedPath = [uri]::UnescapeDataString($pathPart)
      if ($decodedPath.StartsWith('/')) {
        $candidatePath = Join-Path $repositoryRoot $decodedPath.TrimStart('/')
      } else {
        $candidatePath = Join-Path $sourceDirectory $decodedPath
      }

      $resolvedTarget = Resolve-Path -LiteralPath $candidatePath -ErrorAction SilentlyContinue
      if ($null -eq $resolvedTarget) {
        $errors += "${relativePath}:$($lineIndex + 1): broken repository link '$target'"
      }
    }
  }
}

$environmentExamplePath = Join-Path $repositoryRoot '.env.example'
$configurationRelativePath = 'docs/CONFIGURATION.md'
$configurationPath = Join-Path $repositoryRoot $configurationRelativePath
$environmentKeys = @(
  Get-Content -LiteralPath $environmentExamplePath |
    ForEach-Object {
      if ($_ -match '^\s*([A-Z][A-Z0-9_]*)\s*=') {
        $Matches[1]
      }
    } |
    Sort-Object -Unique
)

foreach ($key in $environmentKeys) {
  if (-not (Select-String -LiteralPath $configurationPath -Pattern ([regex]::Escape($key)) -Quiet)) {
    $errors += "${configurationRelativePath}: missing environment key '$key' from .env.example"
  }
}

$packagePath = Join-Path $repositoryRoot 'package.json'
$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$packageScripts = @($package.scripts.PSObject.Properties.Name | Sort-Object)
$scriptDocumentationPaths = @(
  (Join-Path $repositoryRoot 'README.md')
  (Join-Path $repositoryRoot 'docs/DEVELOPMENT.md')
)
$scriptDocumentation = ($scriptDocumentationPaths | ForEach-Object {
    Get-Content -LiteralPath $_ -Raw
  }) -join "`n"

foreach ($scriptName in $packageScripts) {
  if ($scriptName -in @('start', 'test')) {
    $commandPattern = "(?m)\bnpm\s+(?:run\s+)?$([regex]::Escape($scriptName))(?![-:\w])"
  } else {
    $commandPattern = "(?m)\bnpm\s+run\s+$([regex]::Escape($scriptName))(?![-:\w])"
  }

  if ($scriptDocumentation -notmatch $commandPattern) {
    $errors += "README.md or docs/DEVELOPMENT.md: missing package script command '$scriptName'"
  }
}

$readmePath = Join-Path $repositoryRoot 'README.md'
$readmeContent = Get-Content -LiteralPath $readmePath -Raw
foreach ($requiredLink in $requiredReadmeLinks) {
  $escapedLink = [regex]::Escape($requiredLink).Replace('/', '[/\\]')
  if ($readmeContent -notmatch "\]\($escapedLink(?:#[^)]+)?\)") {
    $errors += "README.md: missing documentation link '$requiredLink'"
  }
}

if ($errors.Count -gt 0) {
  $errors | Sort-Object -Unique | ForEach-Object {
    Write-Error $_ -ErrorAction Continue
  }
  exit 1
}

Write-Output (
  'Documentation check passed: {0} tracked files, {1} environment keys, {2} package scripts.' -f `
    $trackedFiles.Count, `
    $environmentKeys.Count, `
    $packageScripts.Count
)
