# use PS v7.0

Get-NetNeighbor |
ForEach-Object -ThrottleLimit 256 -Parallel { if (Test-Connection $_.IPAddress -Ping -Quiet) { $_ } else { $null } } |
Where-Object { $_ -ne $null } |
ConvertTo-Json |
Out-Host
