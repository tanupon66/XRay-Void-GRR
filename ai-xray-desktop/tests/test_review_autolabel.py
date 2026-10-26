import sys,csv
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np,cv2,pytest
from autolabel import auto_region
from review_log import append_review
def test_auto_edge():
    a=np.full((120,120),110,np.uint8)
    cv2.circle(a,(50,50),12,225,-1)
    region=auto_region(a,(50,50),20)
    assert region[50,50] and not region[0,0]
    assert 300<region.sum()<600
def test_overflow_rejected():
    with pytest.raises(ValueError):
        auto_region(np.full((30,30),100,np.uint8),(10,10),15)
def test_review_does_not_train(tmp_path):
    path=tmp_path/"review.csv"
    append_review(path,{"volume_id":"U53","ball_id":"1","verdict":"NG","defect":"VOID"})
    append_review(path,{"volume_id":"U53","ball_id":"2","verdict":"OK","defect":"NONE"})
    with path.open(encoding="utf-8-sig",newline="") as f:rows=list(csv.DictReader(f))
    assert [r["verdict"] for r in rows]==["NG","OK"]
    assert not list(tmp_path.glob("*.pt"))
