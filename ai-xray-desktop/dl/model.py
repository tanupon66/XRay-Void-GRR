"""True trainable 2.5D U-Net. 3 neighboring slices -> background/solder/void logits."""
import torch
from torch import nn

class Block(nn.Module):
    def __init__(self, input_channels, output_channels):
        super().__init__()
        self.net=nn.Sequential(
            nn.Conv2d(input_channels,output_channels,3,padding=1,bias=False),
            nn.BatchNorm2d(output_channels),nn.ReLU(inplace=True),
            nn.Conv2d(output_channels,output_channels,3,padding=1,bias=False),
            nn.BatchNorm2d(output_channels),nn.ReLU(inplace=True))
    def forward(self,x):return self.net(x)

class UNet25D(nn.Module):
    def __init__(self,base=16):
        super().__init__()
        self.enc1=Block(3,base);self.enc2=Block(base,base*2)
        self.enc3=Block(base*2,base*4)
        self.middle=Block(base*4,base*8)
        self.pool=nn.MaxPool2d(2)
        self.dec3=Block(base*12,base*4)
        self.dec2=Block(base*6,base*2)
        self.dec1=Block(base*3,base)
        self.head=nn.Conv2d(base,3,1)
    def forward(self,x):
        import torch.nn.functional as F
        a=self.enc1(x);b=self.enc2(self.pool(a));c=self.enc3(self.pool(b))
        d=self.middle(self.pool(c))
        def up(v,target):return F.interpolate(v,size=target.shape[-2:],mode="bilinear",align_corners=False)
        d=self.dec3(torch.cat([up(d,c),c],1))
        d=self.dec2(torch.cat([up(d,b),b],1))
        d=self.dec1(torch.cat([up(d,a),a],1))
        return self.head(d)

def predict(model, image_stack,device="cpu"):
    """image_stack shape (3,H,W), float32 normalized 0..1. Returns masks and confidence."""
    model.eval()
    with torch.inference_mode():
        t=torch.from_numpy(image_stack.astype("float32",copy=False))[None].to(device)
        logits=model(t);p=logits.softmax(dim=1)[0]
        confidence,classes=p.max(dim=0)
    return classes.cpu().numpy().astype("uint8"),confidence.cpu().numpy()
