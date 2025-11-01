# Kill any process using port 5000
$port = 5000
$processId = (Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue).OwningProcess

if ($processId) {
    Write-Host "🔴 Found process using port $port (PID: $processId)"
    Stop-Process -Id $processId -Force
    Write-Host "✅ Process killed successfully"
    Start-Sleep -Seconds 1
} else {
    Write-Host "✅ Port $port is already free"
}
