"""Real geometry/transaction regression for the four derived shape levels."""
import importlib
import json
import math
import unittest
from unittest.mock import patch

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector

from SurfaceCageRebuild import analysis, shape_levels, validation


def curved_volume(n=32, rows=24):
    points=[]
    for side in range(2):
        for j in range(rows+1):
            y=-1+2*j/rows
            for i in range(n+1):
                x=-1.5+3*i/n
                broad=.28*(1-(x/1.5)**2)+.07*(1-y*y)
                detail=.065*math.sin(7*x)*math.sin(7*y) if side else 0
                points.append((x,y,broad+detail+(.25 if side else 0)))
    stride=n+1;layer=(n+1)*(rows+1);faces=[]
    for j in range(rows):
        for i in range(n):
            a=j*stride+i;b=a+1;c=b+stride;d=a+stride
            faces.extend([(a,d,c,b),(a+layer,b+layer,c+layer,d+layer)])
    boundary=list(range(n+1))+[j*stride+n for j in range(1,rows+1)]+[rows*stride+i for i in range(n-1,-1,-1)]+[j*stride for j in range(rows-1,0,-1)]
    for a,b in zip(boundary,boundary[1:]+boundary[:1]):faces.append((a,b,b+layer,a+layer))
    mesh=bpy.data.meshes.new('Controlled_bent_relief_shell');mesh.from_pydata(points,[],faces);mesh.update()
    bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free()
    return mesh


def data_ids():
    return {m.as_pointer() for m in bpy.data.meshes},{o.as_pointer() for o in bpy.data.objects}


class ShapeLevelTests(unittest.TestCase):
    def setUp(self):
        self.source=curved_volume();self.meshes={}

    def tearDown(self):
        for m in self.meshes.values():
            if m.users==0:bpy.data.meshes.remove(m)
        if self.source.users==0:bpy.data.meshes.remove(self.source)

    def build(self,options=None):
        self.meshes,self.report=shape_levels.build_levels(self.source,options)
        return self.meshes

    def test_four_real_levels_source_unchanged_and_no_temporary_objects(self):
        before=data_ids();signature=analysis.mesh_signature(self.source)
        self.build()
        self.assertEqual(set(self.meshes),set(shape_levels.LEVELS))
        self.assertEqual(analysis.mesh_signature(self.source),signature)
        after=data_ids();self.assertEqual(before[1],after[1])
        self.assertEqual(after[0]-before[0],{m.as_pointer() for m in self.meshes.values()})
        self.assertFalse(self.report['reference_images_used'])
        self.assertFalse(self.report['support_topology_restored'])
        self.assertTrue(all(not shape_levels.health(m)['bad_edges'] for m in self.meshes.values()))

    def test_far_is_single_enclosing_six_face_box(self):
        self.build();far=self.meshes['FAR']
        self.assertEqual((len(far.vertices),len(far.polygons)),(8,6))
        far.update()
        for face in far.polygons:
            self.assertLessEqual(max(face.normal.dot(v.co-face.center) for v in self.source.vertices),2e-5)

    def test_middle_removes_relief_but_keeps_arch(self):
        self.build()
        def heights(mesh):
            surface=validation.surface(mesh)
            return [surface.ray_cast(Vector((-1.2+2.4*i/40,.23,2)),Vector((0,0,-1)))[0].z for i in range(41)]
        source=heights(self.source);middle=heights(self.meshes['MIDDLE'])
        def highfreq(values):return sum((a-2*b+c)**2 for a,b,c in zip(values,values[1:],values[2:]))
        self.assertLess(highfreq(middle),highfreq(source)*.5)
        self.assertGreater(middle[20]-(middle[0]+middle[-1])*.5,.08)
        self.assertGreater(self.report['levels']['MIDDLE']['volume_ratio'],.5)

    def test_far_middle_has_one_continuous_quad_shell_and_shared_rim(self):
        self.build();mesh=self.meshes['FAR_MID'];info=shape_levels.health(mesh)
        self.assertEqual((info['shells'],info['euler']),(1,[2]))
        cage=self.report['shells'][0]['contour_cage']
        self.assertFalse(cage['independent_blocks']);self.assertTrue(all(len(f.vertices)==4 for f in mesh.polygons))
        self.assertEqual((len(mesh.vertices),len(mesh.polygons)),(70,68))
        self.assertGreater(min(cage['principal_dimension_ratios']),.94)
        self.assertTrue(.75<cage['thickness']['median_ratio']<1.25)
        bm=bmesh.new();bm.from_mesh(mesh)
        self.assertTrue(all(len(e.link_faces)==2 for e in bm.edges));bm.free()

    def test_near_keeps_relief_and_reduces_geometry(self):
        self.build()
        self.assertLess(shape_levels.health(self.meshes['NEAR'])['triangles'],shape_levels.health(self.source)['triangles']*.5)
        info=self.report['levels']['NEAR']['surface_samples']
        self.assertLess(info['max_relative'],.015)
        self.assertLess(info['max_relative'],self.report['levels']['MIDDLE']['surface_samples']['max_relative'])
        self.assertLessEqual(self.report['shells'][0]['near_filter']['maximum_move_relative'],.008001)

    def test_rotated_scaled_translated_geometry_matches(self):
        self.build();first=self.meshes;self.meshes={}
        transform=Matrix.Translation((5,-3,8))@Quaternion(Vector((1,2,3)),.83).to_matrix().to_4x4()@Matrix.Scale(2.7,4)
        self.source.transform(transform);self.source.update()
        try:
            self.build()
            for key,m in self.meshes.items():
                m.transform(transform.inverted());m.update()
                distance=validation._distance(first[key],m,analysis.size(first[key]),1200)
                self.assertLess(distance['max_relative'],.002,key)
        finally:
            for m in first.values():bpy.data.meshes.remove(m)

    def test_nearby_independent_shells_never_weld(self):
        bm=bmesh.new();bm.from_mesh(self.source)
        second=self.source.copy();second.transform(Matrix.Translation((0,0,.55)))
        bm.from_mesh(second);bm.to_mesh(self.source);bm.free();bpy.data.meshes.remove(second)
        self.build()
        for key in ('FAR_MID','MIDDLE','NEAR'):
            self.assertEqual(shape_levels.health(self.meshes[key])['shells'],2,key)

    def test_open_or_nonmanifold_refused_without_leaks(self):
        bm=bmesh.new();bm.from_mesh(self.source);bm.faces.ensure_lookup_table();bm.faces.remove(bm.faces[0]);bm.to_mesh(self.source);bm.free()
        before=data_ids()
        with self.assertRaisesRegex(ValueError,'闭合流形'):self.build()
        self.assertEqual(before,data_ids())

    def test_invalid_settings_refused_before_mutation(self):
        before=data_ids()
        for values in ({'shape_middle_resolution':0},{'shape_near_ratio':float('nan')},{'shape_block_rows':9}):
            with self.assertRaises(ValueError):self.build(values)
        self.assertEqual(before,data_ids())

    def test_failure_after_remesh_cleans_all_intermediates(self):
        before=data_ids();signature=analysis.mesh_signature(self.source)
        with patch.object(shape_levels,'_contour_cage',side_effect=ValueError('forced-stage-failure')):
            with self.assertRaisesRegex(ValueError,'forced-stage-failure'):self.build()
        self.assertEqual(before,data_ids());self.assertEqual(signature,analysis.mesh_signature(self.source))

    def test_selective_far_middle_does_not_build_other_stages(self):
        with patch.object(shape_levels,'_normals_filter',side_effect=AssertionError('unrequested near stage')):
            self.meshes,self.report=shape_levels.build_levels(self.source,levels=('FAR_MID',))
        self.assertEqual(set(self.meshes),{'FAR_MID'})

    def test_far_middle_preserves_a_real_outline_notch(self):
        for vertex in self.source.vertices:
            x,y,z=vertex.co
            vertex.co.x=x+.4*math.exp(-(y/.35)**2)*(1.5-x)/3
        self.source.update()
        self.meshes,self.report=shape_levels.build_levels(self.source,levels=('FAR_MID',))
        def left_hit(mesh):
            hit=validation.surface(mesh).ray_cast(Vector((-2,0,.25)),Vector((1,0,0)))[0]
            self.assertIsNotNone(hit)
            return hit.x
        self.assertAlmostEqual(left_hit(self.source),left_hit(self.meshes['FAR_MID']),delta=.12)

    def test_far_middle_actual_ray_thickness_stays_close(self):
        self.meshes,self.report=shape_levels.build_levels(self.source,levels=('FAR_MID',))
        trees=[validation.surface(m) for m in (self.source,self.meshes['FAR_MID'])]
        errors=[]
        for x in (-1.1,-.55,0,.55,1.1):
            for y in (-.65,-.2,.2,.65):
                thickness=[]
                for tree in trees:
                    top=tree.ray_cast(Vector((x,y,2)),Vector((0,0,-1)))[0]
                    bottom=tree.ray_cast(Vector((x,y,-2)),Vector((0,0,1)))[0]
                    self.assertIsNotNone(top);self.assertIsNotNone(bottom)
                    thickness.append(top.z-bottom.z)
                errors.append(abs(thickness[1]-thickness[0])/thickness[0])
        self.assertLess(sum(errors)/len(errors),.2)

    def test_invalid_level_subset_is_rejected_without_allocations(self):
        before=data_ids()
        for levels in ((),('SOURCE',),('FAR_MID','FAR_MID')):
            with self.assertRaises(ValueError):shape_levels.build_levels(self.source,levels=levels)
        self.assertEqual(before,data_ids())


class ShapeLevelOperatorTests(unittest.TestCase):
    def setUp(self):
        self.addon=importlib.import_module('SurfaceCageRebuild');self.addon.register()
        self.source=bpy.data.objects.new('Generic_source',curved_volume());bpy.context.scene.collection.objects.link(self.source);self.addon._activate(self.source)

    def tearDown(self):
        if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
        for name in self.addon.SCR_Settings.__annotations__:bpy.context.scene.scr_settings.property_unset(name)
        self.addon.unregister()

    def outputs(self):
        return {s.role:s.output for s in bpy.context.scene.scr_outputs if s.source==self.source}

    def generate(self):
        self.assertEqual(bpy.ops.scr.shape_levels(),{'FINISHED'});return self.outputs()

    def test_rerun_reuses_four_outputs_and_fifth_is_source(self):
        signature=analysis.mesh_signature(self.source.data);first=self.generate();counts=data_ids()
        self.assertEqual(len(first),4)
        second=self.generate();self.assertEqual(first,second)
        self.assertEqual(tuple(map(len,counts)),tuple(map(len,data_ids())))
        self.assertEqual(counts[1],data_ids()[1])
        for key in shape_levels.LEVELS:
            self.assertEqual(bpy.ops.scr.shape_view(level=key),{'FINISHED'})
            self.assertFalse(self.source.hide_get());self.assertIs(bpy.context.object,first['SHAPE_'+key])
            self.assertEqual(sum(not o.hide_get() for o in first.values()),1)
        self.assertEqual(bpy.ops.scr.shape_view(level='SOURCE'),{'FINISHED'})
        self.assertIs(bpy.context.object,self.source);self.assertTrue(all(o.hide_get() for o in first.values()))
        self.assertEqual(signature,analysis.mesh_signature(self.source.data))

    def test_hand_edited_candidate_and_its_report_are_kept(self):
        outputs=self.generate();edited=outputs['SHAPE_NEAR'];text=bpy.data.texts[edited.scr_state.report_name].as_string()
        edited.data.vertices[0].co.x+=.01;signature=analysis.mesh_signature(edited.data)
        self.addon._activate(edited);new=self.generate()
        self.assertIsNot(new['SHAPE_NEAR'],edited);self.assertEqual(signature,analysis.mesh_signature(edited.data))
        self.assertEqual(bpy.data.texts[edited.scr_state.report_name].as_string(),text)

    def test_failed_rerun_preserves_previous_outputs(self):
        outputs=self.generate();before=data_ids();signatures={k:analysis.mesh_signature(o.data) for k,o in outputs.items()}
        bpy.context.scene.scr_settings.shape_block_rows=1
        with patch.object(shape_levels,'build_levels',side_effect=ValueError('forced-failure')):
            with self.assertRaisesRegex(RuntimeError,'forced-failure'):bpy.ops.scr.shape_levels()
        self.assertEqual(outputs,self.outputs());self.assertEqual(before,data_ids())
        self.assertEqual(signatures,{k:analysis.mesh_signature(o.data) for k,o in outputs.items()})

    def test_native_source_modifier_and_transform_snapshot(self):
        self.source.matrix_world=Matrix.Translation((1,2,3))@Matrix.Scale(1.8,4)
        modifier=self.source.modifiers.new('input deformation','SMOOTH');modifier.factor=.15
        original=analysis.mesh_signature(self.source.data);self.generate()
        reference=self.outputs()['SHAPE_MIDDLE'].scr_state.reference
        self.assertNotEqual(analysis.mesh_signature(reference),original)
        self.assertEqual(original,analysis.mesh_signature(self.source.data));self.assertEqual(len(self.source.modifiers),1)
        self.addon.check_work(self.outputs()['SHAPE_MIDDLE'],'SHAPE_MIDDLE')

    def test_only_far_middle_preserves_other_meshes_reports_and_positions(self):
        first=self.generate()
        kept={key:(obj.data.as_pointer(),analysis.mesh_signature(obj.data),obj.matrix_world.copy(),bpy.data.texts[obj.scr_state.report_name].as_string())
              for key,obj in first.items() if key!='SHAPE_FAR_MID'}
        self.assertEqual(bpy.ops.scr.shape_levels(only_far_mid=True),{'FINISHED'})
        self.assertEqual(first,self.outputs())
        for key,record in kept.items():
            obj=first[key]
            self.assertEqual(record,(obj.data.as_pointer(),analysis.mesh_signature(obj.data),obj.matrix_world,bpy.data.texts[obj.scr_state.report_name].as_string()))
        self.assertIs(bpy.context.object,first['SHAPE_FAR_MID'])

    def test_edited_far_middle_is_preserved_on_selective_rebuild(self):
        first=self.generate();edited=first['SHAPE_FAR_MID'];edited.data.vertices[0].co.x+=.01
        signature=analysis.mesh_signature(edited.data)
        self.assertEqual(bpy.ops.scr.shape_levels(only_far_mid=True),{'FINISHED'})
        self.assertIsNot(self.outputs()['SHAPE_FAR_MID'],edited)
        self.assertEqual(signature,analysis.mesh_signature(edited.data))
