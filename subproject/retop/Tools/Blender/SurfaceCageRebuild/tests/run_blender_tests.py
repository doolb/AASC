"""Run with blender --background --factory-startup --python this_file."""
import importlib
import json
import pathlib
import sys
import unittest

import bpy
import bmesh
from mathutils import Matrix

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
analysis = importlib.import_module('SurfaceCageRebuild.analysis')


def mesh(name, vertices, faces):
    result = bpy.data.meshes.new(name)
    result.from_pydata(vertices, [], faces)
    result.update()
    return result


def plane(reverse=False):
    vertices = [(x / 4, y / 4, 0) for y in range(5) for x in range(5)]
    faces = []
    for y in range(4):
        for x in range(4):
            a = y * 5 + x
            faces.extend([(a, a + 1, a + 5), (a + 1, a + 6, a + 5)] if reverse
                         else [(a, a + 1, a + 6), (a, a + 6, a + 5)])
    return mesh('Plane', vertices, faces)


class AnalysisTests(unittest.TestCase):
    def test_planar_diagonals_do_not_create_regions(self):
        for reverse in (False, True):
            m = plane(reverse)
            sig = analysis.mesh_signature(m)
            result = analysis.analyze(m, {})
            self.assertEqual(len(set(result['regions'])), 1)
            self.assertEqual(analysis.mesh_signature(m), sig)
            self.assertFalse(result['health']['nonmanifold_edges'])

    def test_sharp_fold_separates_regions(self):
        m = mesh('Fold', [(0,0,0),(1,0,0),(1,1,0),(0,1,0),(1,0,1),(1,1,1)],
                 [(0,1,2),(0,2,3),(1,4,5),(1,5,2)])
        r = analysis.analyze(m, {})
        self.assertEqual(len(set(r['regions'])), 2)

    def test_disconnected_sheets_stay_separate(self):
        m = mesh('Sheets', [(0,0,0),(1,0,0),(0,1,0),(0,0,.001),(1,0,.001),(0,1,.001)],
                 [(0,1,2),(3,4,5)])
        self.assertEqual(analysis.analyze(m, {})['health']['shells'], 2)

    def test_scale_rotation_invariance(self):
        m = plane()
        first = analysis.analyze(m, {})
        m.transform(Matrix.Rotation(.71,4,'X') @ Matrix.Scale(17,4))
        second = analysis.analyze(m, {})
        self.assertEqual(first['regions'], second['regions'])

    def test_degenerate_rejected(self):
        m = mesh('Degenerate', [(0,0,0),(1,0,0),(2,0,0)], [(0,1,2)])
        self.assertGreater(analysis.analyze(m, {})['health']['degenerate_faces'], 0)


class ReconstructionTests(unittest.TestCase):
    def setUp(self):
        self.reconstruct = importlib.import_module('SurfaceCageRebuild.reconstruct')
        self.validation = importlib.import_module('SurfaceCageRebuild.validation')

    def test_subdivided_cube_reduces_without_changing_source(self):
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=2)
        m = bpy.data.meshes.new('Cube'); bm.to_mesh(m); bm.free()
        high = self.validation.subdivided_mesh(m, 2)
        bm = bmesh.new(); bm.from_mesh(high)
        bmesh.ops.triangulate(bm, faces=list(bm.faces)); bm.to_mesh(high); bm.free()
        sig = analysis.mesh_signature(high)
        result, report = self.reconstruct.rebuild(high, {'method':'INVERSE','reverse_steps':1,'fit_iterations':16,'tolerance':.03,'subdivision':1})
        self.assertLess(len(result.polygons), len(high.polygons) // 2)
        self.assertEqual(analysis.mesh_signature(high), sig)
        self.assertEqual(analysis.analyze(result,{})['health']['boundary_edges'],0)
        self.assertLess(report['comparison']['subdivided']['max_relative'],.03)

    def test_annular_strip_has_two_open_rings(self):
        import math
        n=24
        verts=[(r*math.cos(i*2*math.pi/n),r*math.sin(i*2*math.pi/n),.15*r*r) for r in (1.,1.2) for i in range(n)]
        faces=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        m=mesh('Ring',verts,faces)
        result, report=self.reconstruct.build_strip(m,list(range(n)),{'strip_segments':16,'strip_rows':4})
        self.assertTrue(all(len(p.vertices)==4 for p in result.polygons))
        self.assertEqual(analysis.analyze(result,{})['health']['boundary_edges'],32)
        self.assertEqual(report['status'],'独立面带候选；未焊接源网格')

    def test_strip_rejects_disk(self):
        with self.assertRaises(ValueError):
            self.reconstruct.build_strip(plane(),list(range(32)),{})

    def test_source_candidate_comparison_detects_displacement(self):
        a=plane();b=a.copy()
        for v in b.vertices:v.co.z+=.5
        report=self.validation.compare_meshes(a,b,{'subdivision':0,'tolerance':.01})
        self.assertFalse(report['within_surface_tolerance'])

    def test_unsafe_nonmanifold_rejected(self):
        m=mesh('Unsafe',[(0,0,0),(1,0,0),(0,1,0),(0,-1,0),(0,0,1)],[(0,1,2),(1,0,3),(0,1,4)])
        with self.assertRaises(ValueError):self.reconstruct.rebuild(m,{})

    def test_fitting_matches_actual_finite_subdivision(self):
        from mathutils import Vector
        from mathutils.kdtree import KDTree
        bm=bmesh.new();bmesh.ops.create_cube(bm,size=2)
        m=bpy.data.meshes.new('StencilCube');bm.to_mesh(m);bm.free()
        for levels in (1,2):
            rows=self.reconstruct._stencils(m,levels)
            predicted=[sum((m.vertices[i].co*w for i,w in row.items()),Vector()) for row in rows]
            actual=self.validation.subdivided_mesh(m,levels)
            tree=KDTree(len(actual.vertices))
            for v in actual.vertices:tree.insert(v.co,v.index)
            tree.balance()
            self.assertLess(max(tree.find(v)[2] for v in predicted),1e-5)

    def test_filled_hole_fails_topology_check(self):
        import math
        n=12
        vs=[(r*math.cos(i*2*math.pi/n),r*math.sin(i*2*math.pi/n),0) for r in (.1,1) for i in range(n)]
        fs=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        a=mesh('Annulus',vs,fs);b=mesh('FilledAnnulus',vs,fs+[tuple(reversed(range(n)))])
        self.assertFalse(self.validation.compare_meshes(a,b,{'subdivision':0})['topology_basic_check'])

    def test_nonzero_crease_inverse_rejected(self):
        m=plane();attr=m.attributes.new('crease_edge','FLOAT','EDGE');attr.data[0].value=1
        with self.assertRaisesRegex(ValueError,'crease'):
            self.reconstruct.rebuild(m,{'method':'INVERSE'})


class AddonTests(unittest.TestCase):
    def setUp(self):
        self.addon=importlib.import_module('SurfaceCageRebuild')
        self.addon.register()
        self.obj=bpy.data.objects.new('TestSource',plane())
        bpy.context.scene.collection.objects.link(self.obj)
        bpy.context.view_layer.objects.active=self.obj
        for o in bpy.context.selected_objects:o.select_set(False)
        self.obj.select_set(True)

    def tearDown(self):
        if bpy.context.mode!='OBJECT':bpy.ops.object.mode_set(mode='OBJECT')
        self.addon.unregister()

    def test_analyze_source_unchanged_and_repeated_analysis(self):
        sig=analysis.mesh_signature(self.obj.data)
        self.assertEqual(bpy.ops.scr.analyze(),{'FINISHED'})
        first=bpy.context.object
        self.assertIs(first.scr_state.source,self.obj)
        self.assertEqual(analysis.mesh_signature(self.obj.data),sig)
        self.assertEqual(bpy.ops.scr.analyze(),{'FINISHED'})
        self.assertIs(first,bpy.context.object)

    def test_changed_source_invalidates_analysis(self):
        bpy.ops.scr.analyze();work=bpy.context.object
        self.obj.data.vertices[0].co.z+=.1
        with self.assertRaises(ValueError):self.addon.check_work(work)

    def test_edit_selection_can_protect_faces(self):
        bpy.ops.scr.analyze()
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        self.assertEqual(bpy.ops.scr.mark(action='PROTECT'),{'FINISHED'})
        bpy.ops.object.mode_set(mode='OBJECT')
        self.assertTrue(all(x.value for x in bpy.context.object.data.attributes['scr_protect'].data))

    def test_strip_validation_uses_selected_reference(self):
        import math
        n=24
        vs=[(r*math.cos(i*2*math.pi/n),r*math.sin(i*2*math.pi/n),0) for r in (1,1.2) for i in range(n)]
        fs=[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
        self.obj.data=mesh('StripSource',vs+[(10,0,0),(11,0,0),(10,1,0)],fs+[(48,49,50)])
        bpy.ops.scr.analyze();work=bpy.context.object
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='DESELECT')
        bm=bmesh.from_edit_mesh(work.data);bm.faces.ensure_lookup_table()
        for f in bm.faces:
            if f.index<n:f.select_set(True)
        bmesh.update_edit_mesh(work.data)
        self.assertEqual(bpy.ops.scr.strip(),{'FINISHED'})
        result=bpy.context.object
        self.assertEqual(len(result.scr_state.reference.polygons),n)
        self.assertEqual(bpy.ops.scr.validate(),{'FINISHED'})

    def test_seed_repartition_preserves_locks_and_reference(self):
        bpy.ops.scr.analyze();work=bpy.context.object
        reference=work.scr_state.reference;sig=analysis.mesh_signature(work.data)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT')
        bm=bmesh.from_edit_mesh(work.data);bm.faces.ensure_lookup_table()
        bm.faces[0].select_set(True);bmesh.update_edit_mesh(work.data)
        bpy.context.scene.scr_settings.seed_group=7
        self.assertEqual(bpy.ops.scr.mark(action='SEED'),{'FINISHED'})
        bpy.ops.object.mode_set(mode='OBJECT')
        work.data.attributes['scr_locked'].data[0].value=1
        self.assertEqual(bpy.ops.scr.partition(),{'FINISHED'})
        self.assertEqual(work.data.attributes['scr_seed'].data[0].value,7)
        self.assertEqual(work.data.attributes['scr_locked'].data[0].value,1)
        self.assertIs(work.scr_state.reference,reference)
        self.assertEqual(analysis.mesh_signature(work.data),sig)

    def test_anchor_pairs_can_be_marked_without_geometry_changes(self):
        bpy.ops.scr.analyze();work=bpy.context.object
        sig=analysis.mesh_signature(work.data)
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT')
        bm=bmesh.from_edit_mesh(work.data);bm.verts.ensure_lookup_table()
        bm.verts[0].select_set(True);bm.verts[-1].select_set(True)
        bmesh.update_edit_mesh(work.data)
        self.assertEqual(bpy.ops.scr.mark(action='ANCHOR'),{'FINISHED'})
        bpy.ops.object.mode_set(mode='OBJECT')
        values=[v.value for v in work.data.attributes['scr_anchor'].data]
        self.assertEqual(values[0],values[-1]);self.assertGreater(values[0],0)
        self.assertEqual(sum(v>0 for v in values),2)
        self.assertEqual(analysis.mesh_signature(work.data),sig)

    def test_repartition_does_not_silently_erase_manual_split(self):
        bpy.ops.scr.analyze();work=bpy.context.object
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='DESELECT')
        bm=bmesh.from_edit_mesh(work.data);bm.faces.ensure_lookup_table()
        bm.faces[0].select_set(True);bmesh.update_edit_mesh(work.data)
        self.assertEqual(bpy.ops.scr.mark(action='SPLIT'),{'FINISHED'})
        bpy.ops.object.mode_set(mode='OBJECT')
        before=[x.value for x in work.data.attributes['scr_region'].data]
        self.assertEqual(bpy.ops.scr.partition(),{'CANCELLED'})
        self.assertEqual(before,[x.value for x in work.data.attributes['scr_region'].data])

    def test_anchor_suggestion_requires_explicit_adoption(self):
        sys.path.insert(0,str(pathlib.Path(__file__).parent))
        from test_strip_features import notched_ring
        self.obj.data=notched_ring()
        bpy.ops.scr.analyze();work=bpy.context.object
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        self.assertEqual(bpy.ops.scr.anchor_suggestion(action='PROPOSE'),{'FINISHED'})
        bm=bmesh.from_edit_mesh(work.data);layer=bm.verts.layers.int['scr_anchor']
        self.assertFalse(any(v[layer] for v in bm.verts))
        self.assertEqual(bpy.ops.scr.anchor_suggestion(action='ADOPT'),{'FINISHED'})
        self.assertTrue(all(v[layer]>0 for v in bm.verts))

    def test_profile_path_can_be_run_from_panel_operator(self):
        sys.path.insert(0,str(pathlib.Path(__file__).parent))
        from test_strip_features import circular_profile
        self.obj.data=circular_profile([(1,0),(1.1,0),(1.2,0)],n=64)
        bpy.ops.scr.analyze();work=bpy.context.object
        bpy.context.scene.scr_settings.strip_path='PROFILE'
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        self.assertEqual(bpy.ops.scr.strip(),{'FINISHED'})
        self.assertEqual(bpy.context.object.scr_state.role,'STRIP')
        report=json.loads(bpy.data.texts[bpy.context.object.scr_state.report_name].as_string())
        self.assertIn('path_method',report)


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__])
    suite.addTests(unittest.defaultTestLoader.discover(str(pathlib.Path(__file__).parent), pattern='test_*.py'))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    print('SCR_TEST_RESULT', json.dumps({'run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)}))
    if not result.wasSuccessful():
        sys.exit(1)
