"""Opt-in, human-reviewed defect training: whole-joint crops and grouped validation.

Segmentation masks are separate from defect CLASS labels. This workflow never
converts a heuristic REVIEW into a manufacturing OK/NG without a reviewer.
"""
import csv, datetime, json, re, uuid
from pathlib import Path
import numpy as np

LABELS=("OK","VOID","INSUFFICIENT_SOLDER","MISSING_BALL","SOLDER_BRIDGE","SHAPE","OTHER")
FIELDS=("utc_time","volume_id","slice_z","ball_id","center_y","center_x",
        "verdict","defect","reviewer","comment","ai_suggestion","ai_confidence","sample")
SIZE=64

def crop_stack(stack,center_yx,size=SIZE):
    a=np.asarray(stack,dtype=np.float32)
    if a.ndim!=3 or a.shape[0]!=3 or not np.isfinite(a).all() or not (0<=a.min()<=a.max()<=1):
        raise ValueError("Need normalized [3,H,W] image stack")
    y,x=map(lambda v:int(round(float(v))),center_yx)
    if not(0<=y<a.shape[1] and 0<=x<a.shape[2]):raise ValueError("Select a point inside the CT image")
    pad=size//2
    padded=np.pad(a,((0,0),(pad,pad),(pad,pad)),mode="edge")
    return np.ascontiguousarray(padded[:,y:y+size,x:x+size],dtype=np.float32)

def save_feedback(root,volume_id,ball_id,z,center_yx,stack,verdict,defect,reviewer,comment="",
                  suggestion="NOT_TRAINED",confidence=None):
    if verdict not in ("OK","NG"):raise ValueError("Please confirm OK or NG")
    if defect not in LABELS:raise ValueError("Unknown defect type")
    if (verdict=="OK")!=(defect=="OK"):raise ValueError("OK requires OK label, NG requires a defect")
    if not reviewer.strip() or not ball_id.strip():raise ValueError("Reviewer and Ball ID are required")
    if not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}",volume_id) or volume_id in (".",".."):
        raise ValueError("Use a safe unique Volume ID (letters, numbers, underscore)")
    patch=crop_stack(stack,center_yx)
    root=Path(root);folder=root/"defect_samples"/volume_id
    folder.mkdir(parents=True,exist_ok=True)
    filename="sample_"+uuid.uuid4().hex+".npz"
    path=folder/filename
    np.savez_compressed(path,image=patch,label=np.int64(LABELS.index(defect)))
    entry={"utc_time":datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "volume_id":volume_id,"slice_z":int(z),"ball_id":ball_id,
           "center_y":round(float(center_yx[0]),2),"center_x":round(float(center_yx[1]),2),
           "verdict":verdict,"defect":defect,"reviewer":reviewer.strip(),"comment":comment,
           "ai_suggestion":suggestion,"ai_confidence":"" if confidence is None else round(float(confidence),4),
           "sample":str(path.relative_to(root))}
    try:
        journal=root/"feedback_reviews.csv"
        exists=journal.exists()
        if exists:
            with journal.open(newline="",encoding="utf-8-sig") as f:
                header=next(csv.reader(f),[])
            if list(FIELDS)!=header:raise ValueError("Review journal header mismatch; don't append")
        with journal.open("a",newline="",encoding="utf-8-sig") as f:
            writer=csv.DictWriter(f,fieldnames=FIELDS)
            if not exists:writer.writeheader()
            writer.writerow(entry)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return entry

def split_review_samples(root):
    files=sorted(Path(root).glob("defect_samples/*/sample_*.npz"))
    groups={}
    for path in files:
        with np.load(path,allow_pickle=False) as arr:
            image=arr["image"];label=int(arr["label"])
        if image.shape!=(3,SIZE,SIZE) or label not in range(len(LABELS)):
            raise ValueError(f"Bad human-confirmed sample: {path}")
        groups.setdefault(path.parent.name,[]).append((path,label))
    if len(groups)<2:raise ValueError("Need confirmed OK and NG examples from at least 2 independent volumes")
    def labelset(data):return {lbl for _,lbl in data}
    all_labels=labelset([v for data in groups.values() for v in data])
    if len(all_labels)<2 or LABELS.index("OK") not in all_labels:
        raise ValueError("Require confirmed OK and at least one NG defect class")
    for holdout in sorted(groups):
        val=groups[holdout]
        train=[v for key,data in groups.items() if key!=holdout for v in data]
        if labelset(train)==all_labels and labelset(val)==all_labels and len(train)>=4 and len(val)>=2:
            return train,val,sorted(all_labels),holdout
    raise ValueError("Need each defect class including OK in multiple volumes; at least 4 training and 2 validation samples")

def _torch():
    import torch
    from torch import nn
    return torch,nn

def network():
    torch,nn=_torch()
    return nn.Sequential(
        nn.Conv2d(3,16,3,padding=1),nn.ReLU(),nn.MaxPool2d(2),
        nn.Conv2d(16,32,3,padding=1),nn.ReLU(),nn.MaxPool2d(2),
        nn.Conv2d(32,48,3,padding=1),nn.ReLU(),nn.AdaptiveAvgPool2d(1),
        nn.Flatten(),nn.Linear(48,len(LABELS)))

def _batch(paths):
    torch,_=_torch()
    images=[];labels=[]
    for path,expected in paths:
        with np.load(path,allow_pickle=False) as d:
            images.append(np.asarray(d["image"],dtype=np.float32))
            labels.append(int(d["label"]))
    return torch.from_numpy(np.stack(images)),torch.tensor(labels,dtype=torch.long)

def train_feedback(root,epochs=12,progress=None):
    torch,_=_torch()
    if not (1<=int(epochs)<=200):raise ValueError("Epochs must be 1..200")
    tr,val,classes,holdout=split_review_samples(root)
    torch.manual_seed(42)
    model=network()
    x,y=_batch(tr);vx,vy=_batch(val)
    optimizer=torch.optim.AdamW(model.parameters(),lr=.001)
    for step in range(int(epochs)):
        model.train()
        for idx in torch.randperm(len(y)).split(8):
            logits=model(x[idx])
            # Do not predict classes that have zero confirmed training examples.
            unavailable=[c for c in range(len(LABELS)) if c not in classes]
            if unavailable:logits[:,unavailable]=-1e4
            loss=torch.nn.functional.cross_entropy(logits,y[idx])
            optimizer.zero_grad();loss.backward();optimizer.step()
        if progress:progress(f"Defect training {step+1}/{epochs}")
    model.eval()
    with torch.inference_mode():
        scores=model(vx)
        unavailable=[c for c in range(len(LABELS)) if c not in classes]
        if unavailable:scores[:,unavailable]=-1e4
        guesses=scores.argmax(dim=1)
        accuracy=float((guesses==vy).float().mean())
    matrix={LABELS[k]:{"correct":int(((vy==k)&(guesses==k)).sum()),
                       "total":int((vy==k).sum())} for k in classes}
    checkpoint={"weights":model.state_dict(),"supported_classes":classes,
                "validation_volume":holdout,"validation_accuracy":accuracy,
                "validation_by_class":matrix,"train_count":len(tr),"validation_count":len(val)}
    path=Path(root)/"defect_classifier.pt"
    torch.save(checkpoint,path)
    return path,checkpoint

def load_feedback(path):
    torch,_=_torch()
    state=torch.load(path,map_location="cpu",weights_only=True)
    model=network()
    model.load_state_dict(state["weights"])
    model.eval()
    return model,state

def predict_feedback(model,state,patch,threshold=.80):
    torch,_=_torch()
    p=np.asarray(patch,dtype=np.float32)
    if p.shape!=(3,SIZE,SIZE):raise ValueError("Expected 64px centered CT crop")
    with torch.inference_mode():
        logits=model(torch.from_numpy(p)[None])[0]
        for i in range(len(LABELS)):
            if i not in state["supported_classes"]:logits[i]=-1e4
        probs=torch.softmax(logits,dim=0)
        idx=int(probs.argmax());confidence=float(probs[idx])
    label=LABELS[idx]
    return {"suggestion":label,"confidence":round(confidence,4),
            "status":"REVIEW" if confidence<threshold else "HUMAN_CONFIRM_REQUIRED",
            "validation_accuracy":state.get("validation_accuracy"),
            "warning":"Research-only; class probabilities are not calibrated and no automatic NG decision is authorized"}
