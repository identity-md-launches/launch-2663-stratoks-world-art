"""Validate packed runtime art (Pillow + numpy). Does not need removed task inputs."""
import hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image
root=Path(__file__).resolve().parents[2]
folder=root/'web/public/art';m=json.loads((folder/'manifest.json').read_text());checked=0
for key,sheet in m['sheets'].items():
 p=folder/sheet['file'];assert hashlib.sha256(p.read_bytes()).hexdigest()==sheet['sha256']
 im=Image.open(p).convert('RGBA');assert im.size==(sheet['width'],sheet['height']);a=np.array(im)
 assert np.any(a[:,:,3]==0) and np.any(a[:,:,3]>240),'actual transparency and opaque paint required'
 for name,s in m['sprites'].items():
  if s['sheet']!=key:continue
  x,y,w,h=s['rect'];assert x>=0 and y>=0 and x+w<=im.width and y+h<=im.height
  crop=a[y:y+h,x:x+w];ys,xs=np.where(crop[:,:,3]>64);assert len(xs)>0
  assert min(xs)>=4 and max(xs)<=w-5 and min(ys)>=4 and max(ys)<=h-5,(name,'unsafe atlas-edge paint')
  assert 0<=s['anchor'][0]<w and 0<=s['anchor'][1]<h
  checked+=1
assert checked==134,checked
assert (root/'web/src/expanse/atlas.json').read_bytes()==(folder/'manifest.json').read_bytes()
print(f'PASS: {checked} padded sprite rectangles; all sheets, hashes, alpha, anchors and manifest copies valid.')
