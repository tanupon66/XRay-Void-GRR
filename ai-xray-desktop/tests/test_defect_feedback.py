import sys,csv
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np,pytest
from defect_feedback import crop_stack,save_feedback,split_review_samples

def test_selection_crop_and_label_correction(tmp_path):
    im=np.ones((3,50,60),np.float32)*.4
    im[:,20:30,20:30]=.9
    patch=crop_stack(im,(25,25))
    assert patch.shape==(3,64,64) and patch[1,32,32]>.8
    saved=save_feedback(tmp_path,"U53","B1",17,(25,25),im,"NG","VOID","engineer",
                        suggestion="INSUFFICIENT_SOLDER",confidence=.9)
    assert saved["defect"]=="VOID" and saved["ai_suggestion"]=="INSUFFICIENT_SOLDER"
    with (tmp_path/"feedback_reviews.csv").open(encoding="utf-8-sig",newline="") as f:
        rows=list(csv.DictReader(f))
    assert rows[0]["verdict"]=="NG" and rows[0]["defect"]=="VOID"
    with np.load(tmp_path/rows[0]["sample"]) as a:
        assert int(a["label"])==1

def test_invalid_ng_and_grouped_validation(tmp_path):
    im=np.ones((3,64,64),np.float32)
    with pytest.raises(ValueError):
        save_feedback(tmp_path,"U53","B1",1,(12,12),im,"NG","OK","eng")
    for volume in ("U53","U54"):
        for defect in ("OK","VOID","OK","VOID"):
            save_feedback(tmp_path,volume,"B1",1,(12,12),im,
                          "OK" if defect=="OK" else "NG",defect,"eng")
    tr,va,labels,holdout=split_review_samples(tmp_path)
    assert len(tr)==4 and len(va)==4
    assert {p.parent.name for p,_ in tr}.isdisjoint({p.parent.name for p,_ in va})
