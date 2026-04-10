param(
    [string]$DatabaseUrl
)

$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env'

if (-not $DatabaseUrl -and (Test-Path $envFile)) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') {
            $DatabaseUrl = $matches[1].Trim('"')
        }
    }
}

if (-not $DatabaseUrl -and $env:DATABASE_URL) {
    $DatabaseUrl = $env:DATABASE_URL
}

if (-not $DatabaseUrl) {
    throw 'DATABASE_URL was not provided. Put it in .env, pass -DatabaseUrl, or export DATABASE_URL.'
}

$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    throw 'psql is required. Install PostgreSQL client tools and ensure psql is on PATH.'
}

$sqlFiles = @(
    'sql\001_extensions.sql',
    'sql\002_schema.sql',
    'sql\003_functions_triggers_views.sql'
)

foreach ($relative in $sqlFiles) {
    $fullPath = Join-Path $projectRoot $relative
    Write-Host "Applying $relative"
    & $psql.Source $DatabaseUrl -v ON_ERROR_STOP=1 -f $fullPath
    if ($LASTEXITCODE -ne 0) {
        throw "psql failed while applying $relative"
    }
}

Write-Host 'Neon/Postgres schema applied successfully.'
