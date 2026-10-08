"""在Blender后台导出西施；仅修改内存副本，不保存或覆盖源blend。"""
import bpy
import sys
import numpy as np
from pathlib import Path

args = sys.argv[sys.argv.index('--') + 1:]
output = Path(args[0]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
# 西施人物独立导出，头上的角保留；龙和龙须仍留在源文件内。
names = {'头发', '角', '脸', '裙子', '身体'}
objects = [obj for obj in bpy.context.scene.objects if obj.name in names and obj.type == 'MESH']
if len(objects) != len(names):
    raise RuntimeError('西施角色网格不完整')
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 1
scene.render.bake.margin = 4
scene.render.bake.use_clear = True


def bake_socket(obj, material, socket, channel):
    """烘焙材质输入的纯色值，保留调色/混合节点，不烘焙场景光照。"""
    nodes, links = material.node_tree.nodes, material.node_tree.links
    image = bpy.data.images.new(obj.name + '_' + channel, width=1024, height=1024, alpha=True)
    image.colorspace_settings.name = 'sRGB' if socket.type == 'RGBA' else 'Non-Color'
    target = nodes.new('ShaderNodeTexImage')
    target.image = image
    for node in nodes:
        node.select = False
    target.select = True
    nodes.active = target
    out = next(node for node in nodes if node.type == 'OUTPUT_MATERIAL' and node.is_active_output)
    previous = out.inputs['Surface'].links[0].from_socket
    emission = nodes.new('ShaderNodeEmission')
    conversion = None
    if socket.is_linked:
        upstream = socket.links[0].from_socket
        if socket.type == 'VALUE':
            # 原输入为Float时先执行Blender实际的颜色转标量，不能让导出器只取红通道。
            conversion = nodes.new('ShaderNodeMath')
            conversion.operation = 'MULTIPLY'
            conversion.inputs[1].default_value = 1.0
            links.new(upstream, conversion.inputs[0])
            upstream = conversion.outputs[0]
        links.new(upstream, emission.inputs['Color'])
    else:
        value = socket.default_value
        emission.inputs['Color'].default_value = tuple(value) if hasattr(value, '__len__') else (value, value, value, 1)
    links.new(emission.outputs[0], out.inputs['Surface'])
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.bake(type='EMIT')
    links.new(previous, out.inputs['Surface'])
    nodes.remove(emission)
    if conversion:
        nodes.remove(conversion)
    image.pack()
    return image


for obj in objects:
    for slot in obj.material_slots:
        material = slot.material.copy()
        slot.material = material
        nodes, links = material.node_tree.nodes, material.node_tree.links
        out = next(node for node in nodes if node.type == 'OUTPUT_MATERIAL' and node.is_active_output)
        source = out.inputs['Surface'].links[0].from_node
        base_socket = source.inputs.get('Base Color') or source.inputs.get('Color')
        if base_socket is None:
            raise RuntimeError('无法解析基础颜色：' + obj.name)
        images = {'Base Color': bake_socket(obj, material, base_socket, 'base')}
        # 同名标准输入保留常量和连线；不能沿用新节点默认白色Emission Color。
        shader = nodes.new('ShaderNodeBsdfPrincipled')
        for target in shader.inputs:
            if target.name in ('Base Color', 'Normal', 'Tangent', 'Coat Normal', 'Alpha'):
                continue
            original = source.inputs.get(target.name)
            if original is None and target.name == 'Specular IOR Level':
                original = source.inputs.get('Specular')
            if original is None or original.type not in ('VALUE', 'RGBA'):
                continue
            if original.is_linked:
                images[target.name] = bake_socket(obj, material, original, target.name)
            else:
                target.default_value = original.default_value
        alpha = source.inputs.get('Alpha')
        if alpha and alpha.is_linked:
            alpha_image = bake_socket(obj, material, alpha, 'alpha')
            base = images['Base Color']
            rgba = np.empty(len(base.pixels), dtype=np.float32)
            mask = np.empty(len(alpha_image.pixels), dtype=np.float32)
            base.pixels.foreach_get(rgba)
            alpha_image.pixels.foreach_get(mask)
            rgba[3::4] = np.clip(mask[0::4], 0.0, 1.0)
            base.pixels.foreach_set(rgba)
            base.update()
            base.pack()
        elif alpha:
            shader.inputs['Alpha'].default_value = alpha.default_value
        for key in ('Normal', 'Coat Normal', 'Tangent'):
            original = source.inputs.get(key)
            if original and original.is_linked:
                links.new(original.links[0].from_socket, shader.inputs[key])
        for key, image in images.items():
            texture = nodes.new('ShaderNodeTexImage')
            texture.image = image
            links.new(texture.outputs['Color'], shader.inputs[key])
            if key == 'Base Color' and alpha and alpha.is_linked:
                links.new(texture.outputs['Alpha'], shader.inputs['Alpha'])
        links.new(shader.outputs['BSDF'], out.inputs['Surface'])
        print('EXPORTED_MATERIAL', obj.name, list(images), flush=True)

bpy.ops.object.select_all(action='DESELECT')
for obj in objects:
    obj.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True,
    export_animations=False, export_cameras=False, export_lights=False, export_apply=True,
    export_yup=True, export_image_format='AUTO')
print('CHARACTER_GLB', str(output), output.stat().st_size, flush=True)
