# Deterministic Release build of both plugins. AI generated code.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
foreach ($p in 'VierLinkRemote') {
  dotnet build "$root\$p\$p.csproj" -c Release -p:Deterministic=true -p:ContinuousIntegrationBuild=true "-p:PathMap=$root=/_/" -p:DebugType=none -p:DebugSymbols=false | Out-Host
  if ($LASTEXITCODE) { throw "build failed: $p" }
}
