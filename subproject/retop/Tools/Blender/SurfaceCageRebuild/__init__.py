bl_info = {
    'name':'Surface Cage Rebuild (实验版)', 'author':'Codex', 'version':(0,1,0),
    'blender':(4,3,0), 'location':'3D View > Sidebar > 卡线重建',
    'description':'三角高模结构分析、区域修正及受检中模候选；不是任意高模一键逆细分',
    'category':'Mesh',
}

import colorsys
import json
import math
import bpy
import bmesh
from bpy.props import BoolProperty, CollectionProperty, EnumProperty, FloatProperty, IntProperty, PointerProperty, StringProperty
from mathutils import Matrix, Vector

from . import analysis, reconstruct, validation, profile_strip, turn_lines, shape_levels, smooth_groups, multiscale_boundaries


class SCR_Settings(bpy.types.PropertyGroup):
    smooth_boundary_level:EnumProperty(name='当前边界档位',items=[(key,multiscale_boundaries.LABELS[key],'') for key in multiscale_boundaries.LEVELS],default='NEAR')
    boundary_scale_far_mid:IntProperty(name='远中邻域分格',default=4,min=2,max=32)
    boundary_scale_middle:IntProperty(name='中邻域分格',default=16,min=4,max=128)
    boundary_scale_near:IntProperty(name='近邻域分格',default=64,min=8,max=256)
    smooth_min_area:FloatProperty(name='碎组面积 / 总面积',default=.002,min=0,max=.1,precision=4,
        description='仅标记不确定小组，不跨边界自动合并')
    shape_middle_resolution:IntProperty(name='中档重采样分格',default=40,min=24,max=80,
        description='按每个独立壳体最长主方向计算体素尺度；不影响原高模')
    shape_middle_smoothing:IntProperty(name='中档去细节强度',default=40,min=8,max=100)
    shape_block_columns:IntProperty(name='远中大形纵向分段',default=4,min=2,max=8)
    shape_block_rows:IntProperty(name='远中大形横向分段',default=6,min=2,max=8)
    shape_near_ratio:FloatProperty(name='近档三角面保留比例',default=.35,min=.1,max=1,precision=2)
    shape_near_radius:FloatProperty(name='近档结构窗口 / 长度',default=.035,min=.005,max=.08,precision=3)
    analysis_rings:IntProperty(name='邻域尺度',default=2,min=1,max=5)
    feature_angle:FloatProperty(name='转折敏感度（角度）',default=28,min=5,max=80)
    density_weight:FloatProperty(name='密度证据权重',default=.25,min=0,max=.45)
    density_area_percent:FloatProperty(name='面积尺度占比 (%)',default=100,min=0,max=100,precision=1,
        description='密度尺度配比：100仅用面面积平方根，0仅用邻边中位数，50恢复旧版混合；边长占比自动为100减此值。更改后执行分析或按种子/锁边重新分区')
    curvature_ratio:FloatProperty(name='窄转折 / 背景曲率',default=2.5,min=1.2,max=8)
    turn_method:EnumProperty(name='识别方式',items=[('NETWORK','结构边界线网','按高模几何判断边界，支持面积曲率与双侧平面交线，再作矢量平滑；实验候选'),('TRACE','边界单线 + 切角卡线','先沿转折带追踪每条结构边界的一根中心线（跨三角面、平滑少弯折、保留尖角凹口，可略偏离高模），再在两侧生成两根切角卡线；仍需确认'),('CONTRAST','面积＋曲率差异边界','两侧直接相邻面与邻域的面积、曲率均有明显变化才作为边界候选；不自动切面'),('EDGE','逐边转折线','按两侧法线变化和横向间距检测实际转折边'),('BAND','面带双边界（辅助）','曲率面带边界，尚未配对；不规则三角网格可能绕行')],default='EDGE')
    network_path:EnumProperty(name='线网路径',items=[('PLANES','面积曲率边界 → 平面交线','边界两侧稳定面延伸相交形成硬转折，再作矢量平滑',0,2),('TRACE','凹凸分离追踪','逐条追踪几何转折并连接交点',0,0),('CELLS','局部起伏分区','从局部起伏分区的共享边界生成候选线网，实验模式',0,1)],default='TRACE')
    boundary_curvature_kernel:EnumProperty(name='曲率滤波窗口',items=[('GRAPH','网格邻接','沿原网格邻接处理曲率'),('VOXEL','多尺度立方网格','远层整体盒与中/近/超近稀疏立方网格，拓扑和法线限制跨层采样；无需训练')],default='GRAPH')
    boundary_voxel_layout:EnumProperty(name='体素层级',items=[('PYRAMID','远/中/近/超近','远层为一个主方向拟合盒，其余按物体最长尺度细分'),('LOCAL','相邻小窗口','旧版同分辨率3/5/9局部窗口')],default='PYRAMID')
    boundary_voxel_middle:IntProperty(name='中层最长边分格',default=8,min=2,max=32)
    boundary_voxel_near:IntProperty(name='近层最长边分格',default=32,min=4,max=256)
    boundary_voxel_ultra:IntProperty(name='超近层最长边分格',default=128,min=8,max=512)
    boundary_voxel_size:FloatProperty(name='体素边长 / 尺度',default=.01,min=.002,max=.03,precision=4)
    boundary_curvature_rounds:IntProperty(name='曲率保边增强次数',default=2,min=0,max=10)
    boundary_curvature_gate:FloatProperty(name='曲率变化分界',default=.25,min=.01,max=.99,precision=3,description='相对变化小于此值做平滑，大于此值增强差异')
    boundary_curvature_gain:FloatProperty(name='大变化增强强度',default=.5,min=0,max=2,precision=3)
    boundary_vector_merge:FloatProperty(name='矢量合并距离 / 尺度',default=.0001,min=.00001,max=.005,precision=5)
    boundary_plane_radius:FloatProperty(name='双侧平面搜索 / 尺度',default=.06,min=.005,max=.2,precision=3)
    boundary_hard_offset:FloatProperty(name='交线外扩上限 / 尺度',default=.03,min=.001,max=.1,precision=3)
    network_relief_rounds:IntProperty(name='起伏邻域平滑',default=8,min=2,max=30)
    network_relief_prominence:FloatProperty(name='峰值保留显著度',default=.24,min=.01,max=.8,precision=3,description='相对局部起伏范围的显著度；越大合并越多浅起伏，不读取参考图')
    network_boundary_support:FloatProperty(name='边界几何支持度',default=.55,min=.1,max=2,precision=3)
    network_vector_smoothing:IntProperty(name='边界矢量平滑次数',default=12,min=0,max=40)
    network_smooth_allowance:FloatProperty(name='平滑位移 / 物件尺度',default=.004,min=0,max=.02,precision=4)
    network_simplify_error:FloatProperty(name='线网简化预算 / 物件尺度',default=.004,min=.0001,max=.02,precision=4,description='对共享交点之间的整条折线简化；保护交点，不读取参考图')
    trace_support:BoolProperty(name='生成两侧切角卡线',default=True,
        description='在每条边界线两侧按转折带半宽各偏移一根，模拟切角后的卡线')
    trace_chamfer_scale:FloatProperty(name='卡线间距倍数',default=1,min=.2,max=3,
        description='相对自动估计的转折带半宽；大于1卡线更外扩')
    trace_smoothing:IntProperty(name='线条平滑次数',default=8,min=0,max=40,
        description='越大越流畅、弯折越少；检测到的尖角和凹口保持固定')
    trace_cage_allowance:FloatProperty(name='离面平滑预算 / 物件尺度',default=.003,min=0,max=.02,precision=4,
        description='相对原追踪点限制空间平滑位移，不强制贴面；不是细分误差预算')
    trace_simplify_error:FloatProperty(name='线条简化误差 / 物件尺度',default=.0015,min=0,max=.01,precision=4,
        description='边界与两侧卡线共同约束简化，保留角点及三线对应')
    boundary_area_ratio:FloatProperty(name='边界两侧面积比',default=2,min=1.01,max=100,
        description='较大面积除以较小面积；直接相邻面和两侧邻域都必须达到此比值')
    boundary_curvature_change:FloatProperty(name='边界曲率差异',default=.5,min=.01,max=1,
        description='两侧曲率差除以较大曲率；0.5表示至少50%，必须同时满足面积差异')
    boundary_curvature_floor:FloatProperty(name='边界最低曲率',default=4,min=.01,max=1000,
        description='按物件尺度归一的曲率下限，避免平面数值噪声；等密度结构边会漏检，不能直接用于自动切面')
    turn_surface_fit:BoolProperty(name='局部曲面主方向过滤',default=True,
        description='直接拟合网格邻域的二次曲面；两个尺度均可靠时排除横穿转折带的边。硬折边及拟合不确定处保留，不是完整脊线提取')
    turn_direction_angle:FloatProperty(name='结构线方向容差',default=35,min=5,max=85,
        description='相对低弯曲方向的最大偏角；越小过滤越严格，可能产生断点')
    turn_adaptive_area:BoolProperty(name='曲率自适应面积匹配',default=True,
        description='仅约束逐边转折线的弱证据延续；曲率、凹凸和走向一致时放宽面积差异。不改变强证据阈值或分区，最终短线网过滤仍生效')
    turn_area_ratio:FloatProperty(name='基础面积比上限',default=2,min=1,max=100,
        description='连续两条边所邻接面的平均原始面积之比，大除以小；不是面积尺度占比')
    turn_area_relax:FloatProperty(name='同曲率放宽倍数',default=3,min=1,max=20,
        description='曲率相同时允许的面积比为基础上限乘此值；设为1使用固定面积容差')
    turn_curvature_tolerance:FloatProperty(name='曲率相对差容差',default=.35,min=.01,max=.95,
        description='两条连续边的曲率差除以较大曲率；超过即停止弱线延续，凹凸相反也停止')
    turn_weak_ratio:FloatProperty(name='转折线延续阈值',default=.55,min=.1,max=1,
        description='允许强转折带沿较弱的几何证据连续延伸；不会跨越纯平面补线')
    turn_min_length:FloatProperty(name='最短连通线网 / 物件尺度',default=.03,min=0,max=1,precision=3,
        description='按连通线网总长过滤孤立碎线；密集分叉不会逐段删除，不强行配对或补线')
    seed_group:IntProperty(name='种子组编号',default=1,min=1,max=64)
    method:EnumProperty(name='重建路径',items=[('CONSERVATIVE','保留结构 / 多边面候选','固定分区及保护边，消除近共面冗余边；不是完整卡线重建'),('INVERSE','规则网格逆细分候选','仅当三角网格可恢复为规则四边网格时使用')],default='CONSERVATIVE')
    planar_angle:FloatProperty(name='内部溶解角度',default=1,min=.01,max=5)
    reverse_steps:IntProperty(name='逆细分层数',default=1,min=1,max=3)
    subdivision:IntProperty(name='回验细分级别',default=2,min=0,max=3)
    fit_iterations:IntProperty(name='拟合步数',default=12,min=0,max=40)
    tolerance:FloatProperty(name='误差 / 物件对角线',default=.01,min=.00001,max=.1,precision=5)
    base_tolerance:FloatProperty(name='基础网格误差预算',default=.01,min=.00001,max=.1,precision=5)
    strip_path:EnumProperty(name='面带路径',items=[('CHORD','正面局部投影','适合近平缓的两闭环面带'),('PROFILE','沿曲面截面','沿原曲面跨过包边转折，独立检查基础与细分误差')],default='CHORD')
    strip_segments:IntProperty(name='面带周向分段',default=32,min=4,max=512)
    strip_rows:IntProperty(name='面带横向分段',default=4,min=2,max=12)
    support_spacing:FloatProperty(name='支撑线 / 带宽',default=.12,min=.01,max=.24)
    view_mode:EnumProperty(name='分析显示',items=[('REGIONS','区域','连通候选分区'),('DENSITY','密度','红密蓝疏'),('BEND','转折响应','红色为局部转折响应强'),('CURVATURE','尺度曲率','按物理距离估计的法线变化'),('SEEDS','种子分区','0 为没有种子可达的区域')],default='REGIONS')


class SCR_State(bpy.types.PropertyGroup):
    source:PointerProperty(type=bpy.types.Object)
    reference:PointerProperty(type=bpy.types.Mesh)
    source_signature:StringProperty()
    working_signature:StringProperty()
    role:StringProperty()
    report_name:StringProperty()


class SCR_OutputSlot(bpy.types.PropertyGroup):
    source:PointerProperty(type=bpy.types.Object)
    role:StringProperty()
    output:PointerProperty(type=bpy.types.Object)


MARKINGS=(('scr_locked','EDGE'),('scr_protect','FACE'),('scr_seed','FACE'),('scr_anchor','POINT'))


def _free(data):
    if data is not None and data.users==0:
        (bpy.data.curves if isinstance(data,bpy.types.Curve) else bpy.data.meshes).remove(data)


def _slot(context, source, role):
    slots=context.scene.scr_outputs
    slot=next((s for s in slots if s.source==source and s.role==role),None)
    if slot is None:
        slot=slots.add();slot.source=source;slot.role=role
    return slot


def _current(context, source, role, keep=None):
    obj=_slot(context,source,role).output
    return None if obj is None or (keep and keep(obj)) else obj


def _output(context, source, role, name, data, keep=None):
    """Slot-tracked (not name-tracked) output per source/role; hand-edited ones (keep) are released untouched."""
    slot=_slot(context,source,role)
    released=slot.output is not None
    obj=_current(context,source,role,keep)
    if obj is None:
        obj=bpy.data.objects.new(name,data);slot.output=obj
        obj.scr_state.source=source;obj.scr_state.role=role
        state='released' if released else 'created'
    else:
        old=obj.data
        if old!=data:
            old_name=old.name;obj.data=data
            if old.users==0:_free(old);data.name=old_name
        state='reused'
    if context.view_layer.objects.get(obj.name) is None:
        context.collection.objects.link(obj)
    obj.hide_set(False)
    return obj,state


def _topology(mesh):
    edges=[0]*(2*len(mesh.edges));mesh.edges.foreach_get('vertices',edges)
    corners=[0]*len(mesh.loops);mesh.loops.foreach_get('vertex_index',corners)
    sizes=[0]*len(mesh.polygons);mesh.polygons.foreach_get('loop_total',sizes)
    return len(mesh.vertices),edges,corners,sizes


def _manual_partition(obj):
    return bool(obj.get('SCR_ManualPartition'))


def _edited(obj):
    if obj.mode=='EDIT' or analysis.mesh_signature(obj.data)!=obj.scr_state.working_signature:return True
    if obj.scr_state.role.startswith('SMOOTH_GROUPS'):return obj.get('SCR_SmoothSignature','')!=smooth_groups.preview_signature(obj.data)
    key='SCR_VectorTopology' if obj.scr_state.role=='VECTOR_NETWORK' else 'SCR_ShapeTopology' if obj.scr_state.role.startswith('SHAPE_') else None
    return key is not None and obj.get(key,'')!=json.dumps(_topology(obj.data),separators=(',',':'))


def settings(context):
    prop=context.scene.scr_settings
    return {key:getattr(prop,key) for key in SCR_Settings.__annotations__}


def snapshot(source):
    bpy.context.view_layer.update()
    graph=bpy.context.evaluated_depsgraph_get()
    result=bpy.data.meshes.new_from_object(source.evaluated_get(graph),preserve_all_data_layers=True,depsgraph=graph)
    result.transform(source.matrix_world)
    if source.matrix_world.determinant()<0:
        bm=bmesh.new();bm.from_mesh(result);bmesh.ops.reverse_faces(bm,faces=list(bm.faces));bm.to_mesh(result);bm.free()
    return result


def check_work(obj, role='ANALYSIS'):
    if obj is None or obj.type!='MESH' or obj.scr_state.role!=role:
        raise ValueError('请选择本工具生成的'+('分析副本' if role=='ANALYSIS' else '候选结果'))
    state=obj.scr_state
    if not state.source or not state.reference:raise ValueError('源对象或参考快照已丢失，请重新分析')
    if obj.mode=='EDIT':obj.update_from_editmode()
    if role=='ANALYSIS' and analysis.mesh_signature(obj.data)!=state.working_signature:
        raise ValueError('分析副本几何已修改，请重新分析；不能继续使用旧面索引')
    current=snapshot(state.source)
    try:
        if analysis.mesh_signature(current)!=state.source_signature:
            raise ValueError('源对象几何、变换或修改器已变化，请重新分析')
    finally:bpy.data.meshes.remove(current)
    return state


def _attribute(mesh,name,kind,domain,values):
    attr=mesh.attributes.get(name) or mesh.attributes.new(name,kind,domain)
    attr.data.foreach_set('value',values)


def _analysis_attributes(mesh,data):
    for name,kind,domain,values in (
        ('scr_region','INT','FACE',data['regions']),
        ('scr_spacing','FLOAT','FACE',data['spacing']),
        ('scr_bend','FLOAT','FACE',data['bend']),
        ('scr_curvature','FLOAT','FACE',data['curvature']),
        ('scr_seed_label','INT','FACE',data['seed_labels']),
        ('scr_score','FLOAT','EDGE',data['scores'])):
        _attribute(mesh,name,kind,domain,values)


def _analysis_report(data):
    arrays={'regions','shell_ids','classes','spacing','bend','scores','angles','density_change',
            'curvature','turn_band','seed_labels','seed_margin','unresolved_faces','leaked_feature_edges'}
    result={k:v for k,v in data.items() if k not in arrays}
    result.update(turn_band_faces=sum(data['turn_band']),unresolved_faces_count=len(data['unresolved_faces']),
                  leaked_feature_edges_count=len(data['leaked_feature_edges']))
    return result


def _report(obj,data):
    text=bpy.data.texts.get(obj.scr_state.report_name) if obj.scr_state.report_name else None
    if text is None:text=bpy.data.texts.new(obj.name+'_Report.json')
    text.clear();text.write(json.dumps(data,ensure_ascii=False,indent=2));obj.scr_state.report_name=text.name
    obj['SCR_Status']=data.get('status','候选')


def _palette(mesh):
    mesh.materials.clear()
    for i in range(32):
        name='SCR_Inspection_%02d'%i
        mat=bpy.data.materials.get(name)
        if mat is None:
            mat=bpy.data.materials.new(name);mat.use_nodes=True
            color=(*colorsys.hsv_to_rgb(i/32,.65,.8),1)
            mat.diffuse_color=color
            node=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
            if node:node.inputs['Base Color'].default_value=color
        mesh.materials.append(mat)


def _colors(obj,mode):
    mesh=obj.data
    attr=mesh.attributes[{'REGIONS':'scr_region','DENSITY':'scr_spacing','BEND':'scr_bend',
                          'CURVATURE':'scr_curvature','SEEDS':'scr_seed_label'}[mode]]
    values=[v.value for v in attr.data]
    low,high=min(values),max(values)
    for p,value in zip(mesh.polygons,values):
        if mode in {'REGIONS','SEEDS'}:p.material_index=(int(value)*13)%32
        else:
            t=(value-low)/max(high-low,1e-12)
            p.material_index=int(21*(t if mode=='DENSITY' else 1-t))


def _activate(obj):
    for old in bpy.context.selected_objects:old.select_set(False)
    obj.select_set(True);bpy.context.view_layer.objects.active=obj


def _new_result(context,work,mesh,report,role='CANDIDATE',reference=None):
    source=work.scr_state.source
    obj,state_=_output(context,source,role,source.name+'_SCR_'+role,mesh,keep=_edited)
    if state_!='reused':
        obj.matrix_world=work.matrix_world.copy()
        obj.location.x+=analysis.size(work.data)*1.2
    state=obj.scr_state;previous=work.scr_state;old_reference=state.reference
    state.reference=reference if reference is not None else previous.reference
    if old_reference!=state.reference:_free(old_reference)
    state.source_signature=previous.source_signature;state.working_signature=analysis.mesh_signature(mesh)
    mesh.materials.clear()
    obj.show_wire=True;obj.show_all_edges=True
    _report(obj,report);_activate(obj)
    return obj,state_


def _shape_view(context, source, level):
    target=None if level=='SOURCE' else _current(context,source,'SHAPE_'+level)
    if level!='SOURCE' and target is None:
        raise ValueError('尚未生成此档，请先生成前四档形体')
    for obj in context.scene.objects:
        if obj.scr_state.source==source:
            obj.hide_set(obj!=target)
    source.hide_set(False)
    if target is not None:_activate(target)
    else:_activate(source)


class SCR_OT_shape_levels(bpy.types.Operator):
    bl_idname='scr.shape_levels';bl_label='生成前四档形体';bl_options={'REGISTER','UNDO'}
    only_far_mid:BoolProperty(name='只更新远中档',default=False,options={'SKIP_SAVE'})
    def execute(self,context):
        reference=None;meshes={}
        try:
            active=context.object
            source=active.scr_state.source if active and active.scr_state.source else active
            if context.mode!='OBJECT' or source is None or source.type!='MESH':
                raise ValueError('请在物体模式选择原高模或其工具输出')
            reference=snapshot(source)
            meshes,report=shape_levels.build_levels(reference,settings(context),levels=('FAR_MID',) if self.only_far_mid else None)
            # Native geometry stages complete before touching any previous output.
            offset=Vector((1,0,0))
            area=next((a for a in context.screen.areas if a.type=='VIEW_3D'),None) if context.screen else None
            if area:offset=area.spaces.active.region_3d.view_rotation@offset
            offset*=analysis.size(reference)*1.25
            for level in meshes:
                mesh=meshes[level]
                obj,status=_output(context,source,'SHAPE_'+level,source.name+'_SCR_'+level,mesh,keep=_edited)
                if status!='reused':
                    obj.matrix_world=Matrix.Identity(4);obj.location=offset
                state=obj.scr_state;old_reference=state.reference;state.reference=reference
                if old_reference!=reference:_free(old_reference)
                state.source_signature=report['source_signature'];state.working_signature=analysis.mesh_signature(mesh)
                obj['SCR_ShapeTopology']=json.dumps(_topology(mesh),separators=(',',':'))
                obj['SCR_ShapeLevel']=level;obj['SCR_ShapeLabel']=shape_levels.LABELS[level]
                obj.show_wire=False;obj.show_all_edges=False
                obj.color=(.63,.65,.68,1);mesh.materials.clear()
                _report(obj,report)
                obj['SCR_Status']=shape_levels.LABELS[level]+'；'+report['status']
            _shape_view(context,source,'FAR_MID' if self.only_far_mid else 'MIDDLE')
            self.report({'INFO'},'已更新连续四边面远中大形候选' if self.only_far_mid else '已生成远 / 远中 / 中 / 近四档形体候选；超近为原高模')
            return {'FINISHED'}
        except Exception as exc:
            for mesh in meshes.values():_free(mesh)
            _free(reference)
            self.report({'ERROR'},str(exc));return {'CANCELLED'}


class SCR_OT_shape_view(bpy.types.Operator):
    bl_idname='scr.shape_view';bl_label='查看形体档位';bl_options={'REGISTER','UNDO'}
    level:EnumProperty(items=[(key,shape_levels.LABELS[key],'') for key in (*shape_levels.LEVELS,'SOURCE')])
    def execute(self,context):
        try:
            active=context.object
            source=active.scr_state.source if active and active.scr_state.source else active
            if context.mode!='OBJECT' or source is None or source.type!='MESH':
                raise ValueError('请在物体模式选择原高模或其工具输出')
            _shape_view(context,source,self.level);return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


def _boundary_view(context,source,level):
    target=_current(context,source,'SMOOTH_GROUPS_'+level)
    if target is None:raise ValueError('请先从同一高模生成四档边界')
    for obj in context.scene.objects:
        if obj.scr_state.source==source:obj.hide_set(obj!=target and obj.parent!=target)
    source.hide_set(False);context.scene.scr_settings.smooth_boundary_level=level;_activate(target)


class SCR_OT_boundary_view(bpy.types.Operator):
    bl_idname='scr.boundary_view';bl_label='查看高模四尺度边界';bl_options={'REGISTER','UNDO'}
    level:EnumProperty(items=[(key,multiscale_boundaries.LABELS[key],'') for key in multiscale_boundaries.LEVELS])
    def execute(self,context):
        try:
            active=context.object
            source=active.scr_state.source if active and active.scr_state.source else active
            if context.mode!='OBJECT' or source is None or source.type!='MESH':raise ValueError('请在物体模式选择原高模或其工具输出')
            _boundary_view(context,source,self.level);return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_smooth_groups(bpy.types.Operator):
    bl_idname='scr.smooth_groups';bl_label='同一高模计算四档边界 / 分组';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        reference=None;meshes={};curves={}
        try:
            active=context.object
            source=active.scr_state.source if active and active.scr_state.source else active
            if context.mode!='OBJECT' or source is None or source.type!='MESH':raise ValueError('请在物体模式选择原高模或其工具输出')
            reference=snapshot(source);meshes,combined=smooth_groups.infer_four_groups(reference,settings(context))
            scale=analysis.size(reference);selected=context.scene.scr_settings.smooth_boundary_level
            for level,mesh in meshes.items():
                report=combined['levels'][level]
                mesh.materials.clear();palette_size=max(1,min(report['groups_count'],256))
                for index in range(palette_size):
                    name='SCR_SmoothGroup_%03d'%index;material=bpy.data.materials.get(name)
                    if material is None:
                        material=bpy.data.materials.new(name);material.diffuse_color=(*colorsys.hsv_to_rgb((index*.61803398875)%1,.55,.8),1)
                    mesh.materials.append(material)
                for face,label in zip(mesh.polygons,report['face_labels']):face.material_index=(label-1)%palette_size
                curve=bpy.data.curves.new('SCR_StrictBoundary_'+level,'CURVE');curves[level]=curve
                curve.dimensions='3D';curve.bevel_depth=scale*.0007;curve.bevel_resolution=0
                for name,color in (('SCR_GroupClosed',(.03,.8,.9,1)),('SCR_GroupLeaked',(.98,.3,.02,1))):
                    material=bpy.data.materials.get(name)
                    if material is None:material=bpy.data.materials.new(name);material.diffuse_color=color
                    curve.materials.append(material)
                for material_index,indices in enumerate((report['confirmed_boundary_edges'],report['leaked_boundary_edges'])):
                    for index in indices:
                        edge=mesh.edges[index];spline=curve.splines.new('POLY');spline.points.add(1)
                        for point,vertex in zip(spline.points,edge.vertices):
                            v=mesh.vertices[vertex];point.co=(*(v.co+v.normal*scale*.0003),1)
                        spline.material_index=material_index
            horizontal=Vector((1,0,0))
            area=next((a for a in context.screen.areas if a.type=='VIEW_3D'),None) if context.screen else None
            if area:horizontal=area.spaces.active.region_3d.view_rotation@horizontal
            for level,mesh in meshes.items():
                report=dict(combined['levels'][level],all_scales=combined['boundary_analysis'])
                obj,status=_output(context,source,'SMOOTH_GROUPS_'+level,source.name+'_SCR_BoundaryScale_'+level,mesh,keep=_edited)
                if status!='reused':obj.matrix_world=Matrix.Identity(4);obj.location=horizontal*scale*1.25
                state=obj.scr_state;old=state.reference;state.reference=reference
                if old!=reference:_free(old)
                state.source_signature=report['source_signature'];state.working_signature=analysis.mesh_signature(mesh)
                obj['SCR_SmoothSignature']=smooth_groups.preview_signature(mesh);obj['SCR_BoundaryLevel']=level
                obj['SCR_BoundaryRule']='AREA_AND_CURVATURE';obj.show_wire=False;obj.show_all_edges=False;_report(obj,report)
                overlay,_=_output(context,source,'SMOOTH_BOUNDARIES_'+level,source.name+'_SCR_BoundaryLines_'+level,curves[level])
                overlay.parent=obj;overlay.matrix_parent_inverse=Matrix.Identity(4);overlay.matrix_basis=Matrix.Identity(4)
            _boundary_view(context,source,selected)
            for area in context.screen.areas if context.screen else []:
                if area.type=='VIEW_3D':area.spaces.active.shading.type='SOLID';area.spaces.active.shading.color_type='MATERIAL'
            counts=' / '.join(str(combined['levels'][key]['candidate_edges']) for key in multiscale_boundaries.LEVELS)
            self.report({'INFO'},'同一高模四档严格边界：'+counts+'；不保证闭合')
            return {'FINISHED'}
        except Exception as exc:
            for data in (*curves.values(),*meshes.values(),reference):_free(data)
            self.report({'ERROR'},str(exc));return {'CANCELLED'}


class SCR_OT_analyze(bpy.types.Operator):
    bl_idname='scr.analyze';bl_label='分析 / 重新分析';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        active=context.object
        source=active.scr_state.source if active and active.scr_state.source else active
        if source is None or source.type!='MESH':
            self.report({'WARNING'},'请选择网格物件');return {'CANCELLED'}
        if context.mode!='OBJECT':
            self.report({'WARNING'},'请切换物体模式再分析');return {'CANCELLED'}
        reference=None;workmesh=None
        try:
            reference=snapshot(source);data=analysis.analyze(reference,settings(context))
            workmesh=reference.copy();workmesh.name=source.name+'_SCR_AnalysisMesh'
            _analysis_attributes(workmesh,data)
            previous=_current(context,source,'ANALYSIS',keep=_manual_partition)
            # Seeds, locks, protection and anchors survive reanalysis of an unchanged topology.
            carried=previous is not None and _topology(previous.data)==_topology(workmesh)
            sizes={'EDGE':len(workmesh.edges),'FACE':len(workmesh.polygons),'POINT':len(workmesh.vertices)}
            for name,domain in MARKINGS:
                values=[0]*sizes[domain]
                old=previous.data.attributes.get(name) if carried else None
                if old:old.data.foreach_get('value',values)
                _attribute(workmesh,name,'INT',domain,values)
            _palette(workmesh)
            obj,status=_output(context,source,'ANALYSIS',source.name+'_SCR_Analysis',workmesh,keep=_manual_partition)
            state=obj.scr_state;old_reference=state.reference;state.reference=reference
            if old_reference!=reference:_free(old_reference)
            state.source_signature=data['signature'];state.working_signature=analysis.mesh_signature(workmesh)
            if status!='reused':obj.location.x=analysis.size(reference)*1.25
            if 'SCR_AnchorSuggestion' in obj:del obj['SCR_AnchorSuggestion']
            _colors(obj,context.scene.scr_settings.view_mode)
            # Keep large per-face arrays in attributes, not the human-facing report.
            _report(obj,_analysis_report(data))
            _activate(obj)
            for area in context.screen.areas if context.screen else []:
                if area.type=='VIEW_3D':area.spaces.active.shading.color_type='MATERIAL'
            note={'reused':'；已更新原分析副本'+('并保留种子/锁边/保护/锚点' if carried else ''),
                  'released':'；原副本有人工合并/拆分，已保留并另建','created':''}[status]
            self.report({'INFO'},'候选分区 %s 个；请检查边界%s'%(data['regions_count'],note));return {'FINISHED'}
        except Exception as exc:
            if workmesh and workmesh.users==0:bpy.data.meshes.remove(workmesh)
            if reference and reference.users==0:bpy.data.meshes.remove(reference)
            self.report({'ERROR'},str(exc));return {'CANCELLED'}


class SCR_OT_display(bpy.types.Operator):
    bl_idname='scr.display';bl_label='更新分析颜色';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        try:
            check_work(context.object)
            if context.mode!='OBJECT':raise ValueError('请在物体模式更新颜色')
            _colors(context.object,context.scene.scr_settings.view_mode);return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_mark(bpy.types.Operator):
    bl_idname='scr.mark';bl_label='修正结构选区';bl_options={'REGISTER','UNDO'}
    action:EnumProperty(items=[(a,b,'') for a,b in [('MERGE','合并选区'),('SPLIT','拆分选区'),('LOCK','锁定选边'),('UNLOCK','解锁选边'),('PROTECT','保留选面'),('UNPROTECT','解除保护'),('SEED','设置种子'),('CLEAR_SEED','清除种子'),('ANCHOR','配对两个顶点'),('CLEAR_ANCHOR','清除选点配对')]])
    def execute(self,context):
        try:
            check_work(context.object)
            if context.mode!='EDIT_MESH':raise ValueError('请进入编辑模式选择面或边')
            bm=bmesh.from_edit_mesh(context.object.data)
            regions=bm.faces.layers.int.get('scr_region');protect=bm.faces.layers.int.get('scr_protect');locked=bm.edges.layers.int.get('scr_locked')
            faces=[f for f in bm.faces if f.select]
            if self.action in {'ANCHOR','CLEAR_ANCHOR'}:
                vertices=[v for v in bm.verts if v.select]
                anchor=bm.verts.layers.int.get('scr_anchor') or bm.verts.layers.int.new('scr_anchor')
                if self.action=='ANCHOR':
                    if len(vertices)!=2:raise ValueError('每次选择内外边界上各一个顶点，共两个顶点')
                    if any(v[anchor] for v in vertices):raise ValueError('该顶点已有配对，请先清除原配对')
                    group=max((v[anchor] for v in bm.verts),default=0)+1
                    for v in vertices:v[anchor]=group
                else:
                    groups={v[anchor] for v in vertices}
                    for v in bm.verts:
                        if v[anchor] in groups:v[anchor]=0
            elif self.action in {'LOCK','UNLOCK'}:
                edges=[e for e in bm.edges if e.select]
                if not edges:raise ValueError('没有选择边')
                for e in edges:e[locked]=int(self.action=='LOCK')
            else:
                if not faces:raise ValueError('没有选择面')
                if self.action in {'SEED','CLEAR_SEED'}:
                    seed=bm.faces.layers.int.get('scr_seed') or bm.faces.layers.int.new('scr_seed')
                    for f in faces:f[seed]=context.scene.scr_settings.seed_group if self.action=='SEED' else 0
                elif self.action in {'MERGE','SPLIT'}:
                    region=(min(f[regions] for f in faces) if self.action=='MERGE' else max(f[regions] for f in bm.faces)+1)
                    for f in faces:f[regions]=region;f.material_index=(region*13)%32
                    context.object['SCR_ManualPartition']=True
                else:
                    for f in faces:f[protect]=int(self.action=='PROTECT')
            bmesh.update_edit_mesh(context.object.data,loop_triangles=False,destructive=False)
            return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_partition(bpy.types.Operator):
    bl_idname='scr.partition';bl_label='按种子 / 锁边重新分区';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        try:
            work=context.object;check_work(work)
            if context.mode!='OBJECT':raise ValueError('切换物体模式后重新分区；保留已有种子、锁边和保护标记')
            if work.get('SCR_ManualPartition',False):
                raise ValueError('本副本已有人工合并/拆分，不能覆盖；请保留此副本，另行分析后用种子和锁边调整分区')
            data=analysis.analyze(work.data,settings(context))
            _analysis_attributes(work.data,data);_colors(work,context.scene.scr_settings.view_mode)
            _report(work,_analysis_report(data))
            self.report({'INFO'},'候选区域 %d；绕漏特征边 %d；仍需确认'%(data['regions_count'],len(data['leaked_feature_edges'])))
            return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_boundaries(bpy.types.Operator):
    bl_idname='scr.boundaries';bl_label='预览分区边界';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        bm=None
        try:
            work=context.object;check_work(work)
            if context.mode!='OBJECT':raise ValueError('请在物体模式预览')
            bm=bmesh.new();bm.from_mesh(work.data);bm.edges.ensure_lookup_table();bm.verts.ensure_lookup_table();bm.faces.ensure_lookup_table()
            regions=work.data.attributes['scr_region'].data;locks=work.data.attributes['scr_locked'].data
            edges=[tuple(v.index for v in e.verts) for e in bm.edges if len(e.link_faces)!=2 or locks[e.index].value or len({regions[f.index].value for f in e.link_faces})>1]
            source=work.scr_state.source
            mesh=bpy.data.meshes.new(source.name+'_SCR_Boundaries');mesh.from_pydata([v.co[:] for v in bm.verts],edges,[])
            obj,_=_output(context,source,'BOUNDARY_PREVIEW',source.name+'_SCR_BoundaryPreview',mesh)
            obj.matrix_world=work.matrix_world.copy()
            obj.show_in_front=True;obj.display_type='WIRE';obj['SCR_Status']='候选边界线；没有重建几何'
            return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}
        finally:
            if bm is not None:bm.free()


class SCR_OT_turn_lines(bpy.types.Operator):
    bl_idname='scr.turn_lines';bl_label='识别转折线 · 独立预览';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        reference=None;curve=None;vector_mesh=None
        try:
            active=context.object
            source=active.scr_state.source if active and active.scr_state.source else active
            if context.mode!='OBJECT' or source is None or source.type!='MESH':
                raise ValueError('请在物体模式选择源高模或分析副本')
            reference=snapshot(source)
            report=turn_lines.detect_turn_lines(reference,settings(context))
            scale=analysis.size(reference)
            reference.materials.clear()
            def material(name,color):
                mat=bpy.data.materials.get(name)
                if mat is None:
                    mat=bpy.data.materials.new(name);mat.diffuse_color=(*color,1);mat.use_nodes=True
                    node=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
                    if node:node.inputs['Base Color'].default_value=(*color,1)
                return mat
            reference.materials.append(material('SCR_TurnNeutral',(.43,.43,.43)))
            for face in reference.polygons:face.material_index=0
            curve=bpy.data.curves.new('SCR_TurnLineCurves','CURVE');curve.dimensions='3D'
            curve.bevel_depth=scale*.00075;curve.bevel_resolution=1
            curve.materials.append(material('SCR_TurnCyan',(.03,.8,.9)))
            curve.materials.append(material('SCR_TurnUncertain',(.95,.32,.04)))
            curve.materials.append(material('SCR_TurnSupport',(.98,.85,.1)))
            traced=report['method'] in {'TRACE','NETWORK'}
            lift=validation.surface(reference) if traced else None
            for line in report['lines']:
                if traced:
                    positions=[]
                    for co in line['points']:
                        hit=lift.find_nearest(co)
                        positions.append(Vector(co)+(hit[1] if hit[0] is not None else Vector())*scale*.0003)
                else:
                    ids=line['vertices'][:-1] if line['closed'] else line['vertices']
                    positions=[reference.vertices[i].co+reference.vertices[i].normal*scale*.0003 for i in ids]
                spline=curve.splines.new('POLY');spline.points.add(len(positions)-1)
                for point,co in zip(spline.points,positions):point.co=(*co,1)
                spline.use_cyclic_u=line['closed']
                if traced:spline.material_index=2 if line['role']=='support' else int(line['has_branch'])
                else:spline.material_index=int(line['has_weak_evidence'] if report['method']=='EDGE' else line['has_branch'])
            preview,status=_output(context,source,'TURN_REFERENCE',source.name+'_SCR_TurnLineSurface',reference)
            # Run from another tool object (e.g. the analysis copy): show the preview in its place.
            overlay=active!=source and active.scr_state.role not in {'TURN_REFERENCE','TURN_LINES'}
            if overlay:preview.matrix_world=active.matrix_world.copy()
            elif status!='reused':preview.location.x=scale*1.25
            if report['method']=='NETWORK':
                graph=report['network']
                vector_mesh=bpy.data.meshes.new(source.name+'_SCR_VectorNetwork')
                vector_mesh.from_pydata(graph['vertices'],graph['edges'],[]);vector_mesh.update()
                editable,_=_output(context,source,'VECTOR_NETWORK',source.name+'_SCR_VectorNetwork',vector_mesh,keep=_edited)
                editable.parent=preview;editable.matrix_parent_inverse=Matrix.Identity(4);editable.matrix_basis=Matrix.Identity(4)
                editable.display_type='WIRE';editable.show_wire=True;editable.show_all_edges=True;editable.hide_render=True
                editable.scr_state.working_signature=analysis.mesh_signature(vector_mesh)
                editable['SCR_VectorTopology']=json.dumps(_topology(vector_mesh),separators=(',',':'))
                editable.scr_state.source_signature=report['source_signature']
                editable['SCR_Status']='共享顶点的可编辑矢量线网候选；无面，未完成重建'
                editable['SCR_TurnLinePreview']=True;_report(editable,report)
            line_object,_=_output(context,source,'TURN_LINES',source.name+'_SCR_TurnLinePreview',curve)
            line_object.parent=preview
            line_object.matrix_parent_inverse=Matrix.Identity(4);line_object.matrix_basis=Matrix.Identity(4)
            legend={'EDGE':'青色强证据，橙色含弱证据延续','TRACE':'青色边界线，橙色接 T 形交汇，黄色切角卡线','NETWORK':'青色结构线，橙色共享交点；未配对卡线'}.get(report['method'],'橙色接触分叉')
            line_object['SCR_TurnLinePreview']=True
            line_object['SCR_Status']=report['status']+'；'+legend
            preview.scr_state.source_signature=report['source_signature']
            preview['SCR_TurnLinePreview']=True
            _report(preview,report)
            preview['SCR_Status']=report['status']+'；'+legend
            if overlay:
                active.hide_set(True)
                for child in active.children:
                    if child.get('SCR_TurnLinePreview'):child.hide_set(True)
            _activate(preview)
            for area in context.screen.areas if context.screen else []:
                if area.type=='VIEW_3D':area.spaces.active.shading.color_type='MATERIAL'
            if report.get('parameters',{}).get('path')=='RELIEF_CELLS':
                self.report({'INFO'},'%d 个起伏候选区，%d 个共享交点；尚未确认'%(report['parameters']['regions'],len(report['branch_vertices'])))
            elif traced:
                self.report({'INFO'},'%d 条边界线（%d 条闭合），%d 根切角卡线；尚未确认'%(report['boundary_count'],report['closed_count'],report['support_count']))
            else:
                self.report({'INFO'},'%d 段候选边链，%d 个分叉点；尚未选定主线或配对'%(report['line_count'],len(report['branch_vertices'])))
            return {'FINISHED'}
        except (ValueError,RuntimeError) as exc:
            if curve is not None and curve.users==0:bpy.data.curves.remove(curve)
            if vector_mesh is not None and vector_mesh.users==0:bpy.data.meshes.remove(vector_mesh)
            if reference is not None and reference.users==0:bpy.data.meshes.remove(reference)
            self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_rebuild(bpy.types.Operator):
    bl_idname='scr.rebuild';bl_label='生成中模候选';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        try:
            work=context.object;check_work(work)
            if context.mode!='OBJECT':raise ValueError('请切换物体模式')
            mesh,report=reconstruct.rebuild(work.data,settings(context))
            _,status=_new_result(context,work,mesh,report)
            self.report({'INFO'},report['status']+('；原候选已手工修改，已保留并另建' if status=='released' else ''))
            return {'FINISHED'}
        except (ValueError,RuntimeError) as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_strip(bpy.types.Operator):
    bl_idname='scr.strip';bl_label='从选面重建卡线面带';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        try:
            work=context.object;check_work(work)
            if context.mode!='EDIT_MESH':raise ValueError('在编辑模式选择一个有两条闭合边界的连续面带')
            work.update_from_editmode()
            selected=[p.index for p in work.data.polygons if p.select]
            options=settings(context)
            bm=bmesh.from_edit_mesh(work.data)
            layer=bm.verts.layers.int.get('scr_anchor')
            if layer:
                pairs={}
                for v in bm.verts:
                    if v[layer]>0:pairs.setdefault(v[layer],[]).append(v.index)
                if any(len(pair)!=2 for pair in pairs.values()):raise ValueError('每个锚点组必须恰好有两个顶点')
                if pairs:options['strip_anchor_pairs']=[pairs[key] for key in sorted(pairs)]
            build=profile_strip.build_profile_strip if options['strip_path']=='PROFILE' else reconstruct.build_strip
            mesh,report=build(work.data,selected,options)
            reference=reconstruct.selected_mesh(work.data,selected)
            bpy.ops.object.mode_set(mode='OBJECT')
            _,status=_new_result(context,work,mesh,report,role='STRIP',reference=reference)
            if status=='released':self.report({'INFO'},'原面带已手工修改，已保留并另建')
            return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_anchor_suggestion(bpy.types.Operator):
    bl_idname='scr.anchor_suggestion';bl_label='包边锚点建议';bl_options={'REGISTER','UNDO'}
    action:EnumProperty(items=[('PROPOSE','预览锚点建议','仅生成连线，不确认对应'),('ADOPT','采用当前建议','检查连线后采用；会替换当前锚点')])
    def execute(self,context):
        try:
            work=context.object;check_work(work)
            if context.mode!='EDIT_MESH':raise ValueError('请在编辑模式选择完整的双闭环面带')
            work.update_from_editmode()
            selected=[p.index for p in work.data.polygons if p.select]
            if self.action=='PROPOSE':
                proposal=reconstruct.propose_strip_anchors(work.data,selected,settings(context))
                proposal.update(signature=analysis.mesh_signature(work.data),selected_faces=selected)
                work['SCR_AnchorSuggestion']=json.dumps(proposal)
                pairs=proposal['anchor_pairs'];ids=sorted({v for pair in pairs for v in pair})
                mapping={v:i for i,v in enumerate(ids)}
                source=work.scr_state.source
                mesh=bpy.data.meshes.new(source.name+'_SCR_AnchorSuggestionLines')
                mesh.from_pydata([work.data.vertices[v].co[:] for v in ids],[(mapping[a],mapping[b]) for a,b in pairs],[])
                preview,_=_output(context,source,'ANCHOR_PREVIEW',source.name+'_SCR_AnchorSuggestionPreview',mesh)
                preview.matrix_world=work.matrix_world.copy()
                preview.show_in_front=True;preview.hide_render=True
                preview['SCR_Status']='仅为锚点对应建议，连线不是重建几何'
                self.report({'INFO'},'%d 对锚点建议；先检查尖角、凹口和跨层再采用'%len(pairs))
            else:
                proposal=json.loads(work.get('SCR_AnchorSuggestion','{}'))
                if proposal.get('signature')!=analysis.mesh_signature(work.data) or proposal.get('selected_faces')!=selected:
                    raise ValueError('选区或网格与建议不一致，请重新预览锚点建议')
                pairs=proposal['anchor_pairs'];bm=bmesh.from_edit_mesh(work.data)
                bm.verts.ensure_lookup_table()
                layer=bm.verts.layers.int.get('scr_anchor') or bm.verts.layers.int.new('scr_anchor')
                for v in bm.verts:v[layer]=0
                for group,(a,b) in enumerate(pairs,1):bm.verts[a][layer]=group;bm.verts[b][layer]=group
                context.scene.scr_settings.strip_segments=max(context.scene.scr_settings.strip_segments,len(pairs))
                bmesh.update_edit_mesh(work.data,loop_triangles=False,destructive=False)
            return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_validate(bpy.types.Operator):
    bl_idname='scr.validate';bl_label='验证基础 / 细分误差'
    def execute(self,context):
        try:
            obj=context.object
            role='STRIP' if obj and obj.scr_state.role=='STRIP' else 'CANDIDATE'
            state=check_work(obj,role)
            if context.mode!='OBJECT':raise ValueError('请在物体模式验证')
            report=validation.compare_meshes(state.reference,obj.data,settings(context))
            _report(obj,report)
            self.report({'INFO'},'细分最大采样误差 %.3f%%；请继续三视图检查'%(report['subdivided']['max_relative']*100))
            return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_OT_preview(bpy.types.Operator):
    bl_idname='scr.preview';bl_label='开启 / 关闭细分预览';bl_options={'REGISTER','UNDO'}
    def execute(self,context):
        try:
            obj=context.object
            role='STRIP' if obj and obj.scr_state.role=='STRIP' else 'CANDIDATE'
            check_work(obj,role)
            modifier=next((m for m in obj.modifiers if m.type=='SUBSURF' and m.name=='SCR_FinitePreview'),None)
            if modifier is None:
                modifier=obj.modifiers.new('SCR_FinitePreview','SUBSURF')
                modifier.show_viewport=True
            else:modifier.show_viewport=not modifier.show_viewport
            modifier.levels=context.scene.scr_settings.subdivision
            modifier.render_levels=modifier.levels
            modifier.use_limit_surface=False;modifier.boundary_smooth='ALL'
            return {'FINISHED'}
        except ValueError as exc:self.report({'WARNING'},str(exc));return {'CANCELLED'}


class SCR_PT_panel(bpy.types.Panel):
    bl_label='卡线中模重建 · 实验版';bl_idname='SCR_PT_panel';bl_space_type='VIEW_3D';bl_region_type='UI';bl_category='卡线重建'
    def draw(self,context):
        layout=self.layout;p=context.scene.scr_settings
        layout.label(text='源高模保留；结果需检查')
        box=layout.box();box.label(text='五档形体 · 几何候选')
        for name in ('shape_middle_resolution','shape_middle_smoothing'):box.prop(p,name)
        row=box.row();row.prop(p,'shape_block_columns');row.prop(p,'shape_block_rows')
        for name in ('shape_near_ratio','shape_near_radius'):box.prop(p,name)
        box.operator('scr.shape_levels')
        box.operator('scr.shape_levels',text='只重建远中 · 连续四边面').only_far_mid=True
        row=box.row(align=True)
        for key,label in (('FAR','远'),('FAR_MID','远中'),('MIDDLE','中'),('NEAR','近'),('SOURCE','超近')):
            row.operator('scr.shape_view',text=label).level=key
        box.label(text='左原高模，右所选档；超近直接看原件')
        box=layout.box();box.label(text='同一高模 · 四尺度严格边界')
        for name in ('boundary_area_ratio','boundary_curvature_change','boundary_curvature_floor'):box.prop(p,name)
        for name in ('boundary_scale_far_mid','boundary_scale_middle','boundary_scale_near','smooth_min_area'):box.prop(p,name)
        box.label(text='远：全物件；其余：3×3×3邻格')
        box.operator('scr.smooth_groups')
        row=box.row(align=True)
        for key in multiscale_boundaries.LEVELS:row.operator('scr.boundary_view',text=multiscale_boundaries.LABELS[key]).level=key
        box.label(text='面积比与曲率差同时通过；不补夹角边')
        box.label(text='青线分隔，橙线绕漏；源几何相同')
        box=layout.box();box.label(text='1 · 结构识别')
        for name in ('analysis_rings','feature_angle','density_area_percent'):box.prop(p,name)
        box.label(text='边长尺度占比：%.1f%%'%(100-p.density_area_percent))
        for name in ('density_weight','curvature_ratio'):box.prop(p,name)
        box.label(text='边界以同一高模四尺度结果为准')
        box.operator('scr.analyze');box.prop(p,'view_mode');box.operator('scr.display')
        box=layout.box();box.label(text='2 · 编辑模式修正选区')
        for pair in ((('MERGE','合并选面'),('SPLIT','拆分选面')),(('LOCK','锁定选边'),('UNLOCK','解锁选边')),(('PROTECT','保护细节'),('UNPROTECT','解除保护'))):
            row=box.row()
            for action,label in pair:row.operator('scr.mark',text=label).action=action
        box.prop(p,'seed_group');row=box.row()
        row.operator('scr.mark',text='设为该组种子').action='SEED'
        row.operator('scr.mark',text='清除种子').action='CLEAR_SEED'
        box.operator('scr.partition')
        box.operator('scr.boundaries')
        box=layout.box();box.label(text='3 · 中模候选')
        box.prop(p,'method')
        for name in ('planar_angle',) if p.method=='CONSERVATIVE' else ('reverse_steps','fit_iterations'):box.prop(p,name)
        box.prop(p,'subdivision');box.prop(p,'tolerance');box.operator('scr.rebuild')
        box=layout.box();box.label(text='选区卡线面带（两条闭环）')
        box.prop(p,'strip_path')
        if p.strip_path=='PROFILE':box.prop(p,'base_tolerance')
        for name in ('strip_segments','strip_rows','support_spacing'):box.prop(p,name)
        row=box.row();row.operator('scr.anchor_suggestion',text='预览对应建议').action='PROPOSE'
        row.operator('scr.anchor_suggestion',text='采用建议').action='ADOPT'
        row=box.row();row.operator('scr.mark',text='配对选中两点').action='ANCHOR'
        row.operator('scr.mark',text='清除配对').action='CLEAR_ANCHOR'
        box.label(text='尖角 / 凹口：沿环顺序配对，至少三对')
        box.operator('scr.strip')
        layout.operator('scr.validate')
        layout.operator('scr.preview')
        if context.object and context.object.scr_state.role:
            layout.label(text=context.object.get('SCR_Status','候选'))
            layout.label(text='报告：文本编辑器中的 *_Report.json')


CLASSES=(SCR_Settings,SCR_State,SCR_OutputSlot,SCR_OT_shape_levels,SCR_OT_shape_view,SCR_OT_boundary_view,SCR_OT_smooth_groups,SCR_OT_analyze,SCR_OT_display,SCR_OT_mark,SCR_OT_partition,SCR_OT_boundaries,SCR_OT_turn_lines,SCR_OT_rebuild,SCR_OT_strip,SCR_OT_anchor_suggestion,SCR_OT_validate,SCR_OT_preview,SCR_PT_panel)


def register():
    for cls in CLASSES:bpy.utils.register_class(cls)
    bpy.types.Scene.scr_settings=PointerProperty(type=SCR_Settings)
    bpy.types.Scene.scr_outputs=CollectionProperty(type=SCR_OutputSlot)
    bpy.types.Object.scr_state=PointerProperty(type=SCR_State)


def unregister():
    if hasattr(bpy.types.Object,'scr_state'):del bpy.types.Object.scr_state
    if hasattr(bpy.types.Scene,'scr_outputs'):del bpy.types.Scene.scr_outputs
    if hasattr(bpy.types.Scene,'scr_settings'):del bpy.types.Scene.scr_settings
    for cls in reversed(CLASSES):bpy.utils.unregister_class(cls)
