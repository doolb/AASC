import json,math
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).parent
d=json.loads((root/'csi-review-v5-boots.json').read_text(encoding='utf8'));m=d['postprocess']['mesh'];vertices=np.asarray(m['vertices']);faces=m['faces'];groups=d['postprocess']['patchGroups']
W,H=1800,660
pixels=np.full((H,W,3),[237,240,231],dtype=np.uint8);depth=np.full((H,W),-1e10)
palette={165:[123,143,161],166:[188,176,144],167:[153,136,173],168:[123,143,161],169:[188,176,144],170:[153,136,173]}
def project(p,view):
    x,y,z=p
    if view==0:return np.array([300+x*1150,600-y*3100,z])
    if view==1:return np.array([900+z*2000,600-y*3100,-x])
    return np.array([1500+(x+.145)*2100,350-z*1850,-y])
def triangle(ps,color,view):
    a,b,c=ps; xmin=max(view*600,int(min(ps[:,0])));xmax=min((view+1)*600-1,int(max(ps[:,0]))+1);ymin=max(45,int(min(ps[:,1])));ymax=min(H-45,int(max(ps[:,1]))+1)
    if xmin>xmax or ymin>ymax:return
    den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(den)<1e-8:return
    yy,xx=np.mgrid[ymin:ymax+1,xmin:xmax+1]
    u=((b[1]-c[1])*(xx-c[0])+(c[0]-b[0])*(yy-c[1]))/den;v=((c[1]-a[1])*(xx-c[0])+(a[0]-c[0])*(yy-c[1]))/den;w=1-u-v
    zz=u*a[2]+v*b[2]+w*c[2];dst=depth[ymin:ymax+1,xmin:xmax+1];mask=(u>=0)&(v>=0)&(w>=0)&(zz>dst)
    dst[mask]=zz[mask];pixels[ymin:ymax+1,xmin:xmax+1][mask]=color
for view in range(3):
    for i,f in enumerate(faces):
        pts=vertices[f]
        if pts[:,1].mean()>.175 or (view>0 and pts[:,0].mean()>0):continue
        n=np.cross(pts[1]-pts[0],pts[2]-pts[0]);n=n/(np.linalg.norm(n)+1e-12);light=.68+.32*abs(np.dot(n,np.array([.3,.7,.6])))
        color=np.asarray(palette.get(groups[i],[105,116,110]))*light
        ps=np.asarray([project(p,view) for p in pts])
        for j in range(1,len(f)-1):triangle(ps[[0,j,j+1]],color,view)
    for c in d['postprocess']['fittedNetwork']['curves']:
        ref=c.get('displaySamples',c.get('samples',[])); control=[np.asarray(c[k]) for k in ['p0','p1','p2','p3']]
        samples=[(1-t)**3*control[0]+3*(1-t)**2*t*control[1]+3*(1-t)*t*t*control[2]+t**3*control[3] for t in np.linspace(0,1,len(ref))]
        if not samples or min(p[1] for p in samples)>.175 or (view>0 and sum(p[0] for p in samples)>0):continue
        for j in range(len(samples)-1):
            a,b=project(samples[j],view),project(samples[j+1],view)
            ra=project(ref[min(j,len(ref)-1)],view);rb=project(ref[min(j+1,len(ref)-1)],view)
            count=max(1,int(np.linalg.norm(a[:2]-b[:2])*2))
            for t in np.linspace(0,1,count+1):
                q=a*(1-t)+b*t;z=ra[2]*(1-t)+rb[2]*t;x,y=int(round(q[0])),int(round(q[1]))
                if not(view*600+1<=x<(view+1)*600-1 and 46<=y<H-46):continue
                near=depth[y-1:y+2,x-1:x+2]
                if z>=near.max()-.0025:pixels[y-1:y+2,x-1:x+2]=[204,42,33]
im=Image.fromarray(pixels);draw=ImageDraw.Draw(im);font=ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',23)
for x,title in [(20,'正面：每只靴子三个结构区'),(620,'侧面：沿鞋底台阶闭合'),(1220,'底面：完整鞋底，不切花纹碎区')]:draw.text((x,10),title,fill='#243c33',font=font)
draw.text((25,620),'紫色：靴口带    米色：鞋面    蓝灰：鞋底    红线：第五版实际 CSI 曲线',fill='#243c33',font=font)
im.save(root/'boots-csi-three-views.png')
print('saved',root/'boots-csi-three-views.png')
