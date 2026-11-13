"""Isolated Blender tests for explicit, feature-preserving strip correspondence."""
import importlib
import itertools
import math
import pathlib
import sys
import unittest

import bpy
from mathutils import Matrix

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
reconstruct = importlib.import_module('SurfaceCageRebuild.reconstruct')
analysis = importlib.import_module('SurfaceCageRebuild.analysis')


def notched_ring():
    # Radial simple polygons include one concave notch; unequal lengths on the
    # two rings make global equal-arc sampling lose corresponding feature tips.
    inner = [(1.2,0,0),(.9,1.1,0),(-.3,.7,0),(-1.2,1,0),(-1.4,-.8,0),(.3,-1,0)]
    outer = [(1.8,0,0),(1.3,1.7,0),(-.45,1.05,0),(-1.8,1.5,0),(-2.1,-1.2,0),(.45,-1.5,0)]
    m = bpy.data.meshes.new('NotchedReference')
    n = len(inner)
    m.from_pydata(inner + outer, [], [(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)])
    m.update()
    return m


def circular_profile(profile, n=24):
    m = bpy.data.meshes.new('ProfileReference')
    vertices = [(r*math.cos(i*2*math.pi/n),r*math.sin(i*2*math.pi/n),z)
                for r,z in profile for i in range(n)]
    faces = [(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i)
             for j in range(len(profile)-1) for i in range(n)]
    m.from_pydata(vertices,[],faces); m.update()
    return m


def unequal_ring():
    # Add a collinear vertex on only the outer loop of a valid notched annulus.
    m = notched_ring()
    vertices = [v.co[:] for v in m.vertices]
    vertices.append(tuple((m.vertices[6].co+m.vertices[7].co)*.5))
    faces = [tuple(p.vertices) for p in m.polygons]
    faces[0] = (0,1,7,12,6)
    result = bpy.data.meshes.new('UnequalReference')
    result.from_pydata(vertices,[],faces);result.update()
    return result


class StripFeatureTests(unittest.TestCase):
    def test_each_anchor_pair_direction_is_independent_of_vertex_numbering(self):
        m=notched_ring()
        pairs=[(i,i+6) if i%2==0 else (i+6,i) for i in range(6)]
        result,report=reconstruct.build_strip(m,range(6),{'strip_anchor_pairs':pairs,'strip_segments':24})
        self.assertEqual({tuple(p) for p in report['anchor_pairs']},{(i,i+6) for i in range(6)})
        self.assertTrue(all(len(p.vertices)==4 for p in result.polygons))

    def test_anchor_proposal_covers_features_and_requires_confirmation(self):
        m = unequal_ring()
        signature = analysis.mesh_signature(m)
        proposal = reconstruct.propose_strip_anchors(m, range(6), {})
        self.assertTrue(proposal['requires_confirmation'])
        self.assertEqual({tuple(p) for p in proposal['anchor_pairs']}, {(i,i+6) for i in range(6)})
        self.assertEqual(analysis.mesh_signature(m), signature)
        result, _ = reconstruct.build_strip(m, range(6), {
            'strip_anchor_pairs': proposal['anchor_pairs'], 'strip_segments':24})
        self.assertTrue(all(len(p.vertices)==4 for p in result.polygons))

    def test_anchor_proposal_is_rotation_reflection_and_winding_independent(self):
        m = unequal_ring()
        first = reconstruct.propose_strip_anchors(m, range(6), {})['anchor_pairs']
        m.transform(Matrix.Rotation(.68,4,'Y') @ Matrix.Scale(-7.,4))
        second = reconstruct.propose_strip_anchors(m, range(6), {})['anchor_pairs']
        self.assertEqual(first,second)
        reversed_mesh = bpy.data.meshes.new('ReversedWinding')
        reversed_mesh.from_pydata([v.co[:] for v in m.vertices],[],[tuple(reversed(p.vertices)) for p in m.polygons])
        reversed_mesh.update()
        third = reconstruct.propose_strip_anchors(reversed_mesh, range(6), {})['anchor_pairs']
        self.assertEqual({tuple(pair) for pair in first},{tuple(pair) for pair in third})

    def test_anchor_dynamic_program_matches_exhaustive_cyclic_minimum(self):
        m = unequal_ring()
        proposal = reconstruct.propose_strip_anchors(m, range(6), {'strip_corner_angle':179})
        outer = [6,12,7,8,9,10,11]
        minimum = float('inf')
        for direction in (outer,list(reversed(outer))):
            for start in range(len(outer)):
                ring = direction[start:]+direction[:start]
                for subset in itertools.combinations(ring,6):
                    minimum = min(minimum,sum((m.vertices[i].co-m.vertices[j].co).length_squared for i,j in enumerate(subset)))
        actual = sum((m.vertices[i].co-m.vertices[j].co).length_squared for i,j in proposal['anchor_pairs'])
        self.assertAlmostEqual(actual,minimum,places=6)

    def test_anchor_proposal_never_skips_extra_significant_corner(self):
        m = unequal_ring()
        m.vertices[12].co.x += 2
        m.update()
        proposal = reconstruct.propose_strip_anchors(m, range(6), {})
        self.assertIn(12,{pair[1] for pair in proposal['anchor_pairs']})
        with self.assertRaisesRegex(ValueError, '角点|锚点'):
            reconstruct.propose_strip_anchors(m, range(6), {'strip_corner_angle':1})

    def test_anchor_proposal_respects_work_budget(self):
        m = unequal_ring()
        with self.assertRaisesRegex(ValueError, '预算|规模'):
            reconstruct.propose_strip_anchors(m, range(6), {'anchor_state_budget':1})

    def test_explicit_anchors_preserve_notch_and_corner_positions(self):
        m = notched_ring()
        signature = analysis.mesh_signature(m)
        anchors = [(i,i+6) for i in range(6)]
        result, report = reconstruct.build_strip(m, range(6), {
            'strip_anchor_pairs': anchors, 'strip_segments': 23, 'strip_rows': 4})
        for pair in anchors:
            for vertex_id in pair:
                self.assertLess(min((v.co-m.vertices[vertex_id].co).length for v in result.vertices), 1e-6)
        self.assertEqual(report['anchor_pairs'], [list(pair) for pair in anchors])
        self.assertEqual(analysis.mesh_signature(m), signature)

    def test_angular_ring_without_anchors_requires_confirmation(self):
        m = notched_ring()
        with self.assertRaisesRegex(ValueError, '锚点'):
            reconstruct.build_strip(m, range(6), {'strip_segments': 24})

    def test_twisted_anchor_order_is_rejected_and_leaves_no_candidate(self):
        m = notched_ring()
        before = set(bpy.data.meshes)
        with self.assertRaisesRegex(ValueError, '锚点'):
            reconstruct.build_strip(m, range(6), {
                'strip_anchor_pairs': [(0,6),(1,7),(2,9),(3,8),(4,10),(5,11)]})
        self.assertEqual(set(bpy.data.meshes), before)

    def test_duplicate_anchor_and_same_loop_pair_are_rejected(self):
        for anchors in ([(0,6),(0,7),(2,8)], [(0,1),(2,3),(4,5)]):
            m = notched_ring()
            with self.assertRaisesRegex(ValueError, '锚点'):
                reconstruct.build_strip(m, range(6), {'strip_anchor_pairs': anchors})

    def test_reversed_pair_columns_and_transform_preserve_features(self):
        m = notched_ring()
        m.transform(Matrix.Rotation(.73,4,'X') @ Matrix.Diagonal((-2.,.7,1.3,1.)))
        anchors = [(i+6,i) for i in (3,2,1,0,5,4)]
        result, _ = reconstruct.build_strip(m, range(6), {
            'strip_anchor_pairs': anchors, 'strip_segments': 23})
        for vertex in m.vertices:
            self.assertLess(min((v.co-vertex.co).length for v in result.vertices), 1e-5)

    def test_monotone_anchors_that_cross_real_hole_are_rejected(self):
        m = circular_profile([(1.,0),(1.2,0)])
        with self.assertRaisesRegex(ValueError, '跨孔|跨层|局部|翻转'):
            reconstruct.build_strip(m, range(len(m.polygons)), {
                'strip_anchor_pairs': [(0,32),(8,40),(16,24)], 'strip_segments':24,'strip_rows':2})

    def test_folded_selection_cannot_project_across_nearby_layers(self):
        m = circular_profile([(1.,0),(2.,0),(2.,.02),(1.05,.02)])
        with self.assertRaisesRegex(ValueError, '跨孔|跨层|局部|翻转'):
            reconstruct.build_strip(m, range(len(m.polygons)), {'strip_segments':24})


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
    if not result.wasSuccessful():
        sys.exit(1)
