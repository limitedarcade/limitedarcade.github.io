# Run AFTER closing Comfy Desktop (cv2.pyd is locked while Comfy runs).
$ErrorActionPreference = "Stop"
$py = "$env:LOCALAPPDATA\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\.venv\Scripts\python.exe"
$req = "$env:LOCALAPPDATA\Comfy-Desktop\ComfyUI-Installs\ComfyUI\ComfyUI\custom_nodes\comfyui_controlnet_aux\requirements.txt"
if (-not (Test-Path $py)) { throw "Comfy venv python not found: $py" }
if (-not (Test-Path $req)) { throw "controlnet_aux requirements not found: $req" }
Write-Host "Installing comfyui_controlnet_aux deps with $py"
& $py -m pip install -r $req
Write-Host "Done. Restart Comfy Desktop, then check for OpenposePreprocessor / DWPreprocessor nodes."
