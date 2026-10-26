"""Research-only X-ray BGA 2D / CT-slice peer inspection. No trained DL model."""
from pathlib import Path, PureWindowsPath
import csv, json, math, re
import tkinter as tk
from tkinter import filedialog, simpledialog, messagebox, ttk
import cv2
import numpy as np
from scipy.ndimage import binary_fill_holes
from PIL import Image, ImageTk

EXT={".png",".jpg",".jpeg",".tif",".tiff",".bmp"}

def preview8(src):
    a=np.asarray(src)
    if a.ndim==3:
        a=cv2.cvtColor(a,cv2.COLOR_BGRA2GRAY if a.shape[2]==4 else cv2.COLOR_BGR2GRAY)
    if a.ndim!=2 or a.size==0:raise ValueError("Invalid image")
    if a.dtype==np.uint8:return a.copy()
    f=a[np.isfinite(a)]
    if f.size==0:raise ValueError("No finite voxels")
    lo,hi=np.percentile(f,[0.5,99.5])
    return np.zeros(a.shape,np.uint8) if hi<=lo else np.clip((a.astype(np.float32)-lo)*255/(hi-lo),0,255).astype(np.uint8)

def open_image(path):
    a=cv2.imdecode(np.fromfile(str(path),np.uint8),cv2.IMREAD_UNCHANGED)
    if a is None:raise ValueError("Image decode failed")
    return preview8(a)

def vgi_sections(path):
    b=Path(path).read_bytes()
    if len(b)>10_000_000:raise ValueError("VGI file too large")
    s=None
    for enc in ("utf-8-sig","utf-16","cp1252"):
        try:
            s=b.decode(enc)
            if "\x00" not in s:break
        except UnicodeError:pass
    if s is None or "\x00" in s:raise ValueError("Unrecognized VGI metadata")
    sec={"header":{}};part="header"
    for line in s.splitlines():
        line=line.strip()
        if not line or line.startswith(("#",";")):continue
        if line.startswith("{") and line.endswith("}"):
            vol=line[1:-1].lower()
            if vol.startswith("volume") and vol!="volume1":raise ValueError("Multi-volume files unsupported")
            part="header"
        elif line.startswith("[") and line.endswith("]"):
            part=line[1:-1].lower();sec.setdefault(part,{})
        elif "=" in line:
            k,v=line.split("=",1);sec.setdefault(part,{})[k.strip().lower()]=v.strip().strip('"')
    return sec

def read_volume(vgi,rec,bo=None):
    from rec2_png import open_png_stacked
    from pathlib import Path
    try:
        return open_png_stacked(vgi,rec,vgi_sections(vgi))
    except ValueError as ex:
        if "Unsupported REC2 PNG variant" not in str(ex):
            raise
    return read_volume_raw(vgi,rec,bo)

def read_volume_raw(vgi,rec,bo=None):
    vgi=Path(vgi);rec=Path(rec)
    if not vgi.is_file() or not rec.is_file() or vgi.suffix.lower()!=".vgi" or rec.suffix.lower()!=".rec2":
        raise ValueError("Need matching .vgi + .rec2 pair")
    sec=vgi_sections(vgi);f=sec.get("file1",{})
    if any(re.fullmatch(r"file[2-9]\d*",k) for k in sec):raise ValueError("Multiple payloads unsupported")
    name=f.get("name","")
    if name and PureWindowsPath(name).suffix.lower()==".rec2" and PureWindowsPath(name).name.lower()!=rec.name.lower():
        raise ValueError("VGI REC2 filename does not match selected payload")
    if f.get("fileformat","").lower()!="raw":
        raise ValueError("REC2 not declared RAW; proprietary/compressed format is NOT supported")
    try:
        dims=tuple(map(int,(f.get("size") or sec["representation"]["size"]).split()))
        bits=int(f["bitsperelement"]);skip=int(f.get("skipheader","0"))
        if len(dims)!=3 or min(dims)<=0 or skip<0:raise ValueError()
    except (KeyError,ValueError,TypeError):raise ValueError("Bad or missing dimensions/bit depth")
    kind=f.get("datatype","").lower()
    if kind in ("unsigned integer","unsigned int","uint","uint8","uint16","uint32"):fmt="u"
    elif kind in ("signed integer","signed int","int","integer signed","int8","int16","int32"):fmt="i"
    elif kind in ("float","floating point","float32","float64","double"):fmt="f"
    else:raise ValueError("Unknown voxel datatype")
    if bits not in ((32,64) if fmt=="f" else (8,16,32)):raise ValueError("Unsupported bit depth")
    dt=np.dtype(fmt+str(bits//8))
    if rec.stat().st_size!=math.prod(dims)*dt.itemsize+skip:raise ValueError("REC2 size mismatch; refusing unsafe decode")
    order={"little":"<","littleendian":"<","big":">","bigendian":">"}.get(str(bo or f.get("byteorder") or f.get("endian") or f.get("endianness")).lower())
    if order is None:raise ValueError("Byte order unknown; verify from CT viewer")
    if dt.itemsize>1:dt=dt.newbyteorder(order)
    x,y,z=dims
    return np.memmap(rec,dtype=dt,mode="r",offset=skip,shape=(z,y,x))

def analyze(gray,polarity="bright",peer_k=10,pixel_um=None):
    gray=preview8(gray);h,w=gray.shape
    mode=cv2.THRESH_BINARY if polarity=="bright" else cv2.THRESH_BINARY_INV
    _,binary=cv2.threshold(cv2.GaussianBlur(gray,(3,3),0),0,255,mode|cv2.THRESH_OTSU)
    fg=binary>0;filled=binary_fill_holes(fg).astype(np.uint8)
    n,labels,stats,centers=cv2.connectedComponentsWithStats(filled,connectivity=8)
    rows=[];label_ids=[]
    for lab in range(1,n):
        x,y,bw,bh,area=map(int,stats[lab])
        if area<120 or area>h*w*.1 or x==0 or y==0 or x+bw>=w or y+bh>=h:continue
        region=labels[y:y+bh,x:x+bw]==lab
        holes=region & ~fg[y:y+bh,x:x+bw]
        vn,vlabels,vstats,_=cv2.connectedComponentsWithStats(holes.astype(np.uint8),connectivity=8)
        count=0;void_px=0
        for j in range(1,vn):
            size=int(vstats[j,cv2.CC_STAT_AREA])
            if size>=8:void_px+=size;count+=1
        contours,_=cv2.findContours(region.astype(np.uint8),cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
        if not contours:continue
        cnt=max(contours,key=cv2.contourArea);per=cv2.arcLength(cnt,True);hull=cv2.contourArea(cv2.convexHull(cnt))
        cx,cy=centers[lab]
        r={"pin":len(rows)+1,"x":round(float(cx),2),"y":round(float(cy),2),
           "area_px":area,"void_px":void_px,"void_count":count,"void_pct":round(100*void_px/area,3),
           "circularity":round(min(1,4*math.pi*area/per**2),4) if per else 0,
           "solidity":round(min(1,area/hull),4) if hull else 0,
           "aspect_ratio":round(max(bw,bh)/max(1,min(bw,bh)),3)}
        if pixel_um:r["area_um2"]=round(area*pixel_um**2,2);r["void_um2"]=round(void_px*pixel_um**2,2)
        rows.append(r);label_ids.append(lab)
    for r in rows:
        near=sorted((o for o in rows if o is not r),key=lambda o:(r["x"]-o["x"])**2+(r["y"]-o["y"])**2)[:peer_k]
        r["peer_count"]=len(near)
        if len(near)<5:r.update(area_delta_pct=None,peer_void_pct=None,flag="UNVERIFIED",reason="Too few peers");continue
        med=lambda key:float(np.median([p[key] for p in near]))
        am=med("area_px");vm=med("void_pct");cm=med("circularity");sm=med("solidity")
        delta=100*(r["area_px"]/am-1) if am else 0
        reasons=[]
        if abs(delta)>=20:reasons.append("Area")
        if r["void_pct"]-vm>=5:reasons.append("Void")
        if cm-r["circularity"]>=.15:reasons.append("Shape")
        if sm-r["solidity"]>=.10:reasons.append("Solidity")
        r.update(area_delta_pct=round(delta,2),peer_void_pct=round(vm,3),
                 flag="REVIEW" if reasons else "PEER_NORMAL",
                 reason=", ".join(reasons) if reasons else "Peer baseline")
    overlay=cv2.cvtColor(gray,cv2.COLOR_GRAY2BGR)
    for r,lab in zip(rows,label_ids):
        m=labels==lab;col=(0,80,220) if r["flag"]=="REVIEW" else (0,180,30)
        overlay[m]=(overlay[m]*.6+np.asarray(col)*.4).astype(np.uint8)
        overlay[m & ~fg]=(255,230,10)
        cv2.putText(overlay,"P"+str(r["pin"]),(int(r["x"])-15,int(r["y"])-18),
                    cv2.FONT_HERSHEY_SIMPLEX,.40,col,1,cv2.LINE_AA)
    return rows,overlay

def export(folder,rows,overlay,source):
    root=Path(folder);root.mkdir(parents=True,exist_ok=True)
    cv2.imencode(".png",overlay)[1].tofile(str(root/"overlay.png"))
    if rows:
        with (root/"joints.csv").open("w",encoding="utf-8-sig",newline="") as f:
            writer=csv.DictWriter(f,list(rows[0]));writer.writeheader();writer.writerows(rows)
    (root/"summary.json").write_text(json.dumps({
        "source":source,"experimental":True,"trained_deep_learning":False,
        "measurement":"2D slice only; not validated",
        "pin_count":len(rows),"review_count":sum(r["flag"]=="REVIEW" for r in rows)
    },indent=2,ensure_ascii=False),encoding="utf-8")

class App(tk.Tk):
    def __init__(self):
        super().__init__();self.title("AI X-ray Inspection v0.2 - EXPERIMENTAL");self.geometry("1100x750")
        self.vol=None;self.files=[];self.z=0;self.rows=[];self.overlay=None;self.photo=None
        self.index=tk.DoubleVar(value=0);self.pol=tk.StringVar(value="bright")
        self.peers=tk.StringVar(value="10");self.pixel=tk.StringVar(value="")
        self.status=tk.StringVar(value="Open an image, CT folder, or verified RAW VGI+REC2")
        top=ttk.Frame(self,padding=8);top.pack(fill="x")
        for title,callback in (("Open image",self.load_image),("CT folder",self.load_folder),
            ("VGI + REC2",self.load_volume),("Cross-section",self.cross_section),("Analyze",self.run),("Export",self.save)):
            ttk.Button(top,text=title,command=callback).pack(side="left",padx=3)
        ttk.Label(top,text="Solder polarity").pack(side="left",padx=6)
        ttk.Combobox(top,textvariable=self.pol,values=["bright","dark"],width=7,state="readonly").pack(side="left")
        ttk.Label(top,text="Peers").pack(side="left",padx=5)
        ttk.Entry(top,textvariable=self.peers,width=4).pack(side="left")
        ttk.Label(top,text="um/pixel").pack(side="left",padx=5)
        ttk.Entry(top,textvariable=self.pixel,width=7).pack(side="left")
        bar=ttk.Frame(self,padding=8);bar.pack(fill="x")
        ttk.Label(bar,text="CT Slice Z").pack(side="left")
        self.slide=ttk.Scale(bar,variable=self.index,from_=0,to=0,command=self.slide_to)
        self.slide.pack(side="left",fill="x",expand=True,padx=8)
        self.slice_label=ttk.Label(bar,text="0/0");self.slice_label.pack(side="left")
        self.canvas=tk.Canvas(self,bg="#20252d",highlightthickness=0)
        self.canvas.pack(fill="both",expand=True,padx=8,pady=4)
        self.canvas.bind("<Configure>",lambda event:self.draw())
        keys=("pin","void_pct","area_px","area_delta_pct","circularity","flag","reason")
        self.table=ttk.Treeview(self,columns=keys,show="headings",height=8)
        for key in keys:
            self.table.heading(key,text=key)
            self.table.column(key,width=90 if key!="reason" else 200)
        self.table.pack(fill="x",padx=8)
        ttk.Label(self,textvariable=self.status).pack(side="left",padx=8,pady=6)
        ttk.Label(self,text="NOT FOR PRODUCTION OK/NG",foreground="#ba5100").pack(side="right",padx=8)
    def total(self):return len(self.vol) if self.vol is not None else len(self.files)
    def image(self):
        return preview8(self.vol[self.z]) if self.vol is not None else open_image(self.files[self.z])
    def reset(self):
        self.z=0;self.index.set(0);self.slide.configure(to=max(0,self.total()-1));self.show()
    def load_image(self):
        p=filedialog.askopenfilename(filetypes=[("Images","*.png *.jpg *.jpeg *.tif *.tiff *.bmp")])
        if p:self.vol=None;self.files=[Path(p)];self.reset()
    def load_folder(self):
        p=filedialog.askdirectory(title="Choose CT slice folder")
        if p:
            files=sorted(x for x in Path(p).iterdir() if x.suffix.lower() in EXT)
            if not files:messagebox.showerror("No images","Folder contains no readable image slices");return
            self.vol=None;self.files=files;self.reset()
    def load_volume(self):
        p=filedialog.askopenfilename(filetypes=[("VGI metadata","*.vgi")])
        if not p:return
        vgi=Path(p);rec=vgi.with_suffix(".rec2")
        if not rec.is_file():
            sel=filedialog.askopenfilename(title="Choose paired REC2",filetypes=[("REC2","*.rec2")])
            if not sel:return
            rec=Path(sel)
        order=simpledialog.askstring("Byte order","Enter little or big if metadata does not define it.\nLeave blank to use metadata. Verify in original viewer.",parent=self)
        if order is None:return
        try:
            vol=read_volume(vgi,rec,order.strip() or None)
            self.vol=vol;self.files=[rec];self.reset()
            messagebox.showwarning("Research format only","Supports verified stacked PNG or strict RAW.\nConfirm orientation against Omron Viewer. No trained AI or 3D segmentation.")
        except Exception as exc:messagebox.showerror("Volume import blocked",str(exc))
    def cross_section(self):
        if self.vol is None:
            messagebox.showinfo("Open Volume first","Load a supported VGI+REC2 volume before opening orthogonal viewer")
            return
        from volume_viewer import VolumeExplorer
        VolumeExplorer(self,self.vol)
    def slide_to(self,*_):
        if self.total():
            z=max(0,min(self.total()-1,round(self.index.get())))
            if z!=self.z:self.z=z;self.show()
    def show(self):
        if not self.total():return
        try:
            self.overlay=cv2.cvtColor(self.image(),cv2.COLOR_GRAY2BGR);self.rows=[]
            for row in self.table.get_children():self.table.delete(row)
            self.slice_label.configure(text=f"{self.z+1}/{self.total()}")
            self.status.set("2D slice preview - EXPERIMENTAL, NOT VALIDATED")
            self.draw()
        except Exception as exc:messagebox.showerror("Read image failed",str(exc))
    def draw(self):
        if self.overlay is None:return
        cw,ch=self.canvas.winfo_width(),self.canvas.winfo_height()
        if cw<10 or ch<10:return
        h,w=self.overlay.shape[:2];scale=min(cw/w,ch/h)
        view=cv2.resize(self.overlay,(max(1,int(w*scale)),max(1,int(h*scale))))
        self.photo=ImageTk.PhotoImage(Image.fromarray(cv2.cvtColor(view,cv2.COLOR_BGR2RGB)))
        self.canvas.delete("all");self.canvas.create_image(cw//2,ch//2,image=self.photo)
    def run(self):
        if not self.total():return
        try:
            k=int(self.peers.get());pixel=float(self.pixel.get()) if self.pixel.get().strip() else None
            if not 1<=k<=100 or (pixel is not None and pixel<=0):raise ValueError("Invalid peer count or pixel size")
            self.rows,self.overlay=analyze(self.image(),self.pol.get(),k,pixel)
            for row in self.table.get_children():self.table.delete(row)
            for row in self.rows:
                self.table.insert("","end",values=tuple(row.get(k,"-") for k in
                  ("pin","void_pct","area_px","area_delta_pct","circularity","flag","reason")))
            self.status.set(f"{len(self.rows)} pins; {sum(r['flag']=='REVIEW' for r in self.rows)} REVIEW (NOT NG)")
            self.draw()
        except Exception as exc:messagebox.showerror("Analysis failed",str(exc))
    def save(self):
        if not self.rows:messagebox.showinfo("Analyze first","Analyze a populated image first");return
        p=filedialog.askdirectory(title="Select export folder")
        if p:
            try:
                src=str(self.files[0])+(f"#Z={self.z}" if self.vol is not None else "")
                export(p,self.rows,self.overlay,src)
                messagebox.showinfo("Export successful","Saved overlay.png, joints.csv, summary.json")
            except Exception as exc:messagebox.showerror("Export failed",str(exc))

if __name__=="__main__":App().mainloop()
