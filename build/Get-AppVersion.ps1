param([string]$Version = "")

if ($Version) { return $Version -replace '^v', '' }

$tag = git describe --tags --abbrev=0 2>$null
$base = if ($tag) { $tag -replace '^v', '' } else { "0.0.0" }
$hash = git rev-parse --short HEAD 2>$null
if ($hash) { return "$base-$hash" } else { return "$base-dev" }
