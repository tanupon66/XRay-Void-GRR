"""Verified from one Omron VT-X750 sample: PNG stream with omitted 8-byte signature.
Supports only 8-bit monochrome vertically stacked slices and exact VGI dimensions.
This reader is NOT a universal REC2 decoder.
"""
from pathlib import Path, PureWindowsPath
from io import BytesIO
import numpy as np
from PIL import Image

PNG_SIGNATURE=b"\x89PNG\r\n\x1a\n"

def open_png_stacked(vgi_path,rec2_path,meta):
    vgi_path=Path(vgi_path);rec2_path=Path(rec2_path)
    f=meta.get("file1",{})
    sz=f.get("size") or meta.get("representation",{}).get("size")
    dims=tuple(map(int,sz.split()))
    if len(dims)!=3 or min(dims)<1:raise ValueError("Invalid XYZ size in VGI")
    x,y,z=dims
    name=PureWindowsPath(f.get("name","")).name
    if name and name.lower()!=rec2_path.name.lower():raise ValueError("VGI and REC2 filename mismatch")
    if f.get("bitsperelement")!="8" or f.get("datatype","").lower()!="unsigned integer":
        raise ValueError("PNG REC2 variant requires unsigned 8-bit voxels")
    payload=rec2_path.read_bytes()
    if payload.startswith(b"\x00\x00\x00\x0dIHDR"):
        payload=PNG_SIGNATURE+payload
    elif not payload.startswith(PNG_SIGNATURE):
        raise ValueError("Unsupported REC2 PNG variant")
    with Image.open(BytesIO(payload)) as png:
        if png.mode!="L" or png.size!=(x,y*z):
            raise ValueError("REC2 decoded PNG is not grayscale or dimensions mismatch VGI")
        pixels=np.asarray(png.copy())
    volume=pixels.reshape((z,y,x))
    return volume
