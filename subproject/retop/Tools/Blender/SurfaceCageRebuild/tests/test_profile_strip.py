"""Curved cross-profile bands, run in an isolated Blender process."""
import importlib
import math
import pathlib
import sys
import unittest

import bpy
from mathutils import Matrix

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
from SurfaceCageRebuild.analysis import analyze, mesh_signature, size
from SurfaceCageRebuild.reconstruct import build_strip


def rolled_band(n=96, steps=32, sharp=False):
    # A U cross section has nearby endpoints but travels around an entire fold.
    profile = [(1.6 + .4*math.sin(math.pi*j/steps), .4*math.cos(math.pi*j/steps))
               for j in range(steps+1)]
    if sharp:
        profile = [(1.5+j/steps, .4) if j<=steps//2 else
                   (2., .4-(j-steps//2)/steps) for j in range(steps+1)]
    vertices = [(r*math.cos(2*math.pi*i/n), r*math.sin(2*math.pi*i/n), z)
                for r,z in profile for i in range(n)]
    faces = []
    for j in range(steps):
        for i in range(n):
            a=j*n+i; b=j*n+(i+1)%n; c=(j+1)*n+(i+1)%n; d=(j+1)*n+i
            faces.extend(((a,b,c),(a,c,d)))
    mesh = bpy.data.meshes.new('ProfileFixture')
    mesh.from_pydata(vertices, [], faces); mesh.update()
    return mesh


class ProfileStripTests(unittest.TestCase):
    def setUp(self):
        self.build = importlib.import_module('SurfaceCageRebuild.profile_strip').build_profile_strip

    def test_u_profile_preserves_fold_and_source_with_reduction(self):
        source = rolled_band(); signature = mesh_signature(source)
        selected = list(range(len(source.polygons)))
        with self.assertRaises(ValueError):
            build_strip(source, selected, {'strip_segments':32,'strip_rows':8})
        result, report = self.build(source, selected, {'strip_segments':32,'strip_rows':8,
                                                       'subdivision':1,'tolerance':.02})
        self.assertEqual(mesh_signature(source), signature)
        self.assertEqual(report['boundary_loops'], 2)
        self.assertEqual(analyze(result,{})['health']['boundary_edges'],64)
        self.assertLess(len(result.polygons)*2,len(source.polygons)//2)
        self.assertGreater(max(math.hypot(v.co.x,v.co.y) for v in result.vertices),1.98)
        self.assertGreater(report['local_normal_dot_min'],.5)
        self.assertLess(report['comparison']['base']['max_relative'],.02)
        self.assertLess(report['comparison']['subdivided']['max_relative'],.02)
        self.assertIn('未',report['self_intersections'])

    def test_sharp_sidewall_has_turn_support_rows_and_fixed_anchors(self):
        source = rolled_band(sharp=True)
        pairs = [[i,32*96+i] for i in (0,24,48,72)]
        result,report = self.build(source,list(range(len(source.polygons))),{
            'strip_segments':32,'strip_rows':6,'strip_anchor_pairs':pairs,'subdivision':1,'tolerance':.02})
        self.assertGreater(len(report['turn_parameters']),0)
        for pair in pairs:
            for source_id in pair:
                self.assertLess(min((v.co-source.vertices[source_id].co).length for v in result.vertices),1e-6)
        self.assertLess(report['comparison']['subdivided']['max_relative'],.02)

    def test_rigid_transform_does_not_change_row_count(self):
        source = rolled_band(n=48,steps=16)
        settings={'strip_segments':24,'strip_rows':8,'subdivision':1,'tolerance':.03}
        first,report = self.build(source,list(range(len(source.polygons))),settings)
        first_error = report['comparison']['base']['max_relative']*size(source)
        source.transform(Matrix.Rotation(.63,4,'Y') @ Matrix.Scale(7,4))
        second,transformed = self.build(source,list(range(len(source.polygons))),settings)
        self.assertEqual(len(first.polygons),len(second.polygons))
        # Existing reports normalize by world AABB diagonal, which changes on
        # rotation; compare actual distances after reversing the known scale.
        self.assertAlmostEqual(first_error,
                               transformed['comparison']['base']['max_relative']*size(source)/7,places=4)

    def test_failed_acceptance_removes_all_temporary_meshes(self):
        source=rolled_band(n=48,steps=16)
        before=set(bpy.data.meshes.keys()); signature=mesh_signature(source)
        with self.assertRaises(ValueError):
            self.build(source,list(range(len(source.polygons))),{
                'strip_segments':12,'strip_rows':4,'tolerance':1e-7,'subdivision':1})
        self.assertEqual(before,set(bpy.data.meshes.keys()))
        self.assertEqual(signature,mesh_signature(source))

    def test_excessive_subdivision_is_rejected_before_allocating_output(self):
        source=rolled_band(n=24,steps=8);before=set(bpy.data.meshes.keys())
        with self.assertRaisesRegex(ValueError,'细分'):
            self.build(source,list(range(len(source.polygons))),{'subdivision':9})
        self.assertEqual(before,set(bpy.data.meshes.keys()))

    def test_mixed_source_is_triangulated_only_in_working_bmesh(self):
        triangulated=rolled_band(n=48,steps=16)
        # Restore one original quad among the triangles.
        faces=[tuple(p.vertices) for p in triangulated.polygons]
        first,second=faces[:2]
        faces[:2]=[(first[0],first[1],first[2],second[2])]
        source=bpy.data.meshes.new('MixedProfile')
        source.from_pydata([v.co[:] for v in triangulated.vertices],[],faces);source.update()
        signature=mesh_signature(source)
        result,report=self.build(source,list(range(len(source.polygons))),{
            'strip_segments':24,'strip_rows':8,'subdivision':1,'tolerance':.03,'base_tolerance':.025})
        self.assertEqual(signature,mesh_signature(source))
        self.assertEqual(len(source.polygons),report['source_faces'])
        self.assertEqual(len(source.polygons)+1,report['source_triangles'])
        self.assertTrue(all(0<=i<len(source.polygons) for i in report['projection_source_faces']))
        self.assertEqual(report['base_tolerance'],.025)
        self.assertEqual(report['subdivided_tolerance'],.03)

    def test_invalid_error_budgets_cannot_disable_acceptance(self):
        source=rolled_band(n=24,steps=8)
        before=set(bpy.data.meshes.keys())
        for key in ('base_tolerance','tolerance'):
            for value in (float('nan'),float('inf'),0.,-.01):
                with self.subTest(key=key,value=value):
                    with self.assertRaisesRegex(ValueError,'容差'):
                        self.build(source,list(range(len(source.polygons))),{'tolerance':.2,key:value})
                    self.assertEqual(before,set(bpy.data.meshes.keys()))


if __name__ == '__main__':
    result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        sys.exit(1)
