"""Isolated asset review. Never execute in the user's live Blender scene.

Inputs are JSON snapshots/seed fixtures, never geometry-specific algorithm code.
Use --background --factory-startup --python review_fixture.py -- --source ...
"""
import argparse
from array import array
import importlib
import json
import pathlib
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from SurfaceCageRebuild import analysis, reconstruct, validation


def create_mesh(name, vs, fs):
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(vs,[],fs);mesh.update()
    return mesh


def obj(name, mesh, color):
    result=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(result)
    result.color=(*color,1)
    if not mesh.materials:
        material=bpy.data.materials.new(name+' display');material.diffuse_color=(*color,1)
        mesh.materials.append(material)
    return result


def render_views(source, right, output):
    scene=bpy.context.scene
    scene.render.engine='BLENDER_WORKBENCH'
    scene.display.shading.light='STUDIO';scene.display.shading.color_type='MATERIAL'
    scene.display.shading.show_shadows=True;scene.display.shading.show_cavity=True
    scene.display.shading.background_type='WORLD';scene.world.color=(.12,.12,.12)
    scene.render.resolution_x=960;scene.render.resolution_y=480;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG'
    camera=bpy.data.objects.new('Review Camera',bpy.data.cameras.new('Review Camera'))
    scene.collection.objects.link(camera);scene.camera=camera;camera.data.type='ORTHO'
    points=[v.co for v in source.data.vertices]
    center=Vector([(min(p[k] for p in points)+max(p[k] for p in points))*.5 for k in range(3)])
    scale=analysis.size(source.data)
    camera.data.clip_start=scale*.001;camera.data.clip_end=scale*100
    views=[('front',(0,-1,0)),('side',(1,0,0)),('top',(0,0,1)),('back',(0,1,0)),('oblique',(1,-1,1))]
    paths=[]
    for name,direction in views:
        rotation=Vector(direction).to_track_quat('Z','Y')
        horizontal=rotation@Vector((1,0,0));vertical=rotation@Vector((0,1,0))
        width=max(p.dot(horizontal) for p in points)-min(p.dot(horizontal) for p in points)
        height=max(p.dot(vertical) for p in points)-min(p.dot(vertical) for p in points)
        spacing=max(width*1.25,scale*.55)
        source.location=-center-horizontal*spacing*.5
        for other in right:other.location=-center+horizontal*spacing*.5
        camera.rotation_mode='QUATERNION';camera.rotation_quaternion=rotation
        camera.location=Vector(direction).normalized()*scale*3
        camera.data.ortho_scale=max((width+spacing)*1.15,height*2*1.15)
        scene.render.filepath=str(output/(name+'.png'))
        bpy.ops.render.render(write_still=True)
        paths.append(scene.render.filepath)
    # Contact sheet uses saved renders, with no image-generation/editing service.
    # This is a deterministic scientific review layout, not alteration of geometry.
    w,h=960,480;canvas=array('f',[.12,.12,.12,1])*(w*2*h*3)
    for index,path in enumerate(paths):
        im=bpy.data.images.load(path,check_existing=False)
        pixels=array('f',[0])*(w*h*4);im.pixels.foreach_get(pixels)
        left=(index%2)*w;bottom=(2-index//2)*h
        for y in range(h):
            begin=((bottom+y)*w*2+left)*4
            canvas[begin:begin+w*4]=pixels[y*w*4:(y+1)*w*4]
        bpy.data.images.remove(im)
    sheet=bpy.data.images.new('Five View Comparison',width=w*2,height=h*3)
    sheet.pixels.foreach_set(canvas);sheet.filepath_raw=str(output/'five-view-comparison.png')
    sheet.file_format='PNG';sheet.save()
    return paths


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source',required=True);parser.add_argument('--seeds',required=True)
    parser.add_argument('--output',required=True)
    parser.add_argument('--groups',default='1');parser.add_argument('--method',choices=['strip','profile'],default='strip')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    # Refuse accidental invocation without the explicit isolated-process flags.
    if not bpy.app.background:raise RuntimeError('This fixture review requires an isolated background process')
    output=pathlib.Path(args.output);output.mkdir(parents=True,exist_ok=True)
    payload=json.loads(pathlib.Path(args.source).read_text(encoding='utf-8'))
    fixture=json.loads(pathlib.Path(args.seeds).read_text(encoding='utf-8'))
    source=create_mesh('Original snapshot',payload['vertices'],payload['faces'])
    signature=analysis.mesh_signature(source)
    if signature!=fixture['source_signature']:raise ValueError('Seed fixture belongs to another source')
    work=source.copy();seed=work.attributes.new('scr_seed','INT','FACE')
    seed.data.foreach_set('value',fixture['seeds'])
    data=analysis.analyze(work,{})
    groups={int(g) for g in args.groups.split(',')}
    selected=[i for i,label in enumerate(data['seed_labels']) if label in groups]
    options={'strip_segments':128,'strip_rows':6,'subdivision':2,'tolerance':.01}
    report={'source_signature':signature,'settings':options.copy(),'selected_groups':sorted(groups),
            'selected_source_faces':len(selected),'regions':data['regions_count'],
            'unresolved_faces':len(data['unresolved_faces']),'method':args.method,
            'source_triangles':sum(len(p.vertices)-2 for p in source.polygons),
            'status':'REJECTED','seams':'unwelded; retained geometry is not rebuilt',
            'visual_acceptance':False,'seed_provenance':fixture['origin']}
    candidate=None
    try:
        suggestion=reconstruct.propose_strip_anchors(work,selected,options)
        report['anchor_suggestion']=suggestion
        options['strip_anchor_pairs']=suggestion['anchor_pairs']
        if args.method=='profile':
            build=importlib.import_module('SurfaceCageRebuild.profile_strip').build_profile_strip
        else:build=reconstruct.build_strip
        candidate,details=build(work,selected,options)
        report['reconstruction']=details
        reference=reconstruct.selected_mesh(source,selected)
        report['comparison']=validation.compare_meshes(reference,candidate,options)
        report['candidate_triangles']=sum(len(p.vertices)-2 for p in candidate.polygons)
        report['status']='UNCONFIRMED_CANDIDATE'
        bpy.data.meshes.remove(reference)
    except ValueError as error:
        report['rejection']=str(error)
    if analysis.mesh_signature(source)!=signature:raise AssertionError('Source mutated')
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('FIXTURE_REVIEW',json.dumps({k:v for k,v in report.items() if k not in {'anchor_suggestion','reconstruction'}},ensure_ascii=False))
    # Only this isolated process's default scene is cleared.
    for item in list(bpy.context.scene.objects):bpy.data.objects.remove(item,do_unlink=True)
    original=obj('LEFT - original high poly',source,(.65,.65,.65))
    for p in original.data.polygons:p.use_smooth=True
    if candidate:
        rebuilt=obj('RIGHT - unconfirmed reconstructed strip',candidate,(.78,.59,.32))
        kept=reconstruct.selected_mesh(source,[i for i in range(len(source.polygons)) if i not in set(selected)])
        retained=obj('RIGHT - protected original faces',kept,(.65,.65,.65))
        for p in kept.polygons:p.use_smooth=True
        right=[rebuilt,retained]
    else:
        right=[obj('RIGHT - seed classification only, NO rebuilt candidate',work,(.4,.65,.55))]
        work.materials.clear()
        palette=[(.2,.2,.2,1),(.12,.65,.5,1),(.55,.25,.65,1),(.8,.7,.2,1),(.25,.4,.65,1)]
        for color in palette:
            mat=bpy.data.materials.new('Seed class');mat.diffuse_color=color;work.materials.append(mat)
        for p,label in zip(work.polygons,data['seed_labels']):p.material_index=label
    report['view_files']=render_views(original,right,output)
    bpy.ops.wm.save_as_mainfile(filepath=str(output/'fixture-review.blend'))
    (output/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':main()
