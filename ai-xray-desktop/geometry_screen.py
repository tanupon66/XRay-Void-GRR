"""Experimental BGA geometry/coverage and peer screening (NOT manufacturing OK/NG).
Input is model class mask 0=background,1=solder,2=void and optional design centers.
"""
import numpy as np
import cv2
from scipy import ndimage as ndi

def measure_ball_projection(labels3d, xy_center, radius_px, pixel_xy_um=(30.,30.)):
    a=np.asarray(labels3d)
    if a.ndim!=3 or not np.isin(a,[0,1,2]).all():raise ValueError("Invalid classes")
    if radius_px<=0:raise ValueError("Radius must be positive")
    cy,cx=map(float,xy_center)
    yy,xx=np.ogrid[:a.shape[1],:a.shape[2]]
    roi=(xx-cx)**2+(yy-cy)**2<=radius_px**2
    occupied=(a!=0).any(axis=0)&roi
    material=(a==1).any(axis=0)&roi
    void=(a==2).any(axis=0)&roi
    area=int(occupied.sum());ref=int(roi.sum())
    # projected void and solder can overlap at different Z: not interchangeable with 3D volume %
    contours,_=cv2.findContours(occupied.astype("uint8"),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    if contours:
        c=max(contours,key=cv2.contourArea)
        per=cv2.arcLength(c,True)
        hull=cv2.contourArea(cv2.convexHull(c))
        circularity=min(1.,4*np.pi*area/per**2) if per>0 else None
        solidity=min(1.,area/hull) if hull>0 else None
    else:circularity=solidity=None
    coords=np.argwhere(occupied)
    if len(coords):
        width=int(np.ptp(coords[:,1])+1);height=int(np.ptp(coords[:,0])+1)
    else:width=height=0
    scale=float(pixel_xy_um[0])*float(pixel_xy_um[1])
    if scale<=0:raise ValueError("Pixel calibration must be positive")
    return {"center_y":cy,"center_x":cx,"reference_area_px":ref,
        "occupied_area_px":area,"solder_projected_px":int(material.sum()),
        "void_projected_px":int(void.sum()),
        "coverage_pct":round(100*area/ref,3) if ref else None,
        "occupied_area_mm2":round(area*scale/1e6,6),
        "width_um":round(width*float(pixel_xy_um[1]),2),
        "height_um":round(height*float(pixel_xy_um[0]),2),
        "aspect_ratio":round(max(width,height)/min(width,height),3) if min(width,height) else None,
        "circularity":round(circularity,4) if circularity is not None else None,
        "solidity":round(solidity,4) if solidity is not None else None}

def peer_screen(rows, k=10, area_delta_limit_pct=20, coverage_delta_limit_pct=20,
                circularity_delta_limit=.15):
    if not 1<=k<=100:raise ValueError("Peer count must be 1..100")
    results=[]
    for i,r in enumerate(rows):
        same=[p for j,p in enumerate(rows) if i!=j and
              p.get("peer_group",0)==r.get("peer_group",0) and p.get("occupied_area_px",0)>0]
        same.sort(key=lambda q:(q["center_y"]-r["center_y"])**2+(q["center_x"]-r["center_x"])**2)
        ref=same[:k];out=dict(r);out["peer_count"]=len(ref);flags=[]
        if len(ref)<5:
            out.update(status="UNVERIFIED",reason="Fewer than five suitable peers")
            results.append(out);continue
        for key,limit,delta_key in (("occupied_area_px",area_delta_limit_pct,"area_delta_pct"),
                                     ("coverage_pct",coverage_delta_limit_pct,"coverage_delta_pct")):
            vals=[p[key] for p in ref if p.get(key) is not None]
            median=float(np.median(vals)) if vals else 0
            value=r.get(key)
            delta=(100*(value/median-1)) if value is not None and median>0 else None
            out[delta_key]=round(delta,3) if delta is not None else None
            if delta is not None and delta < -limit:flags.append("LOW_"+key.upper())
            if delta is not None and delta > limit:flags.append("HIGH_"+key.upper())
        cvals=[p["circularity"] for p in ref if p.get("circularity") is not None]
        if cvals and r.get("circularity") is not None and np.median(cvals)-r["circularity"]>circularity_delta_limit:
            flags.append("SHAPE_OUTLIER")
        out["status"]="REVIEW" if flags else "PEER_SIMILAR_UNVALIDATED"
        out["reason"]="; ".join(flags) if flags else "Peer similarity does not establish OK"
        results.append(out)
    return results

def detect_missing_slots(rows, expected_centers, maximum_radius_px):
    """Explicit expected positions from CAD/operator only: no invented missing balls."""
    if maximum_radius_px<=0:raise ValueError("Invalid matching tolerance")
    detections=np.array([(r["center_y"],r["center_x"]) for r in rows if r.get("occupied_area_px",0)>0],dtype=float).reshape(-1,2)
    findings=[]
    for n,(cy,cx) in enumerate(expected_centers):
        dist=float(np.min(np.sqrt(((detections-[cy,cx])**2).sum(axis=1)))) if len(detections) else float("inf")
        findings.append({"slot":n+1,"center_y":float(cy),"center_x":float(cx),
                         "nearest_detection_px":dist if np.isfinite(dist) else None,
                         "status":"REVIEW_MISSING_CANDIDATE" if dist>maximum_radius_px else "MATCHED_UNVERIFIED"})
    return findings
