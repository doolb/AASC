"""Geometry-derived region labels, real normals, leak diagnostics and reuse."""
import importlib
import math
import unittest
from unittest.mock import patch

import bpy
import bmesh
from mathutils import Matrix,Quaternion,Vector
from SurfaceCageRebuild import analysis,smooth_groups
from test_partition_features import grid
from test_turn_lines import rounded_fold


def cube_mesh():
    bm=bmesh.new();bmesh.ops.create_cube(bm,size=2)
    mesh=bpy.data.meshes.new('GenericCube');bm.to_mesh(mesh);bm.free();mesh.update()
    for f in mesh.polygons:f.use_smooth=True
    return mesh


def state(mesh):
    return (analysis.mesh_signature(mesh),[f.use_smooth for f in mesh.polygons],
            [e.use_edge_sharp for e in mesh.edges],mesh.has_custom_normals,
            [tuple(n.vector) for n in mesh.corner_normals])


class SmoothGroupTests(unittest.TestCase):
    def setUp(self):self.created=[]
    def tearDown(self):
        for mesh in self.created:
            if mesh.users==0:bpy.data.meshes.remove(mesh)
    def infer(self,mesh,options=None,edges=None):
        self.created.append(mesh)
        result,report=smooth_groups.infer_groups(mesh,options,edges);self.created.append(result)
        return result,report

    def test_cube_uses_geometric_boundaries_and_preserves_original(self):
        mesh=cube_mesh();before=state(mesh)
        preview,report=self.infer(mesh)
        self.assertEqual(state(mesh),before);self.assertEqual(report['groups_count'],1)
        self.assertEqual(report['native_smooth_regions'],1);self.assertEqual(report['actual_sharp_edges'],0)
        self.assertEqual(analysis.mesh_signature(preview),analysis.mesh_signature(mesh))
        self.assertFalse(report['images_used']);self.assertFalse(report['camera_used'])

    def test_custom_normals_do_not_mask_inferred_hard_edges(self):
        mesh=rounded_fold();mesh.normals_split_custom_set([(0.,0.,1.)]*len(mesh.loops));before=state(mesh)
        preview,report=self.infer(mesh,{'smooth_boundary_level':'FAR','turn_min_length':0})
        self.assertEqual(state(mesh),before)
        vectors=[n.vector.copy() for n in preview.corner_normals]
        by_vertex={}
        for loop,n in zip(preview.loops,vectors):by_vertex.setdefault(loop.vertex_index,[]).append(n)
        self.assertTrue(any(max(a.angle(b,0.) for a in ns for b in ns)>math.radians(1) for ns in by_vertex.values()))

    def test_flat_density_change_does_not_invent_groups(self):
        mesh=grid([0,.01,.03,.3,1],[(0,0),(.01,0),(.2,0),(1,0)])
        _,report=self.infer(mesh)
        self.assertEqual(report['groups_count'],1);self.assertFalse(report['confirmed_boundary_edges'])

    def test_closed_fold_sides_split_three_continuous_surfaces(self):
        preview,report=self.infer(rounded_fold(),{'smooth_boundary_level':'FAR','turn_min_length':0})
        self.assertEqual(report['groups_count'],3);self.assertFalse(report['leaked_boundary_edges'])
        self.assertEqual(sum(len(s['faces']) if isinstance(s['faces'],list) else s['faces'] for s in report['groups']),len(preview.polygons))

    def test_provided_edges_cannot_bypass_area_and_curvature(self):
        mesh=grid([0,1,2,3],[(0,0),(1,0),(2,0),(3,0)])
        bm=bmesh.new();bm.from_mesh(mesh);bm.edges.index_update();interior=next(e.index for e in bm.edges if len(e.link_faces)==2);bm.free()
        preview,report=self.infer(mesh,edges=[interior])
        self.assertEqual(report['groups_count'],1);self.assertEqual(report['rejected_requested_edges'],[interior])
        self.assertFalse(preview.edges[interior].use_edge_sharp)

    def test_verified_open_fragment_is_reported_not_silently_hardened(self):
        from SurfaceCageRebuild import multiscale_boundaries
        mesh=rounded_fold();r=multiscale_boundaries.detect_four_boundaries(mesh,{'turn_min_length':0})
        edge=r['levels']['MIDDLE']['edge_indices'][3]
        preview,report=self.infer(mesh,{'smooth_boundary_level':'MIDDLE','turn_min_length':0},edges=[edge])
        self.assertEqual(report['groups_count'],1);self.assertEqual(report['leaked_boundary_edges'],[edge])
        self.assertFalse(preview.edges[edge].use_edge_sharp)

    def test_existing_sharp_flags_are_not_geometry_evidence(self):
        mesh=grid([0,1,2],[(0,0),(1,0),(2,0)]);mesh.edges[0].use_edge_sharp=True
        _,report=self.infer(mesh)
        self.assertEqual(report['groups_count'],1);self.assertTrue(mesh.edges[0].use_edge_sharp)

    def test_regions_are_transform_stable(self):
        mesh=rounded_fold();self.created.append(mesh)
        one,r1=smooth_groups.infer_groups(mesh,{'turn_min_length':0});self.created.append(one)
        mesh.transform(Matrix.Translation((4,-3,2))@Quaternion(Vector((1,2,3)),.7).to_matrix().to_4x4()@Matrix.Scale(3.4,4))
        two,r2=smooth_groups.infer_groups(mesh,{'turn_min_length':0});self.created.append(two)
        self.assertEqual(r1['face_labels'],r2['face_labels']);self.assertEqual(r1['confirmed_boundary_edges'],r2['confirmed_boundary_edges'])

    def test_separate_shells_are_never_grouped_by_spatial_proximity(self):
        a=cube_mesh();b=cube_mesh();b.transform(Matrix.Translation((.1,0,0)))
        bm=bmesh.new();bm.from_mesh(a);bm.from_mesh(b);bm.to_mesh(a);bm.free();bpy.data.meshes.remove(b)
        _,report=self.infer(a,{'smooth_hard_angle':150},edges=[])
        self.assertEqual(report['groups_count'],2)

    def test_manual_labels_or_normals_change_preview_signature(self):
        preview,_=self.infer(cube_mesh());before=smooth_groups.preview_signature(preview)
        preview.attributes[smooth_groups.GROUP_ATTRIBUTE].data[0].value+=10
        self.assertNotEqual(before,smooth_groups.preview_signature(preview))

    def test_invalid_settings_or_indices_do_not_allocate_output(self):
        mesh=cube_mesh();self.created.append(mesh);count=len(bpy.data.meshes)
        for options in ({'boundary_curvature_change':float('nan')},{'smooth_min_area':-.1},{'smooth_group_method':'RELIEF'}):
            with self.assertRaises(ValueError):smooth_groups.infer_groups(mesh,options)
        with self.assertRaises(ValueError):smooth_groups.infer_groups(mesh,boundary_edges=[len(mesh.edges)])
        self.assertEqual(count,len(bpy.data.meshes))

    def test_four_group_previews_keep_exactly_the_same_source_geometry(self):
        mesh=rounded_fold();self.created.append(mesh)
        outputs,report=smooth_groups.infer_four_groups(mesh,{'turn_min_length':0})
        self.created.extend(outputs.values())
        self.assertEqual(set(outputs),{'FAR','FAR_MID','MIDDLE','NEAR'})
        self.assertTrue(all(analysis.mesh_signature(m)==analysis.mesh_signature(mesh) for m in outputs.values()))
        for data in report['levels'].values():
            self.assertFalse(data['geometric_crease_edges']);self.assertFalse(data['relief_regions_used'])



class SmoothGroupOperatorTests(unittest.TestCase):
    def setUp(self):
        self.addon=importlib.import_module('SurfaceCageRebuild');self.addon.register()
        self.source=bpy.data.objects.new('GenericSmoothSource',cube_mesh());bpy.context.scene.collection.objects.link(self.source);self.addon._activate(self.source)
    def tearDown(self):
        if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
        for name in self.addon.SCR_Settings.__annotations__:bpy.context.scene.scr_settings.property_unset(name)
        self.addon.unregister()
    def run_preview(self):
        self.assertEqual(bpy.ops.scr.smooth_groups(),{'FINISHED'});return bpy.context.object
    def test_reuses_preview_and_overlay_without_touching_source(self):
        before=state(self.source.data);first=self.run_preview();counts=(len(bpy.data.objects),len(bpy.data.meshes),len(bpy.data.curves))
        self.assertIs(self.run_preview(),first)
        self.assertEqual(counts,(len(bpy.data.objects),len(bpy.data.meshes),len(bpy.data.curves)))
        self.assertEqual(state(self.source.data),before)
        self.assertEqual(first.scr_state.role,'SMOOTH_GROUPS_NEAR');self.addon.check_work(first,'SMOOTH_GROUPS_NEAR')
    def test_manual_face_group_edit_keeps_old_result(self):
        old=self.run_preview();old.data.attributes[smooth_groups.GROUP_ATTRIBUTE].data[0].value=123
        new=self.run_preview();self.assertIsNot(old,new)
        self.assertEqual(old.data.attributes[smooth_groups.GROUP_ATTRIBUTE].data[0].value,123)
    def test_failure_does_not_replace_previous_output(self):
        old=self.run_preview();before=state(old.data);counts=(len(bpy.data.objects),len(bpy.data.meshes),len(bpy.data.curves))
        with patch.object(smooth_groups,'infer_four_groups',side_effect=ValueError('forced failure')):
            with self.assertRaisesRegex(RuntimeError,'forced failure'):bpy.ops.scr.smooth_groups()
        self.assertEqual(state(old.data),before)
        self.assertEqual(counts,(len(bpy.data.objects),len(bpy.data.meshes),len(bpy.data.curves)))
