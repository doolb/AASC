"""Four windows, one source, mandatory area AND curvature, no hidden bypass."""
import math,unittest
from unittest.mock import patch
import bpy
from mathutils import Matrix,Quaternion,Vector
from SurfaceCageRebuild import multiscale_boundaries as detector,analysis,shape_levels,cell_network
from test_turn_lines import rounded_fold
from test_partition_features import grid
from test_smooth_groups import cube_mesh,state


class FourScaleBoundaryTests(unittest.TestCase):
    def setUp(self):self.meshes=[]
    def keep(self,mesh):self.meshes.append(mesh);return mesh
    def tearDown(self):
        for mesh in self.meshes:
            if mesh.users==0:bpy.data.meshes.remove(mesh)
    def test_one_source_four_windows_never_reads_candidate_models_or_relief(self):
        mesh=self.keep(rounded_fold());before=state(mesh)
        with patch.object(shape_levels,'build_levels',side_effect=AssertionError('candidate models forbidden')),patch.object(cell_network,'relief_cells',side_effect=AssertionError('relief forbidden')):
            r=detector.detect_four_boundaries(mesh,{'turn_min_length':0})
        self.assertEqual(state(mesh),before)
        self.assertEqual(tuple(r['levels']),detector.LEVELS)
        self.assertEqual([d['window']['divisions'] for d in r['levels'].values()],[1,4,16,64])
        self.assertTrue(all(d['source_signature']==analysis.mesh_signature(mesh) for d in r['levels'].values()))
        self.assertFalse(r['candidate_meshes_used']);self.assertFalse(r['relief_regions_used'])
        self.assertEqual(r['standalone_angle_edges'],0)
    def test_every_accepted_edge_passes_both_tests_at_its_own_scale(self):
        r=detector.detect_four_boundaries(self.keep(rounded_fold()),{'turn_min_length':0})
        self.assertTrue(any(d['edge_indices'] for d in r['levels'].values()))
        for d in r['levels'].values():
            for metric in d['contrast_metrics'].values():
                self.assertGreaterEqual(metric['adjacent_area_ratio'],2)
                self.assertGreaterEqual(metric['area_ratio'],2)
                self.assertGreaterEqual(metric['curvature_change'],.5)
                self.assertGreaterEqual(max(metric['side_curvatures']),4)
                self.assertTrue(all(n>=3 for n in metric['side_faces']))
    def test_density_change_alone_never_produces_any_level_boundary(self):
        mesh=self.keep(grid([0,.01,.03,.3,1],[(0,0),(.01,0),(.2,0),(1,0)]))
        r=detector.detect_four_boundaries(mesh,{'turn_min_length':0})
        self.assertTrue(all(not d['edge_indices'] for d in r['levels'].values()))
    def test_same_curvature_density_jump_is_not_a_curvature_boundary(self):
        mesh=self.keep(grid([0,.01,.02,.1,.5,1],[(.1*math.sin(i*math.pi/48),.1*math.cos(i*math.pi/48)) for i in range(25)]))
        r=detector.detect_four_boundaries(mesh,{'turn_min_length':0})
        self.assertTrue(all(not d['edge_indices'] for d in r['levels'].values()))
        self.assertTrue(r['levels']['NEAR']['unresolved_edges'])
    def test_equal_area_hard_cube_has_no_angle_fallback(self):
        r=detector.detect_four_boundaries(self.keep(cube_mesh()),{'smooth_hard_angle':1,'feature_angle':5,'turn_min_length':0})
        self.assertTrue(all(not d['edge_indices'] for d in r['levels'].values()))
    def test_rigid_transform_and_scale_preserve_boundaries(self):
        mesh=self.keep(rounded_fold());first=detector.detect_four_boundaries(mesh,{'turn_min_length':0})
        mesh.transform(Matrix.Translation((4,-2,3))@Quaternion(Vector((1,2,3)),.61).to_matrix().to_4x4()@Matrix.Scale(2.7,4))
        second=detector.detect_four_boundaries(mesh,{'turn_min_length':0})
        self.assertEqual({k:v['edge_indices'] for k,v in first['levels'].items()},{k:v['edge_indices'] for k,v in second['levels'].items()})
    def test_invalid_windows_and_thresholds_do_not_leak_meshes(self):
        mesh=self.keep(cube_mesh());before={m.as_pointer() for m in bpy.data.meshes}
        for options in ({'boundary_area_ratio':1},{'boundary_curvature_change':float('nan')},{'boundary_scale_near':8},{'boundary_scale_far_mid':16}):
            with self.assertRaises(ValueError):detector.detect_four_boundaries(mesh,options)
        self.assertEqual(before,{m.as_pointer() for m in bpy.data.meshes})
    def test_failure_cleans_normalized_copies(self):
        mesh=self.keep(rounded_fold());before={m.as_pointer() for m in bpy.data.meshes}
        with patch.object(detector,'_side',side_effect=ValueError('forced side failure')):
            with self.assertRaisesRegex(ValueError,'forced side failure'):detector.detect_four_boundaries(mesh)
        self.assertEqual(before,{m.as_pointer() for m in bpy.data.meshes})
