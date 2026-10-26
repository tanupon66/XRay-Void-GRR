import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np
from instance3d import analyze_instances

def test_separate_touched_balls_bridge_and_void_3d():
    vol=np.zeros((6,40,60),np.uint8)
    vol[1:5,10:22,7:20]=1
    vol[1:5,10:22,26:39]=1
    vol[2:4,15:17,20:27]=1
    vol[2:4,13:15,12:14]=2
    res=analyze_instances(vol,[(15,13),(15,33)],radius_px=13)
    assert len(res["balls"])==2
    assert len(res["bridges"])==1
    assert len(res["voids"])==1
    assert res["voids"][0]["voxels"]==8
    assert res["balls"][0]["void_count"]==1

def test_expected_missing_candidate():
    vol=np.zeros((4,35,65),np.uint8)
    vol[:,10:18,10:18]=1
    res=analyze_instances(vol,[(14,14),(14,48)])
    assert len(res["missing"])==1
    assert res["missing"][0]["ball"]==2
