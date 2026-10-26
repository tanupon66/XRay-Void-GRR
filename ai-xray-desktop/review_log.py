"""Human confirmation journal. AI suggestions never automatically become approved labels."""
import csv,datetime,json
from pathlib import Path
FIELDS=["utc_time","volume_id","slice_z","ball_id","verdict","defect","comment","reviewer","model_file"]
def append_review(csv_path, entry):
    if entry.get("verdict") not in ("OK","NG","UNREVIEWED"):raise ValueError("Invalid verdict")
    if not str(entry.get("ball_id","")).strip():raise ValueError("Ball ID required")
    path=Path(csv_path);path.parent.mkdir(parents=True,exist_ok=True)
    row={k:str(entry.get(k,"")) for k in FIELDS}
    row["utc_time"]=datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
    existing=path.is_file()
    with path.open("a",newline="",encoding="utf-8-sig") as f:
        writer=csv.DictWriter(f,fieldnames=FIELDS)
        if not existing:writer.writeheader()
        writer.writerow(row)
    return row
