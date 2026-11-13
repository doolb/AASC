"""Fixed multiscale sparse cubic convolution of source curvature features.
Not a trained neural network. Geometry/topology gates prevent cross-layer blur.
"""
import math,heapq
from array import array
from mathutils import Vector


def fitted_box(points,weights,bounds):
    """One covariance-aligned cuboid for global context, independent of cameras."""
    total=max(sum(weights),1e-30);center=sum((p*w for p,w in zip(points,weights)),Vector())/total
    a=[[sum(w*(p[i]-center[i])*(p[j]-center[j]) for p,w in zip(points,weights))/total for j in range(3)] for i in range(3)]
    axes=[[float(i==j) for j in range(3)] for i in range(3)]
    for _ in range(24):
        i,j=max(((0,1),(0,2),(1,2)),key=lambda pair:abs(a[pair[0]][pair[1]]))
        if abs(a[i][j])<1e-15:break
        tau=(a[j][j]-a[i][i])/(2*a[i][j]);t=(1 if tau>=0 else -1)/(abs(tau)+math.sqrt(1+tau*tau))
        c=1/math.sqrt(1+t*t);sn=t*c;off=a[i][j]
        a[i][i]-=t*off;a[j][j]+=t*off;a[i][j]=a[j][i]=0.
        for k in range(3):
            if k not in (i,j):
                x,y=a[k][i],a[k][j];a[k][i]=a[i][k]=c*x-sn*y;a[k][j]=a[j][k]=sn*x+c*y
            x,y=axes[k][i],axes[k][j];axes[k][i]=c*x-sn*y;axes[k][j]=sn*x+c*y
    order=sorted(range(3),key=lambda i:-a[i][i]);basis=[Vector(tuple(axes[k][i] for k in range(3))).normalized() for i in order]
    basis[2]=basis[0].cross(basis[1]).normalized()
    lo=[min((p-center).dot(v) for p in bounds) for v in basis];hi=[max((p-center).dot(v) for p in bounds) for v in basis]
    corners=[tuple(center+sum((basis[k]*(hi[k] if mask&(1<<k) else lo[k]) for k in range(3)),Vector())) for mask in range(8)]
    return {'center':tuple(center),'axes':[tuple(v) for v in basis],'dimensions':[b-a for a,b in zip(lo,hi)],'corners':corners,'cells':1}


def multiscale_curvature(values,points,normals,areas,adjacency,scale,settings,directions=None,bounds_points=None):
    width=float(settings.get('boundary_voxel_size',.01))*scale
    gate=float(settings.get('boundary_curvature_gate',.25));gain=float(settings.get('boundary_curvature_gain',.5))
    rounds=int(settings.get('boundary_curvature_rounds',2));floor=float(settings.get('boundary_curvature_floor',4))
    if not all(math.isfinite(v) for v in (width,gate,gain,floor)) or width<=0 or not 0<gate<1 or not 0<=gain<=2 or floor<=0 or not 0<=rounds<=10:
        raise ValueError('多尺度体素卷积参数无效')
    if not values or len(values)>30000:raise ValueError('体素卷积样本超过当前预算，请分部件处理')
    points=[Vector(p) for p in points];normals=[Vector(n).normalized() for n in normals]
    box=fitted_box(points,areas,[Vector(p) for p in bounds_points] if bounds_points is not None else points)
    layout=settings.get('boundary_voxel_layout','PYRAMID')
    if layout=='PYRAMID':
        middle=int(settings.get('boundary_voxel_middle',8));near=int(settings.get('boundary_voxel_near',32));ultra=int(settings.get('boundary_voxel_ultra',128))
        if not 2<=middle<near<ultra<=512:raise ValueError('四级尺度要求：1 < 中 < 近 < 超近 <= 512')
        length=max(box['dimensions'])
        if length<=scale*1e-10:raise ValueError('物体尺度不足以建立四级网格')
        configurations=[(length/ultra,1),(length/near,1),(length/middle,1)]
        levels_report=[{'name':'far','divisions':1,'cells':1,'role':'whole-object fitted cuboid'},
                       {'name':'middle','divisions':middle},{'name':'near','divisions':near},{'name':'ultra','divisions':ultra}]
    elif layout=='LOCAL':configurations=[(width,1),(width,2),(width,4)];levels_report=[]
    else:raise ValueError('未知体素层级布局')
    origin=sum(points,Vector())/max(len(points),1);points=[p-origin for p in points]
    grids=[]
    for cell_width,radius in configurations:
        cells={}
        for i,p in enumerate(points):cells.setdefault(tuple(math.floor(c/cell_width) for c in p),[]).append(i)
        grids.append(cells)
    if levels_report:
        for entry,grid,(cell_width,radius) in zip(reversed(levels_report[1:]),grids,configurations):
            entry['occupied_cells']=len(grid);entry['cell_width_relative']=cell_width/scale;entry['window_diameter_relative']=2*cell_width*radius/scale
    kernels=[];budget=0
    for i,p in enumerate(points):
        # Bounded graph distances protect even similarly oriented nearby layers
        # of one folded shell. Euclidean proximity alone is never sufficient.
        limit=max(h*r for h,r in configurations);distances={i:0.};queue=[(0.,i)]
        while queue:
            cost,j=heapq.heappop(queue)
            if cost!=distances[j]:continue
            for k in adjacency[j]:
                if normals[i].dot(normals[k])<.7:continue
                candidate=cost+(points[k]-points[j]).length
                if candidate>limit*1.5 or candidate>=distances.get(k,float('inf')):continue
                distances[k]=candidate;heapq.heappush(queue,(candidate,k))
        levels=[]
        for (cell_width,radius),grid in zip(configurations,grids):
            cube=tuple(math.floor(c/cell_width) for c in p)
            indices=array('I');weights=array('f');r=cell_width*radius
            for dx in range(-radius,radius+1):
                for dy in range(-radius,radius+1):
                    for dz in range(-radius,radius+1):
                        for j in grid.get((cube[0]+dx,cube[1]+dy,cube[2]+dz),[]):
                            if j not in distances or distances[j]>r*1.5:continue
                            if directions is not None and abs(Vector(directions[i]).dot(Vector(directions[j])))<.75:continue
                            d=(points[j]-p).length
                            if d>r:continue
                            weight=max(areas[j],1e-30)*math.exp(-.5*(d/max(r*.6,1e-30))**2)
                            indices.append(j);weights.append(weight)
            if not indices:indices.append(i);weights.append(max(areas[i],1e-30))
            levels.append((indices,weights));budget+=len(indices)
        if budget>8000000:raise ValueError('体素卷积邻域预算超限，请降低窗口尺度或分部件处理')
        kernels.append(levels)
    result=list(values)
    if any(not math.isfinite(v) or v<0 for v in result):raise ValueError('曲率必须为非负有限值')
    caps=[max(values[j] for j in levels[-1][0])*(1+gain) for levels in kernels]
    for _ in range(rounds):
        updated=[]
        for i,levels in enumerate(kernels):
            smooth=[];contrasts=[]
            for indices,weights in levels:
                near=[];far=[]
                for j,w in zip(indices,weights):
                    relative=abs(result[i]-result[j])/max(result[i],result[j],floor)
                    (near if relative<=gate else far).append((result[j],w))
                smooth.append(sum(v*w for v,w in near)/sum(w for v,w in near) if near else result[i])
                contrasts.append(result[i]-sum(v*w for v,w in far)/sum(w for v,w in far) if far else 0.)
            denoised=sum(v*w for v,w in zip(smooth,(.5,.3,.2)))
            # Amplify only when at least two physical scales agree in sign.
            pos=sum(c>1e-12 for c in contrasts);neg=sum(c< -1e-12 for c in contrasts)
            signed=[c for c in contrasts if c>0] if pos>=2 else [c for c in contrasts if c<0] if neg>=2 else []
            detail=sum(signed)/len(signed) if signed else 0.
            updated.append(min(caps[i],max(0.,.5*result[i]+.5*denoised+gain*detail)))
        result=updated
    return result,{'kernel':'fixed sparse cubic convolution','layout':layout,'windows':[3,3,3] if layout=='PYRAMID' else [3,5,9],
                   'levels':levels_report,'global_box':box,'global_curvature_mean':sum(v*w for v,w in zip(values,areas))/max(sum(areas),1e-30),
                   'voxel_relative':width/scale,'samples':len(values),'occupied_cells':[len(g) for g in grids],
                   'kernel_pairs':budget,'layers':'bounded graph distance + normals','trainable_parameters':False,
                   'contrast_consensus_scales':2,'far_role':'global shape context, no direct averaging into fine curvature'}
