"""Extract disconnected silhouettes, register ground pivots, and pack padded atlases.
Requires Pillow, numpy, scipy. Runtime uses only the committed PNGs and manifest.
The original grid is NOT used for extraction; connected silhouettes supply bounds.
"""
from pathlib import Path
import argparse, hashlib, json, shutil
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import label, binary_dilation
ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT/'web/art-source'
OUT = ROOT/'web/public/art'
parser=argparse.ArgumentParser(); parser.add_argument('--import-inputs',action='store_true'); args=parser.parse_args()
SRC.mkdir(parents=True,exist_ok=True); OUT.mkdir(parents=True,exist_ok=True)
if args.import_inputs:
    for name in ['characters','world']:
        im=Image.open(ROOT/f'artifacts/art/{name}.png').convert('RGBA')
        im.quantize(colors=256,method=Image.Quantize.FASTOCTREE,dither=Image.Dither.NONE).save(SRC/f'{name}.png',optimize=True)
manifest={'version':2,'style':'Original painted STRATOKS miniatures, upper-left sunlight','license':'MIT','attribution':'Original STRATOKS contributor artwork generated with OpenAI image generation, 2026. Technical extraction and registration by STRATOKS interface contributor.','sourceInputs':{'characters':'69fd01ffb49b65f57972d659362b84afc71578a6e2aea8b91065d3826b5c90e5','world':'dc89961da7a33f7ad0cbaaeb3779431ff0bfa9fe9bf41d0a87347c48989a8878'},'coordinates':'pixels, top-left origin; rectangles [x,y,width,height]; anchors cell-local ground contact','sheets':{},'sprites':{},'animation':{'idle':{'frames':4,'fps':2,'sequence':[0,1,2,3,2,1]},'walk':{'frames':4,'fps':6,'sequence':[0,1,2,3]},'rest':{'frames':2,'fps':1},'gather':{'frames':2,'fps':3},'carry':{'frames':2,'fps':3,'requires':'inspected inventory.wood > 0 AND carry/move action'},'build':{'frames':2,'fps':3,'requires':'build action'},'distress':{'requires':'health < 30; static ring overlay, no invented action'}},'limitations':['Raster source only; no layered painting or rig. Generated loops are registered pose sequences, not a skeletal animation.','Only completed shelters are exposed by the API; frame/partial artwork remains unused.','Resource variants are chosen from actual units; no decorative resource nodes are added.']}
directions=['se','sw','ne','nw']; biomes=['temperate','arid','cold','coast']
for sheet in ['characters','world']:
    im=Image.open(SRC/f'{sheet}.png').convert('RGBA'); a=np.array(im)
    labels,count=label(a[:,:,3]>200)
    sizes=np.bincount(labels.ravel()); ids=[int(i) for i in np.flatnonzero(sizes>800) if i]
    if len(ids)!=64: raise ValueError(f'{sheet}: expected 64 disconnected silhouettes, found {len(ids)}')
    groups=[[] for _ in range(8)]
    thresholds=[175,333,496,660,810,953,1092] if sheet=='characters' else [195,340,505,645,825,962,1102]
    for i in ids:
        ys,xs=np.where(labels==i); yc=(int(ys.min())+int(ys.max()))/2
        row=sum(yc>t for t in thresholds)
        groups[row].append((float(xs.mean()),i))
    atlas=Image.new('RGBA',(1024,1024))
    for row,group in enumerate(groups):
        if len(group)!=8:raise ValueError((sheet,row,len(group)))
        for col,(_,idx) in enumerate(sorted(group)):
            core=labels==idx
            # Retain the original antialiased edge within a 3px halo; discard disconnected ghosts.
            keep=binary_dilation(core,iterations=3)
            sprite=a.copy(); sprite[~keep]=0
            ys,xs=np.where(core); x0,y0,x1,y1=max(0,int(xs.min())-3),max(0,int(ys.min())-3),min(im.width,int(xs.max())+4),min(im.height,int(ys.max())+4)
            crop=Image.fromarray(sprite[y0:y1,x0:x1])
            scale=.65 if sheet=='characters' else min(112/crop.width,112/crop.height)
            w,h=round(crop.width*scale),round(crop.height*scale)
            crop=crop.resize((w,h),Image.Resampling.LANCZOS)
            if sheet=='characters':
                foot=core & (np.indices(core.shape)[0]>int(ys.max())-8)
                fy,fx=np.where(foot)
                pivotx=float(np.median(fx))-x0; pivoty=int(ys.max())-y0-1
                dx=max(8,min(120-w,round(64-pivotx*scale))); dy=round(114-pivoty*scale)
            else:
                dx=round((128-w)/2);dy=120-h
            cell=Image.new('RGBA',(128,128)); cell.alpha_composite(crop,(dx,dy));atlas.alpha_composite(cell,(col*128,row*128))
            if sheet=='characters':
                if row<4: name=f'{directions[row]}.{"idle" if col<4 else "walk"}.{col%4}'
                else:name=f'{directions[row-4]}.{["rest","gather","carry","build"][col//2]}.{col%2}'
                anchor=[round(dx+pivotx*scale),114];worldWidth=2.6
            else:
                kind=(["tree","tree-small","bush","bush-empty","stone","stone-small","wood","scrub"] if row%2==0 else ["shelter-frame","shelter-partial","shelter","ground","transition","shore","water","foliage"])[col]
                name=f'{biomes[row//2]}.{kind}'; anchor=[64,109 if row%2==0 else 110];worldWidth=3.9 if kind.startswith('tree') else 3.8 if kind.startswith('shelter') else 2.2 if kind.startswith('stone') else 2.4 if kind=='wood' else 1.5 if kind=='scrub' else 2.0
            manifest['sprites'][name]={'sheet':sheet,'rect':[col*128,row*128,128,128],'anchor':anchor,'widthInHalfTiles':worldWidth,'sourceRect':[x0,y0,x1-x0,y1-y0],'sourceGroundPivot': [round(pivotx,2),round(pivoty,2)] if sheet=='characters' else 'bottom-center, foliage baseline'}
    atlas.quantize(colors=256,method=Image.Quantize.FASTOCTREE,dither=Image.Dither.NONE).save(OUT/f'{sheet}.png',optimize=True)
    manifest['sheets'][sheet]={'file':f'{sheet}.png','width':1024,'height':1024,'cell':128,'padding':8,'sha256':hashlib.sha256((OUT/f'{sheet}.png').read_bytes()).hexdigest(),'editableSource':f'web/art-source/{sheet}.png'}
    # Technical inspection view; explicitly not a rendered website screenshot.
    preview=Image.new('RGB',(1024,1024),'#28483b');preview.paste(atlas,mask=atlas.getchannel('A'));preview.save(ROOT/f'test/scratch/{sheet}-registered.jpg',quality=85)
# Six supplemental objects fill gaps in the first contributor's world sheet.
im=Image.open(SRC/'extra.png').convert('RGBA');a=np.array(im);labs,count=label(a[:,:,3]>200)
sizes=np.bincount(labs.ravel());ids=[int(i) for i in np.flatnonzero(sizes>2000) if i]
if len(ids)!=6:raise ValueError(('extra silhouettes',len(ids)))
items=[]
for idx in ids:
    ys,xs=np.where(labs==idx);items.append((int(ys.mean())//(im.height//2),float(xs.mean()),idx))
atlas=Image.new('RGBA',(384,256))
for slot,(_,_,idx) in enumerate(sorted(items)):
    core=labs==idx;keep=binary_dilation(core,iterations=3);data=a.copy();data[~keep]=0
    ys,xs=np.where(core);x0,y0,x1,y1=max(0,int(xs.min())-3),max(0,int(ys.min())-3),min(im.width,int(xs.max())+4),min(im.height,int(ys.max())+4)
    crop=Image.fromarray(data[y0:y1,x0:x1]);factor=min(112/crop.width,112/crop.height);w,h=round(crop.width*factor),round(crop.height*factor)
    crop=crop.resize((w,h),Image.Resampling.LANCZOS);atlas.alpha_composite(crop,(slot%3*128+(128-w)//2,slot//3*128+120-h))
    name=['cactus','flint','lichen','shellfish','fire.0','fire.1'][slot]
    manifest['sprites'][f'extra.{name}']={'sheet':'extra','rect':[slot%3*128,slot//3*128,128,128],'anchor':[64,110],'widthInHalfTiles':1.9 if name=='cactus' else 2 if name.startswith('fire') else 1.5,'sourceRect':[x0,y0,x1-x0,y1-y0]}
atlas.quantize(colors=256,method=Image.Quantize.FASTOCTREE,dither=Image.Dither.NONE).save(OUT/'extra.png',optimize=True)
manifest['sheets']['extra']={'file':'extra.png','width':384,'height':256,'cell':128,'padding':8,'sha256':hashlib.sha256((OUT/'extra.png').read_bytes()).hexdigest(),'editableSource':'web/art-source/extra.png'}
text=json.dumps(manifest,indent=2)+'\n';(OUT/'manifest.json').write_text(text);(ROOT/'web/src/expanse/atlas.json').write_text(text)
print(json.dumps({k:{'bytes':(OUT/f'{k}.png').stat().st_size,**v} for k,v in manifest['sheets'].items()},indent=2))
