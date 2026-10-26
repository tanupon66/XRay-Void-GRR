"""Experimental 3D BGA instance analysis. Never an automatic production OK/NG decision."""
import numpy as np
from scipy import ndimage as ndi

def analyze_instances(mask, centers_yx=None, spacing_zyx_um=(30,30,30), radius_px=9, min_voxels=8):
    a=np.asarray(mask)
    if a.ndim!=3 or not np.isin(a,[0,1,2]).all():raise ValueError("Expected 3D labels 0/1/2")
    spacing=np.asarray(spacing_zyx_um,dtype=float)
    if spacing.shape!=(3,) or (spacing<=0).any() or not np.isfinite(spacing).all():raise ValueError("Invalid spacing")
    if radius_px<=0:raise ValueError("Invalid expected ball radius")
    env=a>0
    zdim,ydim,xdim=a.shape
    if centers_yx is None:
        # Centers inferred from projection; touching blobs may remain unresolved.
        projection=env.sum(axis=0)>0
        peaks=ndi.maximum_filter(ndi.distance_transform_edt(projection),size=9)
        d=ndi.distance_transform_edt(projection)
        local=(d>=peaks)&(d>=3)&projection
        _,n=ndi.label(local)
        seeds=np.asarray(ndi.center_of_mass(local,ndi.label(local)[0],range(1,n+1))).reshape(-1,2) if n else np.empty((0,2))
        center_origin="inferred_unverified"
    else:
        seeds=np.asarray(centers_yx,dtype=float).reshape(-1,2)
        center_origin="user_reference"
    if len(seeds)==0:
        return {"balls":[],"bridges":[],"voids":[],"missing":[],"instance_labels":np.zeros_like(a,dtype=np.int32),
                "warning":"No valid centers; cannot separate balls"}
    # Nearest seed assigns every occupied voxel in x/y; geometry is bounded by optional radius.
    yy,xx=np.ogrid[:ydim,:xdim]
    distance=np.stack([(yy-cy)**2+(xx-cx)**2 for cy,cx in seeds],axis=0)
    owner=distance.argmin(axis=0)+1
    inside=distance.min(axis=0)<=radius_px**2
    instance=np.where(env&inside[None],owner[None],0).astype(np.int32)
    # Bridge detection only flags actual connected regions touching two expected regions.
    connected,ncc=ndi.label(env,structure=ndi.generate_binary_structure(3,1))
    bridges=[]
    for j in range(1,ncc+1):
        ids=np.unique(instance[connected==j]);ids=ids[ids>0]
        if len(ids)>1:bridges.append({"component":j,"ball_ids":ids.tolist(),"status":"REVIEW_CONNECTED_CANDIDATE"})
    unit_mm3=float(np.prod(spacing)/1e9)
    balls=[];missing=[];void_records=[]
    for k,(cy,cx) in enumerate(seeds,1):
        own=instance==k
        count=int(own.sum())
        if count<min_voxels:
            missing.append({"ball":k,"y":float(cy),"x":float(cx),
                            "status":"REVIEW_MISSING_OR_INSUFFICIENT_CANDIDATE",
                            "voxels":count})
        if not count:continue
        voidmask=own&(a==2);material=own&(a==1)
        vlabels,vn=ndi.label(voidmask,structure=ndi.generate_binary_structure(3,1))
        ball_voids=[]
        for v in range(1,vn+1):
            vox=int((vlabels==v).sum())
            if vox<2:continue
            coords=np.argwhere(vlabels==v)
            item={"ball":k,"void_id":len(ball_voids)+1,"voxels":vox,
                  "void_mm3":round(vox*unit_mm3,7),
                  "centroid_zyx":np.round(coords.mean(axis=0),2).tolist()}
            ball_voids.append(item);void_records.append(item)
        projection=own.any(axis=0)
        yz=np.argwhere(projection)
        bbox=np.ptp(yz,axis=0)+1 if len(yz) else np.zeros(2,int)
        balls.append({"ball":k,"center_y":float(cy),"center_x":float(cx),
            "center_source":center_origin,
            "envelope_voxels":count,"solder_voxels":int(material.sum()),
            "void_voxels":int(voidmask.sum()),
            "solder_mm3":round(int(material.sum())*unit_mm3,7),
            "void_mm3":round(int(voidmask.sum())*unit_mm3,7),
            "void_volume_pct":round(100*int(voidmask.sum())/count,3),
            "projected_area_mm2":round(int(projection.sum())*spacing[1]*spacing[2]/1e6,6),
            "width_um":float(bbox[1]*spacing[2]),"height_um":float(bbox[0]*spacing[1]),
            "void_count":len(ball_voids),"status":"UNVALIDATED_REVIEW"})
    return {"balls":balls,"bridges":bridges,"voids":void_records,"missing":missing,
            "instance_labels":instance,
            "warning":"Research-only nearest-center assignment; connected neighbors and inaccurate centers can cause false bridges/void measurements."}
