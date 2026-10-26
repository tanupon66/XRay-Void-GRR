# AI X-ray Studio: correct wrong defect calls (v1.1 research preview)

The pixel-segmentation U-Net has three classes: background, solder, void. Peer/shape rules produce REVIEW candidates, not reliable defect-class NG decisions. v1.1 adds separate supervised defect training.

## Reviewer workflow

1. Open a CT image or matched VGI + REC2, and select AI Studio.
2. Check Select Ball, then click the center of the ball. The crosshair and Ball ID identify the selected region. Import Ball Centers CSV first when available for more stable IDs.
3. Click AI Suggest Defect. Without trained defect weights it displays NOT TRAINED. With weights it suggests a category with uncalibrated confidence. It never authorizes automatic OK/NG.
4. If the software proposed Insufficient Solder but it is actually Void, choose VOID from the Defect dropdown and click Confirm NG. For confirmed good choose NONE and Confirm OK. Reviewer ID is mandatory.
5. Confirmation saves a 64x64 3-slice crop under Dataset/defect_samples/<volume-id>/ and a row in Dataset/feedback_reviews.csv including original suggestion, corrected label, Ball ID, Z and reviewer.
6. Repeat on different boards / volume IDs. Collect OK and all relevant NG categories in at least two independent volumes (minimum 4 training samples and 2 held-out samples, both with all represented classes).
7. Click Train on Confirmed Examples. The training operation creates Dataset/defect_classifier.pt with held-out accuracy and per-class correct/total counts. Then use AI Suggest Defect on another ball to test. Expect provisional classifications until extensive validation.

## Separate teaching channels

Defect classification learns an OK/NG category from reviewed crops. Pixel segmentation learns solder/void outlines from full verified masks. They are separate tasks. Do not expect confirming an NG category to improve segmentation contours, or drawing a void to teach the defect classifier its category.

Auto Edge proposes a mask from grayscale intensity. Uncheck Select Ball to use Auto Edge or the brush, inspect the full slice and tick Verified full mask only after checking it. The current segmentation training treats unlabeled pixels as background; marking an incomplete mask verified can actively harm the model.

Main Viewer and AI Studio have zoom buttons, wheel zoom and right-button pan. AI Studio must not be used as a production OK/NG system.

## Validation caveats

Confidence is not calibrated. Two volumes are the minimum for a code-level split, not a sufficient sample for manufacturing accuracy. 3D metrics and Missing/Bridge candidates still depend on segmentation, physical spacing and accurately supplied expected ball locations. A label corrected in a single crop does not validate cross-part performance.
