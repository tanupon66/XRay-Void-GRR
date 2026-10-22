import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import numpy as np,pytest,torch
from model import UNet25D,predict
from train import grouped_split,Data

def test_unet_shape_and_gradient():
    model=UNet25D(base=4)
    x=torch.rand(2,3,32,48)
    logits=model(x)
    assert logits.shape==(2,3,32,48)
    logits.mean().backward()
    assert model.head.weight.grad is not None

def test_prediction():
    model=UNet25D(base=4)
    mask,confidence=predict(model,np.random.rand(3,32,48).astype("float32"))
    assert mask.shape==confidence.shape==(32,48)
    assert mask.max()<=2

def test_group_validation(tmp_path):
    for group in ("volume_A","volume_B","volume_C"):
        folder=tmp_path/group;folder.mkdir()
        np.savez(folder/"a.npz",image=np.ones((3,32,32),np.float32),mask=np.zeros((32,32),np.uint8))
    tr,va=grouped_split(tmp_path)
    assert tr and va and not ({p.parent.name for p in tr}&{p.parent.name for p in va})
    assert Data(tr)[0][0].shape==(3,32,32)
