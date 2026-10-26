"""Intensity-connected segment proposal only; human must validate all masks."""
import cv2,numpy as np
def auto_region(gray,xy,tolerance=20,maximum_fraction=.2):
    a=np.asarray(gray)
    if a.ndim!=2 or a.dtype!=np.uint8:raise ValueError("Expected uint8 2D CT")
    x,y=map(int,xy);h,w=a.shape
    if not (0<=x<w and 0<=y<h):raise ValueError("Point outside CT")
    if not (1<=int(tolerance)<=120):raise ValueError("Invalid edge tolerance")
    blur=cv2.GaussianBlur(a,(3,3),0)
    selection=(np.abs(blur.astype(np.int16)-int(blur[y,x]))<=tolerance).astype("uint8")
    _,labs,stats,_=cv2.connectedComponentsWithStats(selection,connectivity=8)
    component=labs[y,x]
    if component<=0:raise ValueError("No contiguous region")
    if stats[component,cv2.CC_STAT_AREA]>max(1,int(h*w*maximum_fraction)):
        raise ValueError("Auto Edge selected too much: reduce tolerance")
    return labs==component
