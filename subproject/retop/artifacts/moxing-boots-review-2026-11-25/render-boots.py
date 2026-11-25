import json
from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).parent
data=json.loads((root.parent/'moxing-csi-review-2026-11-24/csi-review-v4-texture-details.json').read_text(encoding='utf8'))
label=json.loads((root/'boots-groups.json').read_text(encoding='utf8'));groups=label['groups']
m=data['analysisSource'];v=m['vertices'];faces=m['faces'];colors=data['textureEvidence']['colors'];edges={}
for i,f in enumerate(faces):
    for a,b in zip(f,f[1:]+f[:1]):edges.setdefault(tuple(sorted([a,b])),[]).append(i)
im=Image.new('RGB',(1400,600),'#eef0e8');draw=ImageDraw.Draw(im)
for view in range(2):
    ids=[i for i,f in enumerate(faces) if sum(v[j][1] for j in f)/len(f)<.17 and (view==0 or sum(v[j][0] for j in f)/len(f)<0)]
    depth=2 if view==0 else 0
    for i in sorted(ids,key=lambda i:sum(v[j][depth] for j in faces[i])/len(faces[i]),reverse=view==1):
        f=faces[i];pts=[((350+v[j][0]*1400) if view==0 else (1050+v[j][2]*2100),550-v[j][1]*3000) for j in f]
        draw.polygon(pts,fill=tuple(round(x*255) for x in (colors[i] or [.5]*3)))
        for k,(a,b) in enumerate(zip(f,f[1:]+f[:1])):
            if len(set(groups[j] for j in edges[tuple(sorted([a,b]))]))>1:draw.line([pts[k],pts[(k+1)%len(pts)]],fill=(255,30,30),width=2)
im.save(root/'boots-boundary-preview.png')
