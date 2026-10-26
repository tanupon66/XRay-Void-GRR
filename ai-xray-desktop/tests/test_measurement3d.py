import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np,pytest
from measurement3d import measure_3d,volume_summary

def test_two_separate_ball_volumes():
    m=np.zeros((8,32,32),np.uint8)
    m[1:6,3:10,3:10]=1
    m[1:6,3:10,18:25]=1
    m[2:4,5:7,5:7]=2
    rows=measure_3d(m,(30,30,30))
    assert len(rows)==2
    assert sorted(r["void_voxels"] for r in rows)==[0,8]
    assert rows[0]["envelope_mm3"]>rows[0]["void_mm3"]
    assert all(r["result"]=="UNVERIFIED" for r in rows)
    summary=volume_summary(m)
    assert summary["void_voxels"]==8

def test_invalid_masks_and_spacing():
    with pytest.raises(ValueError):measure_3d(np.ones((8,8),np.uint8))
    with pytest.raises(ValueError):measure_3d(np.zeros((2,3,4),np.uint8),(0,30,30))
    with pytest.raises(ValueError):measure_3d(np.ones((2,3,4),np.uint8)*3)

def test_ten_peer_comparison():
    m=np.zeros((4,60,150),np.uint8)
    for y in (5,20,35):
        for x in (5,20,35,50):
            m[1:3,y:y+6,x:x+6]=1
    rows=measure_3d(m,peers=10)
    assert len(rows)==12
    assert all(r["peer_count"]==10 for r in rows)
    assert all(r["result"]=="PEER_NORMAL_UNVALIDATED" for r in rows)
