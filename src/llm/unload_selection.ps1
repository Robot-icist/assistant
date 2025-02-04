# Define the IP addresses
$ips = @("127.0.0.1")

# Function to fetch models from a given IP address
function Fetch-Models {
    param (
        [string]$ip
    )
    $json_response = Invoke-RestMethod -Uri "http://${ip}:11434/api/ps"
    $models = $json_response.models | ForEach-Object { 
        "$ip $($_.model)" 
    }
    return $models
}

# Step 1: Fetch models from all IP addresses and display as a numbered list
$models_list = @()
$index = 1
Write-Host "Available models:"
foreach ($ip in $ips) {
    Write-Host "Server ${ip}:"
    $models = Fetch-Models -ip $ip
    foreach ($model in $models) {
        $models_list += $model
        Write-Host "  $index) $($model -split ' ')[1]"
        $index++
    }
}

# Step 2: Let the user select a model by number
$model_num = Read-Host "`nEnter the model number (or 0 to exit):"
if ($model_num -eq 0) {
    exit
}

# Step 3: Get the selected IP and model
$selected_entry = $models_list[$model_num - 1].Trim()
$selected_ip = ($selected_entry -split ' ')[0].Trim()
$selected_model = ($selected_entry -split ' ')[1].Trim()

# Debug output
Write-Host "Selected IP: $selected_ip"
Write-Host "Selected Model: $selected_model"

# Step 4: Run the final Invoke-RestMethod command with the selected IP and model
$body = @{ model = $selected_model; keep_alive = 0 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://${selected_ip}:11434/api/generate" -Method Post -Body $body -ContentType "application/json"
Write-Host "Model Unloaded"
