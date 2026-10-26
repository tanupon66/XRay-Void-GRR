"""Orthogonal CT slice viewer for decoded Omron volumes. Display only; NOT inspection result."""
import tkinter as tk
from tkinter import ttk
import numpy as np
from PIL import Image,ImageTk,ImageEnhance

class VolumeExplorer(tk.Toplevel):
    def __init__(self, parent,volume, voxel_um=None):
        super().__init__(parent)
        self.title("CT Cross-section Viewer — XY / XZ / YZ")
        self.geometry("1200x800")
        self.volume=volume
        nz,ny,nx=volume.shape
        self.x=tk.IntVar(value=nx//2);self.y=tk.IntVar(value=ny//2);self.z=tk.IntVar(value=nz//2)
        self.brightness=tk.DoubleVar(value=1.0);self.contrast=tk.DoubleVar(value=1.0)
        self.scale=tk.DoubleVar(value=2)
        self.meta=voxel_um
        bar=ttk.Frame(self);bar.pack(fill="x",padx=8,pady=8)
        for text,var,maxv in (("X",self.x,nx-1),("Y",self.y,ny-1),("Z",self.z,nz-1)):
            ttk.Label(bar,text=text).pack(side="left")
            ttk.Scale(bar,from_=0,to=maxv,variable=var,command=self.refresh).pack(side="left",padx=5,fill="x",expand=True)
        controls=ttk.Frame(self);controls.pack(fill="x",padx=8)
        for text,var,low,high in (("Brightness",self.brightness,.2,4),("Contrast",self.contrast,.2,5),("Zoom",self.scale,1,5)):
            ttk.Label(controls,text=text).pack(side="left")
            ttk.Scale(controls,from_=low,to=high,variable=var,command=self.refresh).pack(side="left",padx=5,fill="x",expand=True)
        container=ttk.Frame(self);container.pack(fill="both",expand=True,padx=8,pady=5)
        self.panels=[]
        for j,name in enumerate(("XY / Z constant","XZ / Y constant","YZ / X constant")):
            frame=ttk.Frame(container)
            frame.grid(row=0,column=j,sticky="nsew")
            ttk.Label(frame,text=name).pack()
            canvas=tk.Canvas(frame,bg="#20252d",highlightthickness=0)
            canvas.pack(fill="both",expand=True)
            canvas.bind("<Configure>",lambda e:self.refresh())
            self.panels.append(canvas)
            container.grid_columnconfigure(j,weight=1)
        container.grid_rowconfigure(0,weight=1)
        ttk.Label(self,text="Display enhancement only; raw voxel data unchanged. Orientation must be verified against Omron viewer.").pack(pady=5)
        self.photos=[None,None,None]
        self.after(100,self.refresh)
    def refresh(self,*args):
        if not self.winfo_exists():return
        v=self.volume;x=min(max(int(self.x.get()),0),v.shape[2]-1)
        y=min(max(int(self.y.get()),0),v.shape[1]-1)
        z=min(max(int(self.z.get()),0),v.shape[0]-1)
        slices=(v[z,:,:],v[:,y,:],v[:,:,x])
        for i,(a,canvas) in enumerate(zip(slices,self.panels)):
            im=Image.fromarray(a.astype(np.uint8,copy=False))
            im=ImageEnhance.Brightness(im).enhance(self.brightness.get())
            im=ImageEnhance.Contrast(im).enhance(self.contrast.get())
            cw=max(canvas.winfo_width(),1);ch=max(canvas.winfo_height(),1)
            sw,sh=im.size
            factor=min(cw/max(1,sw),ch/max(1,sh))*self.scale.get()
            dw=max(1,int(sw*factor));dh=max(1,int(sh*factor))
            im=im.resize((dw,dh),Image.Resampling.NEAREST)
            self.photos[i]=ImageTk.PhotoImage(im)
            canvas.delete("all");canvas.create_image(cw//2,ch//2,image=self.photos[i])
