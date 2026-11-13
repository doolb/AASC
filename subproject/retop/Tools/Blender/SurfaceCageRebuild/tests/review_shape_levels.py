"""Isolated geometry-only five-level review. No images are algorithm inputs."""
import argparse
from array import array
import json
import math
import pathlib
import sys
import time

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from SurfaceCageRebuild import analysis, shape_levels


def review(source_path, output, levels=None):
    if not bpy.app.background:
        raise RuntimeError('Only run this fixture in an isolated background process')
    output.mkdir(parents=True, exist_ok=True)
    payload = json.loads(source_path.read_text())
    source = bpy.data.meshes.new('True original snapshot')
    source.from_pydata(payload['vertices'], [], payload['faces'])
    source.transform(Matrix(payload.get('matrix', Matrix.Identity(4))))
    source.update()
    signature = analysis.mesh_signature(source)
    started = time.monotonic()
    meshes, report = shape_levels.build_levels(source,levels=levels)
    report['seconds'] = time.monotonic() - started
    # Clear only the isolated process's startup objects.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.studiolight_rotate_z = .35
    shading.color_type = 'OBJECT'
    shading.show_shadows = False
    shading.show_cavity = True
    shading.cavity_type = 'BOTH'
    shading.background_type = 'WORLD'
    scene.world.color = (.055, .055, .055)
    scene.display.render_aa = '32'
    scene.view_settings.view_transform = 'Standard'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.resolution_percentage = 100
    camera = bpy.data.objects.new('Review camera', bpy.data.cameras.new('Review camera'))
    scene.collection.objects.link(camera)
    camera.data.type = 'ORTHO'
    scene.camera = camera
    objects = {}
    for key, mesh in {**meshes, 'SOURCE': source}.items():
        obj = bpy.data.objects.new(key, mesh)
        scene.collection.objects.link(obj)
        obj.color = (.63, .65, .68, 1)
        objects[key] = obj
        if key == 'SOURCE':
            for face in mesh.polygons:
                face.use_smooth = True
    points = [v.co for v in source.vertices]
    center = Vector(tuple((min(p[i] for p in points) + max(p[i] for p in points)) * .5 for i in range(3)))
    length = analysis.size(source)
    texts = []
    wires = []

    def render(keys, direction, path, width, height, wire=False):
        for old in wires:
            data=old.data
            bpy.data.objects.remove(old,do_unlink=True)
            bpy.data.curves.remove(data)
        wires.clear()
        for old in texts:
            data = old.data
            bpy.data.objects.remove(old, do_unlink=True)
            bpy.data.curves.remove(data)
        texts.clear()
        for key, obj in objects.items():
            obj.hide_render = key not in keys
            obj.hide_set(key not in keys)
            obj.show_wire = wire and key != 'SOURCE'
            obj.show_all_edges = obj.show_wire
        direction = Vector(direction).normalized()
        rotation = direction.to_track_quat('Z', 'Y')
        horizontal = rotation @ Vector((1, 0, 0))
        vertical = rotation @ Vector((0, 1, 0))
        all_points = [v.co - center for k in keys for v in objects[k].data.vertices]
        span_x = max(p.dot(horizontal) for p in all_points) - min(p.dot(horizontal) for p in all_points)
        span_y = max(p.dot(vertical) for p in all_points) - min(p.dot(vertical) for p in all_points)
        spacing = max(span_x * 1.2, length * .7)
        for index, key in enumerate(keys):
            x = (index - (len(keys) - 1) * .5) * spacing
            obj = objects[key]
            obj.location = -center + horizontal * x
            if wire and key != 'SOURCE':
                curve=bpy.data.curves.new('Actual candidate edges','CURVE')
                curve.dimensions='3D';curve.bevel_depth=length*.00035;curve.bevel_resolution=0
                for edge in obj.data.edges:
                    spline=curve.splines.new('POLY');spline.points.add(1)
                    for point,index in zip(spline.points,edge.vertices):
                        vertex=obj.data.vertices[index]
                        point.co=(*(vertex.co+vertex.normal*length*.0002),1)
                line=bpy.data.objects.new('Visible candidate edge tubes',curve)
                scene.collection.objects.link(line);line.location=obj.location.copy();line.color=(.035,.035,.035,1)
                wires.append(line)
            text = bpy.data.curves.new('Review label', 'FONT')
            text.body = 'ORIGINAL HIGH POLY' if key == 'SOURCE' else key.replace('_', '-')
            text.align_x = 'CENTER'
            text.size = length * .047
            label = bpy.data.objects.new('Label ' + key, text)
            scene.collection.objects.link(label)
            label.color = (.9, .9, .9, 1)
            label.rotation_mode = 'QUATERNION'
            label.rotation_quaternion = rotation
            label.location = horizontal * x - vertical * (span_y * .6 + length * .05)
            texts.append(label)
        camera.rotation_mode = 'QUATERNION'
        camera.rotation_quaternion = rotation
        camera.location = direction * length * 5
        camera.data.clip_start = length * .001
        camera.data.clip_end = length * 50
        camera.data.ortho_scale = max((span_x + spacing * (len(keys) - 1)) * 1.12,
                                      (span_y * 1.3 + length * .12) * width / height)
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)

    render([*meshes,'SOURCE'] if len(meshes)>1 else ['SOURCE',*meshes], (1,-1,math.sqrt(2)),
           output/('five-level-overview.png' if levels is None else 'shape-overview.png'),2500 if len(meshes)>1 else 1600,650)
    views = [('front', (0, -1, 0)), ('side', (1, 0, 0)), ('top', (0, 0, 1)),
             ('back', (0, 1, 0)), ('oblique', (1, -1, math.sqrt(2)))]
    for key in meshes:
        folder = output / key.lower()
        folder.mkdir(exist_ok=True)
        paths = []
        for name, direction in views:
            path = folder / (name + '.png')
            render(['SOURCE', key], direction, path, 1000, 560)
            paths.append(path)
        width, height = 1000, 560
        pixels = array('f', [.055, .055, .055, 1]) * (width * 2 * height * 3)
        for index, path in enumerate(paths):
            image = bpy.data.images.load(str(path), check_existing=False)
            tile = array('f', [0]) * (width * height * 4)
            image.pixels.foreach_get(tile)
            left = index % 2 * width
            bottom = (2 - index // 2) * height
            for y in range(height):
                at = ((bottom + y) * width * 2 + left) * 4
                pixels[at:at + width * 4] = tile[y * width * 4:(y + 1) * width * 4]
            bpy.data.images.remove(image)
        sheet = bpy.data.images.new(key + ' five views', width=width * 2, height=height * 3)
        sheet.pixels.foreach_set(pixels)
        sheet.filepath_raw = str(folder / 'five-view.png')
        sheet.file_format = 'PNG'
        sheet.save()
    wire_key='NEAR' if 'NEAR' in meshes else next(iter(meshes))
    render(['SOURCE',wire_key],(1,-1,math.sqrt(2)),output/(wire_key.lower().replace('_','-')+'-wire.png'),1600,900,wire=True)
    report['source_unchanged'] = analysis.mesh_signature(source) == signature
    report['visual_acceptance'] = False
    report['review_note'] = 'Generated geometry requires per-level visual assessment; no support-topology acceptance is implied.'
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'five-level-candidates.blend'))
    print('FIVE_LEVEL_REVIEW', json.dumps({key: data['health']['triangles'] for key, data in report['levels'].items()}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, type=pathlib.Path)
    parser.add_argument('--output', required=True, type=pathlib.Path)
    parser.add_argument('--levels',nargs='+',choices=shape_levels.LEVELS)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    review(args.source,args.output,args.levels)
