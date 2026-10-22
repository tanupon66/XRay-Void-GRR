"""Predict from NPZ sample with trained U-Net. Never infer without checkpoint."""
import argparse,json
from pathlib import Path
import cv2,numpy as np,torch
from model import UNet25D,predict

def main(argv=None):
    p=argparse.ArgumentParser()
    p.add_argument("--model",required=True)
    p.add_argument("--input",required=True,help="NPZ with image shape (3,H,W)")
    p.add_argument("--out",default="predictions")
    args=p.parse_args(argv)
    checkpoint=torch.load(args.model,map_location="cpu",weights_only=True)
    model=UNet25D(checkpoint["base"])
    model.load_state_dict(checkpoint["weights"],strict=True)
    with np.load(args.input,allow_pickle=False) as d:image=d["image"]
    if image.ndim!=3 or image.shape[0]!=3 or image.min()<0 or image.max()>1:
        raise ValueError("Expected normalized 3-channel 2.5D image")
    mask,confidence=predict(model,image)
    folder=Path(args.out);folder.mkdir(parents=True,exist_ok=True)
    cv2.imencode(".png",mask)[1].tofile(str(folder/"classes.png"))
    cv2.imencode(".png",(np.clip(confidence,0,1)*255).astype("uint8"))[1].tofile(str(folder/"confidence.png"))
    stats={"pixels":int(mask.size),"solder_pixels":int((mask==1).sum()),
           "void_pixels":int((mask==2).sum()),
           "mean_confidence":round(float(confidence.mean()),4),
           "warning":"Unvalidated research model; Void % requires verified footprint mask and physical calibration"}
    (folder/"prediction.json").write_text(json.dumps(stats,indent=2),encoding="utf-8")
    print(json.dumps(stats))

if __name__=="__main__":main()
