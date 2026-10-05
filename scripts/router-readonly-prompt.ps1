param([switch]$WriteTest)
$ErrorActionPreference = 'Stop'
$reportName = if ($WriteTest) { 'router-write-result.json' } else { 'router-readonly-result.json' }
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
$start.WorkingDirectory = $workspace
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardInput = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::Start($start)
$process.StandardInput.WriteLine((@{ password = $passwordBox.Text } | ConvertTo-Json -Compress))
$process.StandardInput.Close()
$passwordBox.Clear()
$form.Dispose()
$result = $process.StandardOutput.ReadToEnd()
$process.WaitForExit()
# Save only the structured report; discard dependency logs or raw errors.
try {
  $report = $result | ConvertFrom-Json
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $artifactDir $reportName)
} catch {
  '{"error":"Router test did not return a valid report"}' | Set-Content -LiteralPath (Join-Path $artifactDir $reportName)
}
$process.Dispose()
[System.Windows.Forms.MessageBox]::Show('Checks finished. The local report is ready for review.', 'MikroTik test completed') | Out-Null
} catch {
  [System.Windows.Forms.MessageBox]::Show('The local test could not finish. Tell the assistant this message appeared. No password has been saved.', 'MikroTik test error') | Out-Null
}
