# Omron VGI + REC2 sample-specific support (v0.4)

The supplied VT-X750 pair included VGI metadata size **266 × 453 × 34** and voxel resolution **30 × 30 × 30 µm**. REC2 was **1,557,985 bytes**, shorter than the expected 4,096,932 raw bytes.

Inspection showed a PNG structure missing the standard **8-byte PNG signature**, beginning with IHDR. Restoring the signature decoded a grayscale image **266 × 15,402**, exactly 453 × 34 rows. Reshaping into **(Z=34, Y=453, X=266)** recovered all slices. This is a **verified decoding of one example, not proof that all Omron REC2 files use this format**.

The Windows app now attempts this validated compressed variant first, falling back to the earlier strict RAW loader. It never silently treats unsupported compressed data as raw. Cross-section Viewer displays XY, XZ, YZ with Z and X/Y controls and visualization-only contrast, brightness, zoom. No trained DL model was included in the portable EXE.

For research and future training: preserve raw voxel intensities unchanged; separately export masks and calibration metadata. Need test across multiple volumes and matching screenshots to verify physical axes and slice order. Screenshot supplied displays a **different volume name (U19)** than the actual sample (**U53**), so it is not a ground-truth same-volume comparison.
