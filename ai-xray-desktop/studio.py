import tkinter as tk
from tkinter import filedialog,ttk,messagebox
from pathlib import Path
from threading import Thread
import csv,json
import numpy as np
import cv2
from PIL import Image,ImageTk
from scipy.ndimage import label,binary_fill_holes

def stack3(vol,z):
    return np.stack([np.asarray(vol[min(max(z+d,0),len(vol)-1)],dtype=np.float32)/255 for d in (-1,0,1)])

def volume_metrics(masks,um=30):
    shape=(masks==1)|(masks==2)
    envelope=binary_fill_holes(shape)
    components,n=label(envelope)
    rows=[]
    for k in range(1,n+1):
        region=components==k
        area=int(region.sum())
        if area<10:continue
        nv=int((region&(masks==2)).sum())
        rows.append({"id":len(rows)+1,"volume_mm3":area*um**3/1e9,"void_mm3":nv*um**3/1e9,"void_pct":nv/area*100})
    return rows

class Studio(tk.Toplevel):
    def __init__(self,parent):
        super().__init__(parent)
        self.parent=parent
        self.title("AI X-ray Studio v0.7 - RESEARCH ONLY")
        self.geometry("1020x730")
        self.model=None;self.masks={};self.pred=None;self.photo=None
        self.dataset=tk.StringVar(value=str(Path.home()/"AI-Xray-Dataset"))
        self.volume_id=tk.StringVar(value="volume_001")
        self.status=tk.StringVar(value="Open volume in main viewer, then label solder/void")
        self.cls=tk.IntVar(value=1)
        self.epochs=tk.IntVar(value=10)
        bar=ttk.Frame(self);bar.pack(fill="x")
        for title,fn in [("Save Label",self.save_label),("Train Model",self.train),("Load Model",self.load_model),("Predict Slice",self.predict_slice),("Analyze 3D",self.analyze3d)]:
            ttk.Button(bar,text=title,command=fn).pack(side="left",padx=3,pady=5)
        options=ttk.Frame(self);options.pack(fill="x")
        for title,var,width in [("Dataset",self.dataset,32),("Volume ID",self.volume_id,14),("Epochs",self.epochs,5)]:
            ttk.Label(options,text=title).pack(side="left")
            ttk.Entry(options,textvariable=var,width=width).pack(side="left",padx=5)
        for title,value in [("Background",0),("Solder",1),("Void",2)]:
            ttk.Radiobutton(options,text=title,variable=self.cls,value=value).pack(side="left")
        self.canvas=tk.Canvas(self,bg="#20242b")
        self.canvas.pack(fill="both",expand=True,padx=8,pady=5)
        self.canvas.bind("<Configure>",lambda _:self.refresh())
        self.canvas.bind("<B1-Motion>",self.paint)
        self.canvas.bind("<Button-1>",self.paint)
        ttk.Label(self,textvariable=self.status).pack(fill="x")
        ttk.Label(self,text="Experimental: predicted labels and 3D values are NOT manufacturing quality decisions").pack()
        self.after(100,self.refresh)
    def get_image(self):
        return self.parent.image()
    def mask(self):
        z=self.parent.z
        if z not in self.masks:self.masks[z]=np.zeros(self.get_image().shape,np.uint8)
        return self.masks[z]
    def refresh(self):
        try:
            im=self.get_image()
            rgb=cv2.cvtColor(im,cv2.COLOR_GRAY2RGB)
            m=self.masks.get(self.parent.z)
            if m is not None:
                for v,color in [(1,(40,240,75)),(2,(240,60,50))]:
                    p=m==v;rgb[p]=(rgb[p]*.5+np.array(color)*.5).astype(np.uint8)
            cw,ch=self.canvas.winfo_width(),self.canvas.winfo_height()
            self.scale=min(cw/im.shape[1],ch/im.shape[0])
            self.photo=ImageTk.PhotoImage(Image.fromarray(rgb).resize((max(1,int(im.shape[1]*self.scale)),max(1,int(im.shape[0]*self.scale)))))
            self.ox=(cw-self.photo.width())//2;self.oy=(ch-self.photo.height())//2
            self.canvas.delete("all");self.canvas.create_image(self.ox,self.oy,anchor="nw",image=self.photo)
        except Exception:pass
    def paint(self,event):
        try:
            x=int((event.x-self.ox)/self.scale);y=int((event.y-self.oy)/self.scale)
            m=self.mask()
            if 0<=x<m.shape[1] and 0<=y<m.shape[0]:
                cv2.circle(m,(x,y),4,int(self.cls.get()),-1)
                self.refresh()
        except Exception:pass
    def save_label(self):
        try:
            z=self.parent.z;vol=self.parent.vol
            stack=stack3(vol,z) if vol is not None else np.stack([self.get_image().astype(np.float32)/255]*3)
            name=self.volume_id.get()
            if not name or name in (".","..") or any(c in name for c in '\\/:*?"<>|'):raise ValueError("Invalid volume ID")
            path=Path(self.dataset.get())/name
            path.mkdir(parents=True,exist_ok=True)
            np.savez_compressed(path/f"z{z:04d}.npz",image=stack.astype("float32"),mask=self.mask())
            self.status.set("Saved labeled slice; label multiple VOLUME IDs for validation")
        except Exception as e:messagebox.showerror("Save label",str(e))
    def worker(self,fn):
        def run():
            try:fn()
            except Exception as e:self.after(0,lambda:self.status.set("Error: "+str(e)))
        Thread(target=run,daemon=True).start()
    def train(self):
        def work():
            import torch
            from torch.utils.data import DataLoader
            from dl.model import UNet25D
            from dl.train import grouped_split,Data,score
            tr,va=grouped_split(self.dataset.get())
            model=UNet25D(base=16);optimizer=torch.optim.AdamW(model.parameters(),lr=.001)
            loader=DataLoader(Data(tr),batch_size=2,shuffle=True,num_workers=0)
            validation=DataLoader(Data(va),batch_size=2)
            best=-1
            for epoch in range(int(self.epochs.get())):
                model.train()
                for x,y in loader:
                    optimizer.zero_grad();loss=torch.nn.functional.cross_entropy(model(x),y);loss.backward();optimizer.step()
                metrics=score(model,validation,"cpu")
                self.after(0,lambda e=epoch,m=metrics:self.status.set(f"Epoch {e+1}: {m}"))
                if metrics["void_iou"]>best:
                    best=metrics["void_iou"]
                    out=Path(self.dataset.get())/"trained.pt"
                    torch.save({"weights":model.state_dict(),"base":16,"validation":metrics},out)
            self.model=model.eval()
            self.after(0,lambda:self.status.set("Trained model saved to dataset/trained.pt; validate before use"))
        self.worker(work)
    def load_model(self):
        path=filedialog.askopenfilename(filetypes=[("Model weights","*.pt")])
        if not path:return
        def work():
            import torch
            from dl.model import UNet25D
            data=torch.load(path,map_location="cpu",weights_only=True)
            model=UNet25D(data["base"])
            model.load_state_dict(data["weights"]);self.model=model.eval()
            self.after(0,lambda:self.status.set("Model loaded "+path))
        self.worker(work)
    def predict_slice(self):
        if self.model is None:messagebox.showwarning("No trained model","Train or load a model first");return
        def work():
            from dl.model import predict
            z=self.parent.z;v=self.parent.vol
            stack=stack3(v,z) if v is not None else np.stack([self.get_image().astype(np.float32)/255]*3)
            mask,conf=predict(self.model,stack);self.masks[z]=mask
            self.after(0,self.refresh)
            self.after(0,lambda:self.status.set("Predicted slice, mean confidence %.3f; review mask manually"%conf.mean()))
        self.worker(work)
    def analyze3d(self):
        if self.model is None or self.parent.vol is None:
            messagebox.showwarning("Requires volume and model","Open VGI+REC2 and load trained model");return
        def work():
            from dl.model import predict
            volume=self.parent.vol
            result=np.zeros(volume.shape,np.uint8)
            for z in range(len(volume)):
                result[z],_=predict(self.model,stack3(volume,z))
                self.after(0,lambda i=z:self.status.set(f"3D slice {i+1}/{len(volume)}"))
            self.pred=result
            from measurement3d import measure_3d,volume_summary
            rows=measure_3d(result,(30,30,30),peers=10)
            from geometry_screen import measure_ball_projection, peer_screen
            projection=[]
            for record in rows:
                # Estimate the measurement ROI from predicted component footprint.
                # This ROI is NOT a calibrated CAD reference for true coverage.
                r=max(3.,float(np.sqrt(max(record["projected_area_mm2"],0.)*1e6/900./np.pi))*1.35)
                item=measure_ball_projection(result,(record["y"],record["x"]),r)
                item["object_id"]=record["id"]
                projection.append(item)
            projection=peer_screen(projection,k=10) if projection else []
            from instance3d import analyze_instances
            instances=analyze_instances(result,spacing_zyx_um=(30,30,30),radius_px=9)
            summary=volume_summary(result,(30,30,30))
            out=Path(self.dataset.get())/"results";out.mkdir(parents=True,exist_ok=True)
            np.savez_compressed(out/"labels3d.npz",labels=result)
            with (out/"objects3d.csv").open("w",newline="") as f:
                writer=csv.DictWriter(f,list(rows[0]) if rows else ["id"]);writer.writeheader();writer.writerows(rows)
            if projection:
                with (out/"ball_geometry.csv").open("w",newline="",encoding="utf-8-sig") as f:
                    writer=csv.DictWriter(f,list(projection[0]));writer.writeheader();writer.writerows(projection)
            for name,key in (("balls3d.csv","balls"),("bridge_candidates.csv","bridges"),("missing_candidates.csv","missing"),("void_components3d.csv","voids")):
                data=instances[key]
                if data:
                    with (out/name).open("w",newline="",encoding="utf-8-sig") as f:
                        wr=csv.DictWriter(f,fieldnames=list(data[0]));wr.writeheader();wr.writerows(data)
            np.savez_compressed(out/"instance_labels3d.npz",labels=instances["instance_labels"])
            (out/"summary.json").write_text(json.dumps({"objects":len(rows),"assumed_voxel_um":30,"overall":summary,"warning":"Research only. ROI derived from predicted object: coverage is relative to an inferred circular window, NOT true CAD coverage. Touching balls can merge; false joins and mislabeled voids possible"}))
            self.after(0,lambda:self.status.set(f"Saved {len(rows)} candidate 3D objects to {out}"))
        self.worker(work)
