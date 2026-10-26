import sys
from pathlib import Path
from io import BytesIO
import numpy as np
import pytest
from PIL import Image
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from rec2_png import open_png_stacked

def test_signature_removed_png_volume(tmp_path):
    volume=np.arange(4*6*8,dtype=np.uint8).reshape(4,6,8)
    image=Image.fromarray(volume.reshape(24,8))
    b=BytesIO();image.save(b,format="PNG")
    rec=tmp_path/"a.rec2";rec.write_bytes(b.getvalue()[8:])
    vgi=tmp_path/"a.vgi";vgi.write_text("dummy")
    meta={"file1":{"size":"8 6 4","name":"a.rec2","datatype":"unsigned integer","bitsperelement":"8"}}
    decoded=open_png_stacked(vgi,rec,meta)
    np.testing.assert_array_equal(volume,decoded)

def test_malformed_dimensions_rejected(tmp_path):
    b=BytesIO();Image.fromarray(np.zeros((12,8),dtype=np.uint8)).save(b,format="PNG")
    rec=tmp_path/"a.rec2";rec.write_bytes(b.getvalue()[8:])
    with pytest.raises(ValueError,match="dimensions mismatch"):
        open_png_stacked(tmp_path/"a.vgi",rec,{"file1":{"size":"8 6 4","name":"a.rec2","datatype":"unsigned integer","bitsperelement":"8"}})
