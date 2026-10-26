import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from geometry_screen import measure_ball_projection,peer_screen,detect_missing_slots

def test_area_shape_and_missing():
    m=np.zeros((4,100,100),np.uint8)
    yy,xx=np.ogrid[:100,:100]
    disk=(xx-40)**2+(yy-40)**2<=10**2
    m[:,disk]=1
    measure=measure_ball_projection(m,(40,40),15)
    assert measure["occupied_area_px"]>300
    assert 40<measure["coverage_pct"]<50
    assert measure["circularity"]>.8
    assert detect_missing_slots([measure],[(40,40),(80,80)],6)[1]["status"]=="REVIEW_MISSING_CANDIDATE"

def test_peer_insufficient_shape():
    rows=[{"center_y":10.,"center_x":float(i*30),"occupied_area_px":100,"coverage_pct":80,"circularity":.94} for i in range(11)]
    rows[5]["occupied_area_px"]=55;rows[5]["coverage_pct"]=44;rows[5]["circularity"]=.6
    got=peer_screen(rows,k=10)
    assert got[5]["status"]=="REVIEW"
    assert "SHAPE_OUTLIER" in got[5]["reason"]
    assert got[0]["status"]=="PEER_SIMILAR_UNVALIDATED"
