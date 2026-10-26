import tkinter as tk
from tkinter import filedialog,ttk,messagebox
from pathlib import Path
from threading import Thread
import csv,json,re
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
        self.title("AI X-ray Studio - Defect Feedback / Mask Training (Research)")
        self.geometry("1020x730")
        self.model=None;self.masks={};self.pred=None;self.photo=None
        self.dataset=tk.StringVar(value=str(Path.home()/"AI-Xray-Dataset"))
        loaded_name=self.parent.files[0].stem if getattr(self.parent,"files",None) else "unnamed_volume"
        loaded_name=re.sub(r"[^A-Za-z0-9_.-]+","_",loaded_name).strip("._")[:90] or "unnamed_volume"
        self.volume_id=tk.StringVar(value=loaded_name)
        self.status=tk.StringVar(value="Open volume in main viewer, then label solder/void")
        self.expected_centers=None
        self.cls=tk.IntVar(value=1)
        self.epochs=tk.IntVar(value=10)
        self.zoom=1.0;self.panx=0;self.pany=0;self.drag_origin=None
        self.edge_tolerance=tk.IntVar(value=20)
        self.auto_mode=tk.BooleanVar(value=True)
        self.ball_id=tk.StringVar(value="1");self.reviewer=tk.StringVar(value="Engineer")
        self.defect=tk.StringVar(value="NONE");self.review_comment=tk.StringVar(value="")
        self.review_mode=tk.BooleanVar(value=True)
        self.selected_yx=None
        self.mask_verified=tk.BooleanVar(value=False)
        self.defect_model=None;self.defect_checkpoint=None
        self.ai_suggestion="NOT_TRAINED";self.ai_confidence=None
        bar=ttk.Frame(self);bar.pack(fill="x")
        for title,fn in [("Save Label",self.save_label),("Train Model",self.train),("Load Model",self.load_model),("Predict Slice",self.predict_slice),("Load Ball Centers CSV",self.load_centers),("Analyze 3D",self.analyze3d)]:
            ttk.Button(bar,text=title,command=fn).pack(side="left",padx=3,pady=5)
        options=ttk.Frame(self);options.pack(fill="x")
        for title,var,width in [("Dataset",self.dataset,32),("Volume ID",self.volume_id,14),("Epochs",self.epochs,5)]:
            ttk.Label(options,text=title).pack(side="left")
            ttk.Entry(options,textvariable=var,width=width).pack(side="left",padx=5)
        for title,value in [("Background",0),("Solder",1),("Void",2)]:
            ttk.Radiobutton(options,text=title,variable=self.cls,value=value).pack(side="left")
        review=ttk.Frame(self);review.pack(fill="x",padx=6)
        ttk.Label(review,text="Ball ID").pack(side="left");ttk.Entry(review,textvariable=self.ball_id,width=7).pack(side="left")
        ttk.Label(review,text="Defect").pack(side="left")
        ttk.Combobox(review,textvariable=self.defect,values=["NONE","VOID","INSUFFICIENT_SOLDER","MISSING_BALL","SOLDER_BRIDGE","SHAPE","OTHER"],width=20,state="readonly").pack(side="left")
        ttk.Entry(review,textvariable=self.reviewer,width=14).pack(side="left")
        ttk.Entry(review,textvariable=self.review_comment,width=24).pack(side="left")
        ttk.Button(review,text="Confirm OK",command=lambda:self.confirm("OK")).pack(side="left")
        ttk.Button(review,text="Confirm NG",command=lambda:self.confirm("NG")).pack(side="left")
        feedback=ttk.Frame(self);feedback.pack(fill="x",padx=6)
        ttk.Checkbutton(feedback,text="1) Select Ball (click image)",variable=self.review_mode).pack(side="left",padx=3)
        ttk.Button(feedback,text="2) AI Suggest Defect",command=self.predict_defect).pack(side="left",padx=3)
        ttk.Button(feedback,text="3) Train on Confirmed Examples",command=self.train_defect).pack(side="left",padx=3)
        ttk.Button(feedback,text="Load Defect Model",command=self.load_defect_model).pack(side="left",padx=3)
        ttk.Checkbutton(feedback,text="Verified full mask",variable=self.mask_verified).pack(side="left",padx=3)
        zoom=ttk.Frame(self);zoom.pack(fill="x",padx=6)
        ttk.Checkbutton(zoom,text="Auto Edge on click",variable=self.auto_mode).pack(side="left")
        ttk.Label(zoom,text="Edge tolerance").pack(side="left")
        ttk.Scale(zoom,from_=2,to=60,variable=self.edge_tolerance).pack(side="left")
        ttk.Button(zoom,text="Zoom +",command=lambda:self.adjust_zoom(1.3)).pack(side="left")
        ttk.Button(zoom,text="Zoom -",command=lambda:self.adjust_zoom(1/1.3)).pack(side="left")
        ttk.Button(zoom,text="Fit",command=self.fit).pack(side="left")
        ttk.Label(zoom,text="Wheel zoom | Right-drag pan | Auto edge: click region").pack(side="left")
        self.canvas=tk.Canvas(self,bg="#20242b")
        self.canvas.pack(fill="both",expand=True,padx=8,pady=5)
        self.canvas.bind("<Configure>",lambda _:self.refresh())
        self.canvas.bind("<B1-Motion>",self.paint)
        self.canvas.bind("<Button-1>",self.paint)
        self.canvas.bind("<MouseWheel>",lambda e:self.adjust_zoom(1.2 if e.delta>0 else 1/1.2))
        self.canvas.bind("<Button-4>",lambda e:self.adjust_zoom(1.2))
        self.canvas.bind("<Button-5>",lambda e:self.adjust_zoom(1/1.2))
        self.canvas.bind("<ButtonPress-3>",self.pan_start)
        self.canvas.bind("<B3-Motion>",self.pan_move)
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
            self.scale=min(cw/im.shape[1],ch/im.shape[0])*self.zoom
            self.photo=ImageTk.PhotoImage(Image.fromarray(rgb).resize((max(1,int(im.shape[1]*self.scale)),max(1,int(im.shape[0]*self.scale)))))
            self.ox=(cw-self.photo.width())//2+self.panx;self.oy=(ch-self.photo.height())//2+self.pany
            self.canvas.delete("all");self.canvas.create_image(self.ox,self.oy,anchor="nw",image=self.photo)
            if self.selected_yx is not None:
                cy,cx=self.selected_yx
                px=self.ox+(cx+.5)*self.scale;py=self.oy+(cy+.5)*self.scale
                self.canvas.create_oval(px-9,py-9,px+9,py+9,outline="#ffdc55",width=2)
                self.canvas.create_line(px-14,py,px+14,py,fill="#ffdc55")
                self.canvas.create_line(px,py-14,px,py+14,fill="#ffdc55")
        except Exception:pass
    def adjust_zoom(self,factor):
        self.zoom=max(.5,min(16.,self.zoom*factor));self.refresh()
    def fit(self):
        self.zoom=1.;self.panx=0;self.pany=0;self.refresh()
    def pan_start(self,event):
        self.drag_origin=(event.x,event.y,self.panx,self.pany)
    def pan_move(self,event):
        if self.drag_origin:
            x,y,px,py=self.drag_origin
            self.panx=px+event.x-x;self.pany=py+event.y-y;self.refresh()
    def review_stack(self):
        vol=self.parent.vol
        if vol is not None:return stack3(vol,self.parent.z)
        im=self.get_image().astype(np.float32)/255.
        return np.stack([im,im,im])
    def confirm(self,verdict):
        try:
            from defect_feedback import save_feedback
            if self.selected_yx is None:raise ValueError("Select Ball on the image first")
            defect=self.defect.get()
            if verdict=="OK":
                if defect not in ("OK","NONE"):raise ValueError("Set Defect to NONE or OK before Confirm OK")
                defect="OK"
            else:
                if defect in ("NONE","OK"):raise ValueError("Choose the correct NG defect first")
            entry=save_feedback(self.dataset.get(),self.volume_id.get(),self.ball_id.get(),
                self.parent.z,self.selected_yx,self.review_stack(),verdict,defect,
                self.reviewer.get(),self.review_comment.get(),
                suggestion=self.ai_suggestion,confidence=self.ai_confidence)
            self.status.set(f"Confirmed {entry['defect']} for {entry['ball_id']}; crop saved to defect_samples. Train Defect AI when enough volumes.")
            self.ai_suggestion="NOT_TRAINED";self.ai_confidence=None
        except Exception as e:messagebox.showerror("Review not saved",str(e))
    def select_ball(self,y,x):
        if self.expected_centers:
            d=[(cy-y)**2+(cx-x)**2 for cy,cx in self.expected_centers]
            nearest=int(np.argmin(d))
            if d[nearest]<=15**2:
                self.ball_id.set(str(nearest+1))
            else:
                self.ball_id.set(f"XY_{y}_{x}")
        else:
            self.ball_id.set(f"XY_{y}_{x}")
        self.selected_yx=(y,x)
        self.ai_suggestion="NOT_PREDICTED";self.ai_confidence=None
        self.status.set(f"Ball {self.ball_id.get()} selected at Y={y} X={x}; use AI Suggest, correct Defect, Confirm OK/NG")
        self.refresh()
    def train_defect(self):
        if self.defect_model is not None:self.defect_model=None
        def work():
            from defect_feedback import train_feedback
            output,state=train_feedback(self.dataset.get(),int(self.epochs.get()),
                lambda msg:self.after(0,lambda t=msg:self.status.set(t)))
            from defect_feedback import load_feedback
            self.defect_model,self.defect_checkpoint=load_feedback(output)
            self.after(0,lambda:self.status.set(f"Defect model saved; held-out volume {state['validation_volume']} accuracy={state['validation_accuracy']:.2%}; human review still required"))
        self.worker(work)
    def load_defect_model(self):
        path=filedialog.askopenfilename(filetypes=[("Confirmed defect model","*.pt")])
        if not path:return
        def work():
            from defect_feedback import load_feedback
            self.defect_model,self.defect_checkpoint=load_feedback(path)
            self.after(0,lambda:self.status.set("Defect classifier loaded; select a Ball then AI Suggest Defect"))
        self.worker(work)
    def predict_defect(self):
        if self.selected_yx is None:
            messagebox.showinfo("Select first","Enable Select Ball and click the ball first");return
        if self.defect_model is None:
            self.status.set("NOT TRAINED: Please confirm examples from multiple volumes then Train Defect AI")
            return
        center=self.selected_yx;stack=self.review_stack()
        def work():
            from defect_feedback import crop_stack,predict_feedback
            result=predict_feedback(self.defect_model,self.defect_checkpoint,crop_stack(stack,center))
            self.ai_suggestion=result["suggestion"];self.ai_confidence=result["confidence"]
            self.after(0,lambda:self.status.set(
                f"AI proposes {result['suggestion']} ({result['confidence']:.1%}), {result['status']}. Select true defect and Confirm."))
        self.worker(work)
    def paint(self,event):
        try:
            x=int((event.x-self.ox)/self.scale);y=int((event.y-self.oy)/self.scale)
            m=self.mask()
            if 0<=x<m.shape[1] and 0<=y<m.shape[0]:
                if self.review_mode.get():
                    if getattr(event,"type",None) is not None and str(event.type)=="6":return
                    self.select_ball(y,x)
                    return
                self.mask_verified.set(False)
                if self.auto_mode.get():
                    from autolabel import auto_region
                    region=auto_region(self.get_image(),(x,y),int(self.edge_tolerance.get()))
                    m[region]=int(self.cls.get())
                    self.status.set(f"Auto Edge proposed {int(region.sum())} px; inspect before Save Label")
                else:
                    cv2.circle(m,(x,y),max(1,round(4/self.zoom)),int(self.cls.get()),-1)
                self.refresh()
        except Exception as e:self.status.set(str(e))
    def save_label(self):
        try:
            if not self.mask_verified.get():raise ValueError("Review the FULL mask and tick Verified full mask before saving for segmentation training")
            if self.selected_yx is None:raise ValueError("Select Ball first to identify the labeled region")
            z=self.parent.z;vol=self.parent.vol
            stack=stack3(vol,z) if vol is not None else np.stack([self.get_image().astype(np.float32)/255]*3)
            name=self.volume_id.get()
            if not name or name in (".","..") or any(c in name for c in '\\/:*?"<>|'):raise ValueError("Invalid volume ID")
            path=Path(self.dataset.get())/name
            path.mkdir(parents=True,exist_ok=True)
            if np.count_nonzero(self.mask())<5:raise ValueError("Mask is empty; use Auto Edge or brush before saving")
            np.savez_compressed(path/f"z{z:04d}.npz",image=stack.astype("float32"),mask=self.mask())
            self.status.set("Verified full-slice mask saved; training dataset updated")
            self.mask_verified.set(False)
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
    def load_centers(self):
        p=filedialog.askopenfilename(filetypes=[("CSV","*.csv")])
        if not p:return
        try:
            centers=[]
            with open(p,newline="",encoding="utf-8-sig") as f:
                for row in csv.DictReader(f):
                    centers.append((float(row["y"]),float(row["x"])))
            if not centers:raise ValueError("CSV has no ball coordinates")
            self.expected_centers=centers
            self.status.set(f"Loaded {len(centers)} expected ball positions (Y,X pixel coords)")
        except Exception as e:messagebox.showerror("Invalid centers CSV","Use columns y,x (pixels). "+str(e))
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
            instances=analyze_instances(result,centers_yx=self.expected_centers,spacing_zyx_um=(30,30,30),radius_px=9)
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
