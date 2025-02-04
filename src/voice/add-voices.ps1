Write-Host "This is a PowerShell script running as admin." -ForegroundColor Green

# Your script logic here
Write-Host "Performing some tasks..." -ForegroundColor Yellow

$sourcePath = 'HKLM:\software\Microsoft\Speech_OneCore\Voices\Tokens' #Where the OneCore voices live
$destinationPath = 'HKLM:\SOFTWARE\Microsoft\Speech\Voices\Tokens' #For 64-bit apps
$destinationPath2 = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\SPEECH\Voices\Tokens' #For 32-bit apps
cd $destinationPath
$listVoices = Get-ChildItem $sourcePath
foreach ($voice in $listVoices) {
    $source = $voice.PSPath #Get the path of this voices key
    echo $source
    copy -Path $source -Destination $destinationPath -Recurse
    copy -Path $source -Destination $destinationPath2 -Recurse
}

# # Wait for user input before closing
# Read-Host "Press Enter to exit"