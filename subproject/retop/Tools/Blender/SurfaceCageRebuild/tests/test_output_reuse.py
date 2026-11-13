"""Each tool output exists once per source and role; reruns replace its data."""
import importlib
import json
import unittest

import bpy

from SurfaceCageRebuild import analysis
from test_strip_features import circular_profile, notched_ring
from test_turn_lines import rounded_fold


class OutputReuseTests(unittest.TestCase):
    def setUp(self):
        self.addon=importlib.import_module('SurfaceCageRebuild')
        self.addon.register()
        self.source=bpy.data.objects.new('ReuseSource',rounded_fold())
        bpy.context.scene.collection.objects.link(self.source)
        self.addon._activate(self.source)

    def tearDown(self):
        if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
        for name in self.addon.SCR_Settings.__annotations__:
            bpy.context.scene.scr_settings.property_unset(name)
        self.addon.unregister()

    def outputs(self, role):
        return [o for o in bpy.data.objects if o.scr_state.source==self.source and o.scr_state.role==role]

    def run_from(self, obj, operator, **options):
        self.addon._activate(obj)
        self.assertEqual(operator(**options),{'FINISHED'})
        return bpy.context.object

    def test_repeated_analysis_reuses_object_and_carries_user_markings(self):
        work=self.run_from(self.source,bpy.ops.scr.analyze)
        attributes=work.data.attributes
        attributes['scr_seed'].data[0].value=3
        attributes['scr_locked'].data[1].value=1
        attributes['scr_protect'].data[2].value=1
        attributes['scr_anchor'].data[4].value=2
        self.assertIs(self.run_from(self.source,bpy.ops.scr.analyze),work)
        counts=(len(bpy.data.objects),len(bpy.data.meshes))
        self.assertIs(self.run_from(work,bpy.ops.scr.analyze),work)
        self.assertEqual((len(bpy.data.objects),len(bpy.data.meshes)),counts)
        self.assertEqual(self.outputs('ANALYSIS'),[work])
        attributes=work.data.attributes
        self.assertEqual([attributes[name].data[i].value for name,i in
                          (('scr_seed',0),('scr_locked',1),('scr_protect',2),('scr_anchor',4))],[3,1,1,2])
        self.addon.check_work(work)

    def test_manual_partition_copy_is_kept_when_reanalysing(self):
        manual=self.run_from(self.source,bpy.ops.scr.analyze)
        manual['SCR_ManualPartition']=True
        regions=[x.value for x in manual.data.attributes['scr_region'].data]
        fresh=self.run_from(self.source,bpy.ops.scr.analyze)
        self.assertIsNot(fresh,manual)
        self.assertEqual(regions,[x.value for x in manual.data.attributes['scr_region'].data])
        self.assertIs(self.run_from(self.source,bpy.ops.scr.analyze),fresh)
        self.assertEqual(len(self.outputs('ANALYSIS')),2)

    def test_turn_line_preview_replaces_surface_and_curve_data(self):
        work=self.run_from(self.source,bpy.ops.scr.analyze)
        preview=self.run_from(work,bpy.ops.scr.turn_lines)
        self.assertTrue(work.hide_get())
        bpy.context.scene.scr_settings.turn_method='CONTRAST'
        counts=(len(bpy.data.objects),len(bpy.data.meshes),len(bpy.data.curves))
        self.assertIs(self.run_from(preview,bpy.ops.scr.turn_lines),preview)
        self.assertIs(self.run_from(self.source,bpy.ops.scr.turn_lines),preview)
        self.assertEqual((len(bpy.data.objects),len(bpy.data.meshes),len(bpy.data.curves)),counts)
        self.assertEqual(self.outputs('TURN_REFERENCE'),[preview])
        lines=self.outputs('TURN_LINES')
        self.assertEqual(len(lines),1)
        self.assertIs(lines[0].parent,preview)
        bpy.context.view_layer.update()
        self.assertEqual(lines[0].matrix_world,preview.matrix_world)
        self.assertFalse(preview.hide_get())
        report=json.loads(bpy.data.texts[preview.scr_state.report_name].as_string())
        self.assertEqual(report['method'],'CONTRAST')

    def test_boundary_preview_is_reused(self):
        work=self.run_from(self.source,bpy.ops.scr.analyze)
        self.run_from(work,bpy.ops.scr.boundaries)
        counts=(len(bpy.data.objects),len(bpy.data.meshes))
        self.run_from(work,bpy.ops.scr.boundaries)
        self.assertEqual((len(bpy.data.objects),len(bpy.data.meshes)),counts)
        previews=self.outputs('BOUNDARY_PREVIEW')
        self.assertEqual(len(previews),1)
        self.assertEqual(previews[0].matrix_world,work.matrix_world)

    def test_candidate_is_reused_unless_user_edited_it(self):
        work=self.run_from(self.source,bpy.ops.scr.analyze)
        candidate=self.run_from(work,bpy.ops.scr.rebuild)
        counts=(len(bpy.data.objects),len(bpy.data.meshes))
        self.assertIs(self.run_from(work,bpy.ops.scr.rebuild),candidate)
        self.assertEqual((len(bpy.data.objects),len(bpy.data.meshes)),counts)
        candidate.data.vertices[0].co.z+=.01
        edited=analysis.mesh_signature(candidate.data)
        fresh=self.run_from(work,bpy.ops.scr.rebuild)
        self.assertIsNot(fresh,candidate)
        self.assertEqual(analysis.mesh_signature(candidate.data),edited)
        self.assertIs(self.run_from(work,bpy.ops.scr.rebuild),fresh)

    def test_strip_and_anchor_preview_are_reused(self):
        self.source.data=notched_ring()
        work=self.run_from(self.source,bpy.ops.scr.analyze)
        def edit_all():
            self.addon._activate(work)
            bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        for _ in range(2):
            edit_all()
            self.assertEqual(bpy.ops.scr.anchor_suggestion(action='PROPOSE'),{'FINISHED'})
            bpy.ops.object.mode_set(mode='OBJECT')
        self.assertEqual(len(self.outputs('ANCHOR_PREVIEW')),1)
        self.source.data=circular_profile([(1,0),(1.1,0),(1.2,0)],n=64)
        work=self.run_from(self.source,bpy.ops.scr.analyze)
        strips=[]
        for _ in range(3):
            edit_all()
            self.assertEqual(bpy.ops.scr.strip(),{'FINISHED'})
            strips.append(bpy.context.object)
            if len(strips)==2:counts=(len(bpy.data.objects),len(bpy.data.meshes))
        self.assertEqual((len(bpy.data.objects),len(bpy.data.meshes)),counts)
        self.assertIs(strips[0],strips[2])
        self.assertEqual(self.outputs('STRIP'),[strips[0]])
        self.assertEqual(len(strips[0].scr_state.reference.polygons),len(work.data.polygons))

    def test_user_rewired_vector_network_is_preserved(self):
        import bmesh
        options=bpy.context.scene.scr_settings;options.turn_method='NETWORK';options.network_path='PLANES'
        self.run_from(self.source,bpy.ops.scr.turn_lines)
        network=self.outputs('VECTOR_NETWORK')[0];self.assertTrue(network.data.edges)
        signature=analysis.mesh_signature(network.data)
        bm=bmesh.new();bm.from_mesh(network.data)
        for edge in list(bm.edges):bm.edges.remove(edge)
        bm.to_mesh(network.data);bm.free();network.data.update()
        self.assertEqual(signature,analysis.mesh_signature(network.data))
        self.assertTrue(self.addon._edited(network))
        self.run_from(self.source,bpy.ops.scr.turn_lines)
        self.assertFalse(network.data.edges)
        self.assertEqual(len(self.outputs('VECTOR_NETWORK')),2)
