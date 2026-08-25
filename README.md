# X-Ray Void GR&R Studio

Static PWA for Omron-style X-ray inspection CSV exports. It runs locally in the browser and does not upload CSV content to a server.

## Main workflow
1. Upload one or more X-ray CSV files.
2. Machine ID is auto-detected from paths such as `VT-X750-1626_...` and can be edited.
3. Choose the measurement metric used for GR&R (default: `Flat void · Void Ratio [%]`).
4. Choose one or more pin-selection rules. Default: `Flat void · Maximum Void Inspection/Void Ratio [%] > 10`.
5. If a `Component_Pin` satisfies the filter at least once, all available repeats/machines of that `Component_Pin` are retained.
6. Review stability and Quick Crossed Gage R&R screening.
7. Export an Excel workbook prepared for Minitab.

## Excel sheets
- `Minitab_GRR`: Part, Machine, Measurement, Trial plus traceability columns.
- `Selected_Pins`: parts selected by the filter.
- `Pin_Stability`: N, Mean, Min, Max, Range, SD, CV%, filter min/max.
- `GRR_Summary`: quick crossed ANOVA variance components and %GRR if the design is sufficient.
- `All_Selected_Data`: detailed selected rows with board/file/path traceability.
- `Import_Log`: source file and machine metadata.
- `Settings`: filter and measurement settings used for the export.

## Quick GR&R note
The in-browser calculation is a screening estimate using a full crossed random-effects ANOVA model including Machine × Part interaction. If the design is unbalanced, the app uses a balanced subset for the quick estimate while the Excel export keeps all selected measurements. Confirm the official study in Minitab.

## GitHub Pages
This repository includes `.github/workflows/pages.yml`. In GitHub: **Settings → Pages → Source → GitHub Actions**. Push to `main`; the workflow deploys the site.

## External browser libraries
- Papa Parse 5.5.3 for large CSV parsing.
- SheetJS CE 0.20.3 for `.xlsx` export.
