#!/usr/bin/env python3
"""回读实际多边形网格，比较源几何与候选；不修复或重拓扑任何输入。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

os.environ['OPENBLAS_NUM_THREADS'] = '1'
import numpy as np
import trimesh
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection


def read_obj(path):
    vertices, faces = [], []
    for line in path.read_text().splitlines():
        parts = line.split()
        if not parts:
            continue
        if parts[0] == 'v':
            vertices.append([float(v) for v in parts[1:4]])
        if parts[0] == 'f':
            faces.append([int(v.split('/')[0])-1 for v in parts[1:]])
    return np.asarray(vertices), faces


def distances(source, target, diagonal):
    # 固定种子做表面积均匀采样，距离为到目标三角表面的最近距离，不能称为精确 Hausdorff。
    points, source_faces = trimesh.sample.sample_surface(source, 5000, seed=0)
    distance_parts, angle_parts = [], []
    for start in range(0, len(points), 250):
        _, distance, target_faces = trimesh.proximity.closest_point(target, points[start:start+250])
        cosine = np.einsum('ij,ij->i', source.face_normals[source_faces[start:start+250]], target.face_normals[target_faces])
        distance_parts.append(distance)
        angle_parts.append(np.degrees(np.arccos(np.clip(cosine, -1, 1))))
    distance, angle = np.concatenate(distance_parts), np.concatenate(angle_parts)
    return {'samples': len(points), 'mean': float(distance.mean()),
            'p95': float(np.percentile(distance,95)), 'max_sampled': float(distance.max()),
            'p95_percent_of_source_diagonal': float(np.percentile(distance,95)/diagonal*100),
            'normal_angle_median_degrees': float(np.median(angle)),
            'normal_angle_p95_degrees': float(np.percentile(angle,95)),
            'opposed_nearest_normal_samples': int((angle>90).sum())}


def render(source, candidate, output):
    # 两列共享原件中心、比例、相机与光照；只绘制真实多边形边，不隐去源件三角边。
    center = (source[0].min(axis=0)+source[0].max(axis=0))/2
    views = [('Front +Z', (0,0,1), (0,1,0)), ('Side +X', (1,0,0), (0,1,0)),
             ('Top +Y', (0,1,0), (0,0,-1)), ('Back -Z', (0,0,-1), (0,1,0)),
             ('Oblique', (1,0.7,1), (0,1,0))]
    fig, axes = plt.subplots(5,2,figsize=(12,22), facecolor='#edf1f5')
    for row,(name,direction,up) in enumerate(views):
        direction = np.asarray(direction,dtype=float)
        direction /= np.linalg.norm(direction)
        right = np.cross(up,direction)
        right /= np.linalg.norm(right)
        vertical = np.cross(direction,right)
        projected = (source[0]-center) @ np.stack([right,vertical],axis=1)
        low, high = projected.min(axis=0), projected.max(axis=0)
        span = max(high-low)*0.57
        midpoint = (low+high)/2
        for column,(vertices,faces) in enumerate([source,candidate]):
            ax=axes[row,column]
            xyz=vertices-center
            xy=xyz @ np.stack([right,vertical],axis=1)
            depths=np.asarray([(xyz[face] @ direction).mean() for face in faces])
            order=np.argsort(depths)
            polygons,colors=[],[]
            light=direction+0.3*vertical-0.2*right
            light/=np.linalg.norm(light)
            for index in order:
                face=faces[index]
                normal=np.cross(xyz[face[1]]-xyz[face[0]],xyz[face[2]]-xyz[face[0]])
                normal/=max(np.linalg.norm(normal),1e-12)
                shade=0.48+0.42*max(0,float(normal @ light))
                colors.append(np.asarray([0.72,0.81,0.89])*shade+0.08)
                polygons.append(xy[face])
            collection=PolyCollection(polygons,facecolors=colors,edgecolors='#253444',linewidths=0.25 if column==0 else 0.55)
            ax.add_collection(collection)
            ax.set_xlim(midpoint[0]-span,midpoint[0]+span)
            ax.set_ylim(midpoint[1]-span,midpoint[1]+span)
            ax.set_aspect('equal')
            ax.set_axis_off()
            label='Original high mesh' if column==0 else 'SQuadGen candidate'
            ax.set_title(f'{name} | {label}\n{len(vertices)} vertices / {len(faces)} polygons',fontsize=12)
    fig.suptitle('Same scale and cameras | Native polygon edges | Candidate, not production acceptance',fontsize=14)
    fig.tight_layout(rect=[0,0,1,0.98])
    fig.savefig(output,dpi=150)
    plt.close(fig)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True)
    parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--engine-dir',type=Path,required=True)
    args=parser.parse_args()
    source_hash=hashlib.sha256(args.source.read_bytes()).hexdigest()
    source=read_obj(args.source)
    candidate=read_obj(args.candidate)
    # 项目现有审计直接读取原始多边形，不先由通用 mesh 库把四边形拆成三角形。
    node_code='''
const fs=require('node:fs');
const [engineDir,sourcePath,candidatePath]=process.argv.slice(1);
const E=require(engineDir+'/engine.js')();
const grid=require(engineDir+'/structure-grid.js')(E);
const source=E.parseOBJ(fs.readFileSync(sourcePath,'utf8'));
const candidate=E.parseOBJ(fs.readFileSync(candidatePath,'utf8'));
// 无效四边形属于测试结果：保留错误，不能把审计异常当成无穿插。
const inspectIntersections=mesh=>{
 try { return {pairs:grid.intersections(mesh),error:null,failedTriangulationFaces:[]}; }
 catch(error) {
  const failedTriangulationFaces=[];
  mesh.faces.forEach((face,index)=>{
   try { E.triangulate({vertices:mesh.vertices,faces:[face]}); }
   catch(faceError) { failedTriangulationFaces.push({index,reason:faceError.message}); }
  });
  return {pairs:null,error:error.message,failedTriangulationFaces};
 }
};
process.stdout.write(JSON.stringify({source:E.audit(source),candidate:E.audit(candidate),
 sourceIntersections:inspectIntersections(source),candidateIntersections:inspectIntersections(candidate)}));
'''
    result=subprocess.run(['node','-e',node_code,str(args.engine_dir),str(args.source),str(args.candidate)],check=False,text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError('几何检查子进程失败：' + result.stderr)
    report=json.loads(result.stdout)
    source_tri=trimesh.load_mesh(args.source,process=False)
    candidate_tri=trimesh.load_mesh(args.candidate,process=False)
    diagonal=float(np.linalg.norm(source[0].max(axis=0)-source[0].min(axis=0)))
    report.update(source_to_candidate=distances(source_tri,candidate_tri,diagonal),
                  candidate_to_source=distances(candidate_tri,source_tri,diagonal),
                  distance_method='5000 fixed-seed area-uniform samples each direction; nearest triangle surface; not exact Hausdorff; triangulated diagnostic proxy does not certify invalid source polygons',
                  all_native_faces_are_quads=all(len(face)==4 for face in candidate[1]),
                  source_unchanged=hashlib.sha256(args.source.read_bytes()).hexdigest()==source_hash,
                  status='candidate-inspected-not-production-accepted' if report['candidate']['valid'] and not report['candidateIntersections']['error'] else 'rejected-invalid-geometry')
    output=args.candidate.parent
    (output/'comparison-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    render(source,candidate,output/'comparison-five-views.png')
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__=='__main__':
    main()
