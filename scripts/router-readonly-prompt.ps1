param([switch]$WriteTest, [switch]$Topology, [ValidateSet('provision','observe','suspend','resume','release')][string]$LabAction, [switch]$StaticLab)
$ErrorActionPreference = 'Stop'
$reportName = if ($WriteTest) { 'router-write-result.json' } else { 'router-readonly-result.json' }
if ($Topology) { $reportName = 'router-topology-result.json' }
if ($WriteTest -and $Topology) { throw 'Select a write test or read-only topology, not both' }
if ($LabAction -and ($WriteTest -or $Topology)) { throw 'Select only one test mode' }
if ($LabAction) { $reportName = 'router-subscriber-lab-result.json' }
if ($StaticLab -and -not $LabAction) { throw 'Static lab requires an action' }
if ($StaticLab) { $reportName = 'router-static-lab-result.json' }
Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'MikroTik read-only check'
$form.Width = 450
$form.Height = 230
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = "Enter the billing-test password for 192.168.88.1.`nRead-only checks. Password is not saved."
if ($WriteTest) {
  $form.Text = 'MikroTik isolated PPPoE write test'
  $label.Text = "billing-test password for 192.168.88.1.`nCreates and removes a temporary PPPoE account/profile."
}
$label.SetBounds(20, 20, 400, 50)
$passwordBox = New-Object System.Windows.Forms.TextBox
$passwordBox.UseSystemPasswordChar = $true
$passwordBox.SetBounds(20, 80, 390, 25)
$button = New-Object System.Windows.Forms.Button
$button.Text = 'Run checks'
$button.SetBounds(290, 125, 120, 30)
$button.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.Controls.AddRange(@($label, $passwordBox, $button))
$subscriberBox = New-Object System.Windows.Forms.TextBox
if ($LabAction) {
  $form.Text = 'Tenda subscriber lab: ' + $LabAction
  $label.Text = "MikroTik billing-test password for 192.168.88.1.`nAction: $LabAction on billing-lab-tenda only."
}
if ($StaticLab) { $label.Text = "MikroTik billing-test password for 192.168.88.1.`nStatic test action: $LabAction for 10.254.251.2 only." }
if ($LabAction -eq 'provision' -and -not $StaticLab) {
  $form.Height = 310
  $subscriberLabel = New-Object System.Windows.Forms.Label
  $subscriberLabel.Text = 'Choose a test PPPoE password (8+ characters). Use it on the Tenda.'
  $subscriberLabel.SetBounds(20, 120, 400, 35)
  $subscriberBox.UseSystemPasswordChar = $true
  $subscriberBox.SetBounds(20, 160, 390, 25)
  $button.SetBounds(290, 205, 120, 30)
  $form.Controls.AddRange(@($subscriberLabel, $subscriberBox))
}
$form.AcceptButton = $button
if ($form.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { $form.Dispose(); exit }
try {
$workspace = Split-Path -Parent $PSScriptRoot
$artifactDir = Join-Path $workspace 'artifacts'
New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null
$start = New-Object System.Diagnostics.ProcessStartInfo
$start.FileName = (Get-Command node).Source
$start.Arguments = 'scripts/router-readonly-check.cjs'
if ($WriteTest) { $start.Arguments = 'scripts/router-write-check.cjs' }
if ($LabAction) { $start.Arguments = 'scripts/router-subscriber-lab.cjs' }
if ($StaticLab) { $start.Arguments = 'scripts/router-static-lab.cjs' }
$start.WorkingDirectory = $workspace
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::Start($start)
$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$process.StandardInput.WriteLine((@{ password = $passwordBox.Text; topology = [bool]$Topology; labAction = $LabAction; subscriberPassword = $subscriberBox.Text } | ConvertTo-Json -Compress))
$process.StandardInput.Close()
$passwordBox.Clear()
$subscriberBox.Clear()
$form.Dispose()
$process.WaitForExit()
$result = $stdoutTask.GetAwaiter().GetResult()
# Drain stderr concurrently to prevent pipe backpressure. Never persist its contents.
$stderrText = $stderrTask.GetAwaiter().GetResult()
# Save only the structured report; discard dependency logs or raw errors.
try {
  $report = $result | ConvertFrom-Json
  if (-not $report -or (($WriteTest -or $LabAction) -and $report.state -notin @('complete', 'failed'))) { throw 'Incomplete report' }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $artifactDir $reportName)
} catch {
  # Collect only code identifiers and source locations, never raw diagnostic text.
  $errorCodes = @([regex]::Matches($stderrText, '\bERR_[A-Z_]+\b') | ForEach-Object Value | Select-Object -Unique)
  $sourceLocations = @([regex]::Matches($stderrText, '[\w.-]+\.(?:cjs|js):\d+:\d+') | ForEach-Object Value | Select-Object -Unique)
  @{ state = 'failed'; checkedAt = [DateTime]::UtcNow.ToString('o'); exitCode = $process.ExitCode; errorCodes = $errorCodes; sourceLocations = $sourceLocations; outputLength = $result.Length; error = 'Router test did not return a complete valid report'; cleanup = 'unverified; inspect the test runner report and temporary objects' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifactDir $reportName)
}
$process.Dispose()
[System.Windows.Forms.MessageBox]::Show('Checks finished. The local report is ready for review.', 'MikroTik test completed') | Out-Null
} catch {
  if ($artifactDir) {
    @{ state = 'failed'; checkedAt = [DateTime]::UtcNow.ToString('o'); error = 'Local password prompt could not finish'; failureType = $_.Exception.GetType().Name; cleanup = 'unverified' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $artifactDir $reportName)
  }
  [System.Windows.Forms.MessageBox]::Show('The local test could not finish. Tell the assistant this message appeared. No password has been saved.', 'MikroTik test error') | Out-Null
}
