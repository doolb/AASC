"""Connected macro quad shell, driven by a source-aligned contour and bends.

Works on normalized single shells in their geometry-derived principal frame.
The two surface patches and their rim share vertices. No boxes or booleans.
This bounded patch path rejects folded parameterizations rather than filling
their gaps. It is not a general quadrangulator for arbitrary branched bodies.
"""
import math
import statistics

import bmesh
from mathutils import Vector

from . import validation


def _area(poly):
    return .5*sum(a.x*b.y-b.x*a.y for a,b in zip(poly,poly[1:]+poly[:1]))


def _outline(mesh):
    bm=bmesh.new()
    try:
        bm.from_mesh(mesh);bm.normal_update();bm.verts.index_update();bm.verts.ensure_lookup_table()
        links={}
        for edge in bm.edges:
            if len(edge.link_faces)==2 and (edge.link_faces[0].normal.z>0)!=(edge.link_faces[1].normal.z>0):
                a,b=[v.index for v in edge.verts]
                links.setdefault(a,[]).append(b);links.setdefault(b,[]).append(a)
        if not links or any(len(adj)!=2 for adj in links.values()):
            raise ValueError('大形轮廓有分叉，不能建立连续四边面补片')
        remaining=set(links);loops=[]
        while remaining:
            start=min(remaining);ids=[start];previous=None;current=start
            while True:
                following=next(v for v in links[current] if v!=previous)
                if following==start:break
                if following in ids:raise ValueError('大形轮廓无法连续排序')
                ids.append(following);previous,current=current,following
            remaining.difference_update(ids)
            loops.append([bm.verts[i].co.copy() for i in ids])
        poly=max(loops,key=lambda p:abs(_area(p)))
        if abs(_area(poly))<1e-5:raise ValueError('大形轮廓投影退化')
        if _area(poly)<0:poly.reverse()
        return poly,len(loops)
    finally:
        bm.free()


class _Surface:
    def __init__(self,mesh):
        self.tree=validation.surface(mesh)
        self.zlo=min(v.co.z for v in mesh.vertices)-1.
        self.zhi=max(v.co.z for v in mesh.vertices)+1.

    def pair(self,point):
        top=self.tree.ray_cast(Vector((point.x,point.y,self.zhi)),Vector((0,0,-1)))[0]
        bottom=self.tree.ray_cast(Vector((point.x,point.y,self.zlo)),Vector((0,0,1)))[0]
        if top is None or bottom is None or top.z-bottom.z<1e-7:return None
        return bottom.z,top.z


def _refine_outline(poly,surface):
    """Recover original footprint after guide smoothing, within a local band."""
    result=[];moves=[];hidden=0
    for i,point in enumerate(poly):
        tangent=poly[(i+1)%len(poly)]-poly[i-1]
        outward=Vector((tangent.y,-tangent.x,0)).normalized()
        inside=None
        for distance in (0.,-.005,-.015,-.03,-.05):
            p=point+outward*distance
            if surface.pair(p) is not None:inside=distance;break
        if inside is None:raise ValueError('源外轮廓附近没有连续体积，不能跨空区连接')
        outside=None
        for distance in (.005,.015,.03,.05):
            if surface.pair(point+outward*distance) is None:outside=distance;break
        # A coarse guide can contain a projected tangent hidden by another
        # part of this same curved shell. Keep this guide station rather than
        # walking across the body to an unrelated outer edge.
        if outside is None:
            result.append(point.copy());moves.append(0.);hidden+=1;continue
        for _ in range(14):
            middle=(inside+outside)*.5
            if surface.pair(point+outward*middle) is None:outside=middle
            else:inside=middle
        p=point+outward*(inside-.00005)
        pair=surface.pair(p)
        if pair is not None:p.z=sum(pair)*.5
        result.append(p);moves.append(abs(inside))
    return result,max(moves),hidden


def _corners(poly):
    # Four major outline corners; concave detail remains in the edge polylines.
    def delta(a,b):return Vector((a.x-b.x,a.y-b.y,0))
    first=min(range(len(poly)),key=lambda i:round(poly[i].x,6))
    second=max(range(len(poly)),key=lambda i:delta(poly[i],poly[first]).length_squared)
    ids=sorted((first,second))
    while len(ids)<4:
        best=(-1.,None)
        for a,b in zip(ids,ids[1:]+[ids[0]+len(poly)]):
            start=poly[a];direction=delta(poly[b%len(poly)],start)
            for index in range(a+1,b):
                offset=delta(poly[index%len(poly)],start)
                t=min(1.,max(0.,offset.dot(direction)/max(direction.length_squared,1e-20)))
                error=(offset-direction*t).length
                if error>best[0]:best=(error,index%len(poly))
        if best[1] is None:raise ValueError('大形没有可用的四个轮廓角')
        ids.append(best[1]);ids.sort()
    return ids


class _Patch:
    def __init__(self,poly):
        ids=_corners(poly);edges=[]
        for a,b in zip(ids,ids[1:]+[ids[0]+len(poly)]):
            edges.append([poly[i%len(poly)] for i in range(a,b+1)])
        self.corners=[poly[i] for i in ids]
        self.edges=[edges[0],edges[1],list(reversed(edges[2])),list(reversed(edges[3]))]
        self.lengths=[[0.] for _ in self.edges]
        for edge,lengths in zip(self.edges,self.lengths):
            for a,b in zip(edge,edge[1:]):lengths.append(lengths[-1]+(b-a).length)

    def edge(self,index,t):
        points=self.edges[index];lengths=self.lengths[index];distance=t*lengths[-1]
        for k in range(1,len(points)):
            if distance<=lengths[k]:
                return points[k-1].lerp(points[k],(distance-lengths[k-1])/max(lengths[k]-lengths[k-1],1e-20))
        return points[-1].copy()

    def point(self,u,v):
        a,b,c,d=self.corners
        return ((1-u)*self.edge(0,v)+u*self.edge(2,v)+(1-v)*self.edge(3,u)+v*self.edge(1,u)
                -((1-u)*(1-v)*a+(1-u)*v*b+u*v*c+u*(1-v)*d))

    def inward(self,u,v):
        p=self.point(u,v);q=self.point(min(.98,max(.02,u)),min(.98,max(.02,v)))
        direction=q-p;direction.z=0
        return direction.normalized()


def _select(records,count):
    last=len(records)-1;chosen=[0,last]
    while len(chosen)<count+1:
        best=(-1.,None)
        for a,b in zip(chosen,chosen[1:]):
            for index in range(a+1,b):
                t=(index-a)/(b-a)
                error=max((p-q.lerp(r,t)).length for p,q,r in zip(records[index],records[a],records[b]))
                if error>best[0]:best=(error,index)
        if best[0]<.003:
            a,b=max(zip(chosen,chosen[1:]),key=lambda ab:ab[1]-ab[0]);best=(0.,(a+b)//2)
        if best[1] in chosen:raise ValueError('结构分段超过有效采样数')
        chosen.append(best[1]);chosen.sort()
    return [index/last for index in chosen]


def _structure_stations(patch,surface,divisions):
    size=33;field=[];missing=0
    for i in range(size):
        row=[]
        for j in range(size):
            u,v=i/(size-1),j/(size-1);p=patch.point(u,v)
            direction=patch.inward(u,v)
            pair=surface.pair(p+direction*.004) if i in (0,size-1) or j in (0,size-1) else surface.pair(p)
            if pair is None:
                missing+=1;pair=(p.z,p.z)
            row.append([Vector((p.x,p.y,z)) for z in pair])
        field.append(row)
    if missing>size*4:raise ValueError('连续补片跨越了过多空区，请先拆分结构')
    # Planning only: small variations are smoothed; final geometry is fitted to
    # the original. Both layers participate so bends on the back are not lost.
    for _ in range(2):
        field=[[[sum((field[a][b][side] for a in range(max(0,i-1),min(size,i+2))
                      for b in range(max(0,j-1),min(size,j+2))),Vector())/
                 ((min(size,i+2)-max(0,i-1))*(min(size,j+2)-max(0,j-1)))
                 for side in range(2)] for j in range(size)] for i in range(size)]
    u=_select([[field[i][j][side] for j in range(1,size-1,2) for side in range(2)] for i in range(size)],divisions[0])
    v=_select([[field[i][j][side] for i in range(1,size-1,2) for side in range(2)] for j in range(size)],divisions[1])
    return u,v,missing


def _boundary_pair(patch,surface,u,v):
    point=patch.point(u,v);direction=patch.inward(u,v);samples=[]
    for distance in (.012,.025,.04):
        pair=surface.pair(point+direction*distance)
        if pair is not None:samples.append((distance,*pair))
    if not samples:raise ValueError('边缘两侧没有厚度支持，不能封接错误层')
    means=[sum(s[k] for s in samples)/len(samples) for k in range(3)]
    denominator=sum((s[0]-means[0])**2 for s in samples)
    values=[means[k]-sum((s[0]-means[0])*(s[k]-means[k]) for s in samples)/max(denominator,1e-12)*means[0]
            for k in (1,2)]
    thickness=values[1]-values[0];baseline=means[2]-means[1]
    if not .5*baseline<=thickness<=1.5*baseline:
        center=sum(values)*.5;values=[center-baseline*.5,center+baseline*.5]
    return values


def _solve(matrix,rhs,prior):
    """Small positive definite least-squares system, stdlib conjugate gradient."""
    def dot(a,b):return sum(x*y for x,y in zip(a,b))
    def mul(vector):return [dot(row,vector) for row in matrix]
    x=list(prior);r=[b-a for b,a in zip(rhs,mul(x))];p=list(r);rr=dot(r,r)
    for _ in range(len(x)*3):
        if rr<1e-18:break
        ap=mul(p);alpha=rr/max(dot(p,ap),1e-30)
        x=[a+alpha*b for a,b in zip(x,p)];r=[a-alpha*b for a,b in zip(r,ap)]
        new=dot(r,r);beta=new/max(rr,1e-30);p=[a+beta*b for a,b in zip(r,p)];rr=new
    return x


def _fit_pairs(points,u,v,surface):
    """Fit cell interiors, not just vertices; preserve two distinct layers."""
    n,m=len(u)-1,len(v)-1;count=len(points);matrix=[[0.]*count for _ in points];rhs=[[0.]*count for _ in (0,1)]
    for i in range(n+1):
        for j in range(m+1):
            index=i*(m+1)+j;weight=3. if i in (0,n) or j in (0,m) else .15
            matrix[index][index]+=weight
            for side in (0,1):rhs[side][index]+=weight*points[index][side].z
    samples=[]
    for i in range(n):
        for j in range(m):
            ids=[i*(m+1)+j,(i+1)*(m+1)+j,(i+1)*(m+1)+j+1,i*(m+1)+j+1]
            for a in (.2,.5,.8):
                for b in (.2,.5,.8):
                    weights=[(1-a)*(1-b),a*(1-b),a*b,(1-a)*b]
                    point=sum((points[k][0]*w for k,w in zip(ids,weights)),Vector());pair=surface.pair(point)
                    if pair is None:continue
                    samples.append((ids,weights,point,pair))
                    # A quad is displayed as triangles. Fit BOTH possible
                    # diagonals so measured thickness is not merely correct
                    # for a bilinear surface the viewport does not display.
                    for split in (((0,1,2),(0,2,3)),((0,1,3),(1,2,3))):
                        found=None
                        for triangle in split:
                            aa,bb,cc=[points[ids[k]][0] for k in triangle]
                            d,e,p=bb-aa,cc-aa,point-aa
                            den=d.x*e.y-d.y*e.x
                            if abs(den)<1e-12:continue
                            b=(p.x*e.y-p.y*e.x)/den;c=(d.x*p.y-d.y*p.x)/den
                            bary=(1-b-c,b,c)
                            if min(bary)>=-1e-7:found=[(ids[k],w) for k,w in zip(triangle,bary)];break
                        if found is None:raise ValueError('四边面内部采样翻折')
                        for k,w in found:
                            for l,z in found:matrix[k][l]+=.5*w*z
                            for side in (0,1):rhs[side][k]+=.5*w*pair[side]
    fitted=[_solve(matrix,rhs[side],[p[side].z for p in points]) for side in (0,1)]
    maximum=0.
    for index,pair in enumerate(points):
        old=[p.z for p in pair];zs=[max(old[s]-.025,min(old[s]+.025,fitted[s][index])) for s in (0,1)]
        if zs[1]-zs[0]<.4*(old[1]-old[0]):zs=old
        for side in (0,1):maximum=max(maximum,abs(zs[side]-old[side]));pair[side].z=zs[side]
    return maximum,samples


def _layer_separation(points,n,m):
    minimum=math.inf
    def cross(a,b):return a.x*b.y-a.y*b.x
    for i in range(n):
        for j in range(m):
            ids=(i*(m+1)+j,(i+1)*(m+1)+j,(i+1)*(m+1)+j+1,i*(m+1)+j+1)
            a,b,c,d=[points[k][0] for k in ids]
            first,second=c-a,d-b;denominator=cross(first,second)
            if abs(denominator)<1e-10:continue
            t=cross(b-a,second)/denominator;s=cross(b-a,first)/denominator
            if not 0<t<1 or not 0<s<1:raise ValueError('四边面凹折，需要拆分轮廓转折')
            values=[]
            for side in (0,1):
                aa,bb,cc,dd=[points[k][side].z for k in ids]
                values.append(((1-t)*aa+t*cc,(1-s)*bb+s*dd))
            gap=min(values[1])-max(values[0]);minimum=min(minimum,gap)
            if gap<=1e-6:raise ValueError('前后层在四边面内部相交，需要增加转折分段')
    return minimum


def build_cage(source,guide,divisions,owned):
    """Return an all-quad, welded front/back/rim cage and measured diagnostics."""
    surface=_Surface(source);poly,loop_count=_outline(guide)
    poly,contour_move,hidden=_refine_outline(poly,surface);patch=_Patch(poly)
    u,v,missing=_structure_stations(patch,surface,divisions);n,m=len(u)-1,len(v)-1
    points=[]
    for i,uu in enumerate(u):
        for j,vv in enumerate(v):
            p=patch.point(uu,vv)
            pair=_boundary_pair(patch,surface,uu,vv) if i in (0,n) or j in (0,m) else surface.pair(p)
            if pair is None:raise ValueError('大形内部落入空区，已拒绝跨层补面')
            points.append([Vector((p.x,p.y,z)) for z in pair])
    # Every cell must retain the same planar orientation; no twisted grid or
    # a shortcut over a concave outline is accepted just to satisfy quad count.
    for i in range(n):
        for j in range(m):
            a,b,c,d=[points[k][0] for k in (i*(m+1)+j,(i+1)*(m+1)+j,(i+1)*(m+1)+j+1,i*(m+1)+j+1)]
            if (b-a).cross(c-a).z>=-1e-8 or (c-a).cross(d-a).z>=-1e-8:
                raise ValueError('轮廓补片翻折，请先拆分此结构')
    fit_move,samples=_fit_pairs(points,u,v,surface)
    minimum_gap=_layer_separation(points,n,m)
    vertices=[tuple(pair[side]) for side in (0,1) for pair in points];layer=len(points);faces=[]
    for i in range(n):
        for j in range(m):
            a=i*(m+1)+j;b=a+m+1
            faces.extend(((a,a+1,b+1,b),(a+layer,b+layer,b+1+layer,a+1+layer)))
    boundary=([i*(m+1) for i in range(n+1)]+[n*(m+1)+j for j in range(1,m+1)]+
              [i*(m+1)+m for i in range(n-1,-1,-1)]+list(range(m-1,0,-1)))
    faces.extend((a,b,b+layer,a+layer) for a,b in zip(boundary,boundary[1:]+boundary[:1]))
    mesh=owned.make('SCR_ContinuousQuadCage',vertices,faces)
    bm=bmesh.new()
    try:
        bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        if bm.calc_volume(signed=True)<0:bmesh.ops.reverse_faces(bm,faces=list(bm.faces))
        bm.to_mesh(mesh)
    finally:bm.free()
    mesh.update();candidate=_Surface(mesh);ratios=[];errors=[];relative_errors=[];misses=0
    for _,_,point,pair in samples:
        actual=candidate.pair(point)
        if actual is None:misses+=1;continue
        before=pair[1]-pair[0];after=actual[1]-actual[0]
        ratios.append(after/before);errors.append(abs(after-before));relative_errors.append(abs(after-before)/before)
    if not ratios or misses>len(samples)*.03:raise ValueError('厚度采样出现空区，未保留此笼体')
    def dimensions(mesh):return [max(v.co[k] for v in mesh.vertices)-min(v.co[k] for v in mesh.vertices) for k in range(3)]
    before,after=dimensions(source),dimensions(mesh)
    return mesh,{'method':'continuous contour-driven quad patches with shared rim',
                 'independent_blocks':False,'quad_faces':len(faces),'quad_ratio':1.,'divisions':list(divisions),
                 'u_stations':u,'v_stations':v,'outline_samples':len(poly),'outline_loops':loop_count,
                 'maximum_contour_correction_relative':contour_move,'maximum_fit_move_relative':fit_move,
                 'hidden_tangent_stations_kept':hidden,
                 'planning_misses':missing,'principal_dimension_ratios':[b/a for a,b in zip(before,after)],
                 'minimum_diagonal_layer_gap_relative':minimum_gap,
                 'thickness':{'method':'paired source-axis rays at cell interiors; not normal thickness',
                              'samples':len(ratios),'misses':misses,'median_ratio':statistics.median(ratios),
                              'median_relative_error':statistics.median(relative_errors),
                              'p95_relative_error':sorted(relative_errors)[min(len(relative_errors)-1,int(.95*len(relative_errors)))],
                              'mean_absolute_error_relative':sum(errors)/len(errors),
                              'max_absolute_error_relative':max(errors)}}
