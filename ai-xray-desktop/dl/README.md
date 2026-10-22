# AI X-ray Deep Learning v0.3 — research training starter

Actual PyTorch **2.5D U-Net** added. Unlike v0.2, this code contains a trainable neural network and gradients, plus CPU/GPU training, inference, mask output, confidence output, and grouped validation by source volume.

**Important**: No Omron VGI/REC2 test pair or annotated masks has been received, so no trained model weights are provided. Predicting without a trained checkpoint is intentionally not permitted. The Windows v0.2 EXE remains classical CV; these separate Python training tools do **not yet** run inside the EXE.

## Required labeled training files

Put training pairs in:
\`\`\`
dataset/
  volume_001/
    ball001_z008.npz
    ball001_z009.npz
  volume_002/
    ball001_z008.npz
  volume_003/
    ball001_z008.npz
\`\`\`

Each NPZ holds \`image\` float32 shape \`(3,H,W)\` normalized to [0,1] for z-1/z/z+1 CT slices, and \`mask\` integer shape \`(H,W)\` with labels **0=background, 1=solder material, 2=void**. Use consistently defined labels. Pad edge Z slices by copying the nearest slice. Keep the same coordinate system and physical scale per training example. Do not split individual slices from the same volume between training and validation.

## Train offline

Python 3.11:
\`\`\`powershell
python -m pip install -r ai-xray-desktop/dl/requirements-dl.txt
python ai-xray-desktop/dl/train.py --data dataset --epochs 20 --out trained/unet25d.pt
\`\`\`

Inference (requires trained checkpoint):
\`\`\`powershell
python ai-xray-desktop/dl/infer.py --model trained/unet25d.pt --input dataset/volume_003/ball001_z008.npz --out predictions
\`\`\`

Exports label \`classes.png\` (values 0,1,2), \`confidence.png\` and \`prediction.json\`. Predictions do **not** represent a validated percent void/area or NG decision. Do not upload any confidential Omron production data to a public GitHub repository. Train locally on approved data.

## Validation and next steps

- Confirm Omron REC2 decoding and pixel orientation with a real matched VGI+REC2 pair.
- Build an offline label/mask editing UI and source volume to 2.5D NPZ converter.
- Train and evaluate on held-out part numbers and volume IDs; report Dice/IoU, per-ball void-area errors, repeatability and escape/false-call rates.
- Add model loading/inference to packaged Windows EXE, with versioned weights and human-review safeguards.
