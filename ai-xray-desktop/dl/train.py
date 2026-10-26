"""Train on paired 3-slice npz input and 2D categorical masks; group split by volume."""
from __future__ import annotations
import argparse,json,random
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import Dataset,DataLoader
try:
    from .model import UNet25D,predict
except ImportError:
    from model import UNet25D,predict

class Data(Dataset):
    def __init__(self,files):self.files=list(files)
    def __len__(self):return len(self.files)
    def __getitem__(self,idx):
        with np.load(self.files[idx],allow_pickle=False) as d:
            x=d["image"].astype(np.float32)
            y=d["mask"].astype(np.int64)
        if x.ndim!=3 or x.shape[0]!=3 or y.shape!=x.shape[1:]:
            raise ValueError(f"Invalid 2.5D array and label shapes in {self.files[idx]}")
        if not np.isfinite(x).all() or x.min()<0 or x.max()>1:
            raise ValueError("image must be normalized to 0..1")
        if y.min()<0 or y.max()>2:raise ValueError("Masks must be background=0 solder=1 void=2")
        return torch.from_numpy(x),torch.from_numpy(y)

def grouped_split(root):
    paths=sorted(Path(root).glob("*/*.npz"))
    groups=sorted({p.parent.name for p in paths})
    if len(groups)<2:raise ValueError("At least 2 different volume-id directories are required for validation")
    rng=random.Random(42);rng.shuffle(groups)
    val=set(groups[:max(1,round(.2*len(groups)))])
    train=[p for p in paths if p.parent.name not in val]
    valid=[p for p in paths if p.parent.name in val]
    if not train or not valid:raise ValueError("Train/validation empty")
    return train,valid

def score(model,loader,dev):
    model.eval();inter=np.zeros(2,np.float64);union=np.zeros(2,np.float64)
    with torch.inference_mode():
        for x,y in loader:
            pred=model(x.to(dev)).argmax(1).cpu()
            for j,cl in enumerate((1,2)):
                p=pred==cl;t=y==cl
                inter[j]+=(p&t).sum().item()
                union[j]+=(p|t).sum().item()
    return {k:float((i+1e-8)/(u+1e-8)) for k,i,u in zip(("solder_iou","void_iou"),inter,union)}

def main(argv=None):
    ap=argparse.ArgumentParser()
    ap.add_argument("--data",required=True,help="dataset/volume_ID/sample.npz")
    ap.add_argument("--out",default="trained/unet25d.pt")
    ap.add_argument("--epochs",type=int,default=10)
    ap.add_argument("--batch",type=int,default=4)
    ap.add_argument("--lr",type=float,default=1e-3)
    ap.add_argument("--base",type=int,default=16)
    args=ap.parse_args(argv)
    torch.manual_seed(42);np.random.seed(42)
    tr,va=grouped_split(args.data)
    device="cuda" if torch.cuda.is_available() else "cpu"
    model=UNet25D(args.base).to(device)
    opt=torch.optim.AdamW(model.parameters(),lr=args.lr)
    loss_fn=torch.nn.CrossEntropyLoss()
    trainloader=DataLoader(Data(tr),batch_size=args.batch,shuffle=True,num_workers=0)
    validloader=DataLoader(Data(va),batch_size=args.batch,num_workers=0)
    best=-1
    for epoch in range(args.epochs):
        model.train();total=0.
        for x,y in trainloader:
            x=x.to(device);y=y.to(device)
            opt.zero_grad();loss=loss_fn(model(x),y)
            loss.backward();opt.step();total+=float(loss.detach())
        metrics=score(model,validloader,device)
        print(json.dumps({"epoch":epoch+1,"loss_sum":round(total,5),**metrics}))
        if metrics["void_iou"]>best:
            best=metrics["void_iou"]
            out=Path(args.out);out.parent.mkdir(parents=True,exist_ok=True)
            torch.save({"weights":model.cpu().state_dict(),"base":args.base,
                        "classes":["background","solder","void"],
                        "validation":metrics,"train_volume_ids":sorted({p.parent.name for p in tr}),
                        "validation_volume_ids":sorted({p.parent.name for p in va})},out)
            model.to(device)
    print("Saved checkpoint:",args.out,"validation is not proof of production accuracy")

if __name__=="__main__":main()
