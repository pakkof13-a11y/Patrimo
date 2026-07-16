# S'assure de travailler dans le répertoire du script
Set-Location $PSScriptRoot

# 1. Lance le serveur de dev en arrière-plan masqué
$ServerProcess = Start-Process powershell -ArgumentList "-NoExit -Command `"`$Host.UI.RawUI.WindowTitle = 'PATRIMO_SERVER'; npm run dev`"" -WindowStyle Hidden -PassThru

# Attend 3 secondes que le serveur Node s'initialise sur le port 3000
Start-Sleep -Seconds 3

# 2. Ouvre l'URL dans le navigateur par défaut
Start-Process "http://127.0.0.1:3000"

# 3. Attends que le navigateur établisse la connexion avec le port 3000
$Connected = $false
for ($i = 0; $i -lt 15; $i++) {
    $Conns = Get-NetTCPConnection -LocalPort 3000 -State Established -ErrorAction SilentlyContinue
    if ($Conns) { $Connected = $true; break }
    Start-Sleep -Seconds 1
}

# 4. Surveillance de la fermeture du navigateur
if ($Connected) {
    $DisconnectCount = 0
    while ($true) {
        Start-Sleep -Seconds 2
        $Conns = Get-NetTCPConnection -LocalPort 3000 -State Established -ErrorAction SilentlyContinue
        
        if (-not $Conns) {
            $DisconnectCount++
            # Confirme la fermeture si déconnecté pendant environ 6 secondes
            if ($DisconnectCount -ge 3) { break }
        } else {
            $DisconnectCount = 0
        }
    }
}

# 5. NETTOYAGE SILENCIEUX (Tue le processus PowerShell et libère le port 3000)
Stop-Process -Id $ServerProcess.Id -Force -ErrorAction SilentlyContinue

$TargetConn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($TargetConn) {
    Stop-Process -Id $TargetConn.OwningProcess -Force -ErrorAction SilentlyContinue
}