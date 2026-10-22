# AI X-ray Inspection Windows EXE — Prototype v0.2

**EXPERIMENTAL:** Not a trained Deep Learning model, no 3D void-volume measurement, no validated Omron REC2 decoder, and **NOT for production OK/NG**. This is a classical-CV single-slice BGA Void/Area/Shape and 10-peer comparison prototype.

The existing XRay-Void-GRR web app has not been changed. Windows code is isolated in the `ai-xray-desktop/` directory.

## Download and run (Windows 10/11 x64)

1. Open **Releases** in this repository. Select the newest **AI X-ray Inspection v0.2 Preview** prerelease and download `AI-Xray-Inspection.exe`.
2. If Releases is empty, open **Actions > Build AI X-ray Windows EXE > latest successful run > Artifacts > AI-Xray-Inspection-Windows-x64**. Extract the artifact and double click `AI-Xray-Inspection.exe`.
3. No Python installation required. This is an unsigned EXE; Windows SmartScreen may prompt you. Check source and origin; do not bypass enterprise security policies.
4. In the app, **Open image**, **CT folder**, or **VGI + REC2**, set polarity and peer count, then **Analyze**, **Export**.
5. Exports: `joints.csv`, `overlay.png`, `summary.json`.

## Supported inputs

- PNG, JPG, BMP, TIFF single images.
- Folder of image slices: analyze the selected 2D slice.
- VGI + REC2 pair: only if VGI declares one `FileFormat=raw` payload, supported bit depth/dtype, known byte order and exact expected file size. The source may have a proprietary compressed REC2 that this application correctly refuses.

**Validate pixel orientation, scale, and image against Omron CT viewer before relying on any measurement.** The app does not upload customer files to GitHub; data processing is local. Do not put actual customer X-ray data in a public repository.

## Source and build

Source: `app.py`. Requirements: `requirements.txt`. Build workflow: `../.github/workflows/ai-xray-windows.yml`.

```powershell
py -3.11 -m pip install -r ai-xray-desktop/requirements.txt
py -3.11 -m pip install pytest pyinstaller
py -3.11 -m pytest ai-xray-desktop/tests -q
py -3.11 -m PyInstaller --onefile --windowed --name AI-Xray-Inspection ai-xray-desktop/app.py
```

Algorithm assumptions: peers are same BGA type and sufficiently homogeneous; area is threshold-derived area in pixels; no calibrated 3D volume. "REVIEW" means operator inspection, not automated NG.
