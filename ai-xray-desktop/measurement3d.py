"""Research 3D per-ball measurement from predicted masks.
No ground truth validated. Coordinates are [Z,Y,X]; spacing in micrometers.
Segmentation failures are surfaced, not silently treated as good solder.
"""
import numpy as np
from scipy import ndimage as ndi

def measure_3d(mask, spacing_zyx_um=(30,30,30), min_voxels=12, peers=10):
    a=np.asarray(mask)
    if a.ndim!=3 or not np.isin(a,[0,1,2]).all():raise ValueError("Expected 3D classes 0,1,2")
    spacing=np.asarray(spacing_zyx_um,dtype=float)
    if spacing.shape!=(3,) or not np.isfinite(spacing).all() or (spacing<=0).any():
        raise ValueError("Valid Z,Y,X voxel spacing required")
    if not 1<=peers<=100:raise ValueError("Invalid number of peers")
    # Candidate envelope includes predicted solder material and predicted void.
    env=a>0
    labels,n=ndi.label(env,structure=ndi.generate_binary_structure(3,1))
    voxel_mm3=float(np.prod(spacing)/1e9)
    rows=[]
    for idx in range(1,n+1):
        locations=np.argwhere(labels==idx)
        count=len(locations)
        if count<min_voxels:continue
        submask=labels==idx
        void=int(np.count_nonzero(submask & (a==2)))
        solder=int(np.count_nonzero(submask & (a==1)))
        lo=locations.min(axis=0);hi=locations.max(axis=0)+1
        centroid=locations.mean(axis=0)
        extents=(hi-lo)*spacing
        # 3-D compactness and principal-axis elongation
        pts=(locations-centroid)*spacing
        cov=pts.T@pts/max(count,1)
        vals=np.maximum(np.linalg.eigvalsh(cov),0)
        elongation=float(np.sqrt(vals[-1]/max(vals[0],1e-6)))
        z0,y0,x0=lo;z1,y1,x1=hi
        xy=np.any(submask[z0:z1],axis=0)
        xyarea=int(xy.sum())
        # Reference footprint is projection of the complete predicted envelope
        rows.append(dict(id=len(rows)+1,z=float(centroid[0]),y=float(centroid[1]),x=float(centroid[2]),
            envelope_voxels=count,solder_voxels=solder,void_voxels=void,
            envelope_mm3=round(count*voxel_mm3,6),
            solder_mm3=round(solder*voxel_mm3,6),
            void_mm3=round(void*voxel_mm3,6),
            void_volume_pct=round(100*void/count,3),
            projected_area_mm2=round(xyarea*spacing[1]*spacing[2]/1e6,6),
            width_um=round(float(extents[2]),2),height_um=round(float(extents[1]),2),
            depth_um=round(float(extents[0]),2),elongation_3d=round(elongation,3),
            bbox_zyx=[lo.astype(int).tolist(),hi.astype(int).tolist()],
            result="UNVERIFIED",reason="AI mask requires human validation"))
    for row in rows:
        dist=lambda q:sum(((row[k]-q[k])*spacing[i])**2 for i,k in enumerate(("z","y","x")))
        nearest=sorted((x for x in rows if x is not row),key=dist)[:peers]
        row["peer_count"]=len(nearest)
        if len(nearest)<5:
            row["reason"]="Less than five comparable candidates"
            continue
        median=lambda key:float(np.median([q[key] for q in nearest]))
        mv=median("envelope_mm3");vv=median("void_volume_pct")
        row["peer_volume_delta_pct"]=round(100*(row["envelope_mm3"]/mv-1),2) if mv else None
        row["peer_void_median_pct"]=round(vv,3)
        suspicious=(row["peer_volume_delta_pct"] is not None and abs(row["peer_volume_delta_pct"])>=20) or row["void_volume_pct"]-vv>=5
        row["result"]="REVIEW" if suspicious else "PEER_NORMAL_UNVALIDATED"
        row["reason"]="Volume or void outlier" if suspicious else "Peer similarity only, not QC pass"
    return rows

def volume_summary(mask,spacing_zyx_um=(30,30,30)):
    a=np.asarray(mask)
    if a.ndim!=3 or not np.isin(a,[0,1,2]).all():raise ValueError("Expected 3D labels")
    z,y,x=map(float,spacing_zyx_um)
    if min(z,y,x)<=0:raise ValueError("Invalid spacing")
    unit=z*y*x/1e9
    nv=int((a==2).sum());ns=int((a==1).sum())
    return {"void_voxels":nv,"solder_voxels":ns,
        "void_mm3":round(nv*unit,6),"solder_mm3":round(ns*unit,6),
        "void_pct_global":round(100*nv/(nv+ns),3) if nv+ns else None,
        "note":"Unvalidated segmentation; not per-ball void %"}
