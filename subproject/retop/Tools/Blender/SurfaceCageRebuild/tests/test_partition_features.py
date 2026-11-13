"""Regression cases for structural evidence and constrained seed partitioning."""
import unittest
import math
import statistics
import bpy
from mathutils import Matrix
from SurfaceCageRebuild import analysis


def grid(xs, profile):
    vs = [(x, y, z) for x, z in profile for y in xs]
    n = len(xs)
    fs = []
    for j in range(len(profile)-1):
        for i in range(n-1):
            a = j*n+i
            fs.extend([(a,a+1,a+n+1),(a,a+n+1,a+n)])
    m = bpy.data.meshes.new('PartitionFixture')
    m.from_pydata(vs, [], fs); m.update()
    return m


class PartitionTests(unittest.TestCase):
    def test_density_scale_endpoints_and_legacy_half_mix(self):
        m=grid([0,.03,.2,1],[(0,0),(.1,0),(.7,0),(1,0)])
        signature=analysis.mesh_signature(m)
        edge_lengths=[[] for _ in m.vertices]
        for edge in m.edges:
            a,b=edge.vertices
            length=(m.vertices[a].co-m.vertices[b].co).length
            edge_lengths[a].append(length);edge_lengths[b].append(length)
        medians=[statistics.median(values) for values in edge_lengths]
        for percent in (0,25,50,100):
            result=analysis.analyze(m,{'analysis_rings':0,'density_area_percent':percent})
            self.assertEqual(result['density_scale_mix']['area_percent'],percent)
            self.assertEqual(result['density_scale_mix']['edge_percent'],100-percent)
            for face,actual in zip(m.polygons,result['spacing']):
                area=math.sqrt(face.area)
                edge=statistics.median(medians[i] for i in face.vertices)
                expected=area**(percent/100)*edge**(1-percent/100)/analysis.size(m)
                self.assertAlmostEqual(actual,expected,places=6)
        self.assertEqual(analysis.mesh_signature(m),signature)

    def test_density_defaults_to_area_and_rejects_invalid_mix(self):
        m=grid([0,.1,1],[(0,0),(.2,0),(1,0)])
        self.assertEqual(analysis.analyze(m,{})['spacing'],
                         analysis.analyze(m,{'density_area_percent':100})['spacing'])
        for value in (-1,101,float('nan'),float('inf')):
            with self.assertRaisesRegex(ValueError,'占比'):
                analysis.analyze(m,{'density_area_percent':value})

    def test_density_mix_panel_setting_is_passed_to_analysis(self):
        import SurfaceCageRebuild as addon
        addon.register()
        try:
            prop=bpy.context.scene.scr_settings
            self.assertEqual(prop.density_area_percent,100)
            prop.density_area_percent=25
            result=analysis.analyze(grid([0,.1,1],[(0,0),(.2,0),(1,0)]),addon.settings(bpy.context))
            self.assertEqual(result['density_scale_mix']['area_percent'],25)
        finally:
            addon.unregister()

    def test_dense_plane_is_not_a_turn_band(self):
        m = grid([0,.01,.02,.1,.5,1],[(0,0),(.01,0),(.02,0),(.5,0),(1,0)])
        r = analysis.analyze(m,{})
        self.assertEqual(r['regions_count'],1)
        self.assertLess(max(r['curvature']),1e-4)

    def test_smooth_narrow_bend_separates_broad_faces(self):
        profile = [(-1,0),(-.5,0),(0,0)]
        profile += [(.1*math.sin(t*math.pi/16), .1*(1-math.cos(t*math.pi/16))) for t in range(1,9)]
        profile += [(.1,.6),(.1,1.1)]
        m = grid([0,.25,.5,.75,1],profile)
        r = analysis.analyze(m,{})
        self.assertNotEqual(r['regions'][0], r['regions'][-1])
        self.assertTrue(any(r['turn_band']))
        sig = analysis.mesh_signature(m)
        m.transform(Matrix.Rotation(.71,4,'Y') @ Matrix.Scale(19,4))
        q = analysis.analyze(m,{})
        self.assertEqual(r['turn_band'],q['turn_band'])

    def test_seed_groups_compete_without_changing_mesh(self):
        m = grid([0,.25,.5,.75,1],[(0,0),(.25,0),(.5,0),(.75,0),(1,0)])
        seed = m.attributes.new('scr_seed','INT','FACE')
        seed.data[0].value=4;seed.data[-1].value=9
        sig=analysis.mesh_signature(m)
        r = analysis.analyze(m,{})
        self.assertEqual(r['seed_labels'][0],4)
        self.assertEqual(r['seed_labels'][-1],9)
        self.assertEqual(set(r['seed_labels']),{4,9})
        self.assertTrue(r['partition_requires_confirmation'])
        self.assertEqual(analysis.mesh_signature(m),sig)

    def test_locked_barrier_leaves_unseeded_component_unresolved(self):
        m = grid([0,.25,.5,.75,1],[(0,0),(.25,0),(.5,0),(.75,0),(1,0)])
        seed=m.attributes.new('scr_seed','INT','FACE');seed.data[0].value=1
        lock=m.attributes.new('scr_locked','INT','EDGE')
        for e in m.edges:
            if all(abs(m.vertices[v].co.x-.5)<1e-6 for v in e.vertices):lock.data[e.index].value=1
        r=analysis.analyze(m,{})
        self.assertEqual(r['seed_labels'][0],1)
        self.assertEqual(r['seed_labels'][-1],0)
        self.assertIn(len(m.polygons)-1,r['unresolved_faces'])

    def test_uniform_cylinder_is_not_split_by_accumulated_turn(self):
        profile=[(math.sin(i*math.pi/32),math.cos(i*math.pi/32)) for i in range(33)]
        m=grid([0,.25,.5,.75,1],profile)
        r=analysis.analyze(m,{})
        self.assertFalse(any(r['turn_band']))
        self.assertEqual(r['regions_count'],1)

    def test_turn_band_is_invariant_near_absolute_curvature_floor(self):
        radius=.3
        profile=[(-1,0),(-.5,0),(0,0)]
        profile += [(radius*math.sin(t*math.pi/16),radius*(1-math.cos(t*math.pi/16))) for t in range(1,9)]
        profile += [(radius,radius+.5),(radius,radius+1)]
        m=grid([0,.25,.5,.75,1],profile)
        first=analysis.analyze(m,{})
        m.transform(Matrix.Rotation(math.pi/4,4,'X'))
        second=analysis.analyze(m,{})
        self.assertEqual(first['turn_band'],second['turn_band'])
