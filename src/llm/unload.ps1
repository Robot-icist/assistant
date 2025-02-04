# Define the IP addresses
$ips = @("127.0.0.1")

# Function to fetch models from a given IP address
function Fetch-Models {
    param (
        [string]$ip
    )
    $json_response = Invoke-RestMethod -Uri "http://${ip}:11434/api/ps"
    return $json_response.models | ForEach-Object { $_.model }
}

# Loop through each IP and unload all models
foreach ($ip in $ips) {
    $models = Fetch-Models -ip $ip
    foreach ($model in $models) {
        $body = @{ model = $model; keep_alive = 0 } | ConvertTo-Json
        Invoke-RestMethod -Uri "http://${ip}:11434/api/generate" -Method Post -Body $body -ContentType "application/json"
        Write-Host "Unloaded model: $model from $ip"
    }
}
