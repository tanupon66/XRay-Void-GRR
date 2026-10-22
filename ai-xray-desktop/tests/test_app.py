import sys
from pathlib import Path
import numpy as np
import cv2
sys.path.insert(0, str(Path(__file__).parents[1]))
from app import analyze, read_volume

def test_sample_bga():
    im=np.zeros((500,500),np.uint8)
    for y in (65,155,245,335):
        for x in (65,155,245,335):
            cv2.circle(im,(x,y),25,220,-1)
            cv2.circle(im,(x-5,y-4),4,0,-1)
    rows,overlay=analyze(im,"bright",10)
    assert len(rows)==16
    assert overlay.shape==(500,500,3)
    assert all(row["peer_count"]==10 for row in rows)

def test_volume_raw_and_size_guard(tmp_path):
    vox=np.arange(4*12*14,dtype="<u2").reshape(4,12,14)
    rec=tmp_path/"one.rec2"
    vox.tofile(rec)
    vgi=tmp_path/"one.vgi"
    vgi.write_text("[file1]\nName=one.rec2\nFileFormat=raw\nSize=14 12 4\nDatatype=unsigned integer\nBitsPerElement=16\nByteOrder=little\n",encoding="utf-8")
    volume=read_volume(vgi,rec)
    assert volume.shape==vox.shape
    assert int(volume[2,3,4])==int(vox[2,3,4])
    del volume
    import gc
    gc.collect()
    rec.write_bytes(b"ABC")
    import pytest
    with pytest.raises(ValueError,match="size mismatch"):
        read_volume(vgi,rec)
