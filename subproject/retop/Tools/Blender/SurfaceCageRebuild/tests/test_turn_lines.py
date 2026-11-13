"""Turn-band boundaries must come from geometry, not old semantic labels."""
import importlib
import math
import unittest

import bpy
import bmesh
from mathutils import Matrix
from test_partition_features import grid
from SurfaceCageRebuild import analysis


def rounded_fold(uneven=False):
    radius=.04
    profile=[(-.6,0),(-.3,0),(0,0)]
    profile += [(radius*math.sin(i*math.pi/20),radius*(1-math.cos(i*math.pi/20))) for i in range(1,11)]
    profile += [(radius,.34),(radius,.64)]
    ys=[0,.03,.1,.2,.4,.7,.85,.96,1] if uneven else [i/16 for i in range(17)]
    return grid(ys,profile)


class TurnLineTests(unittest.TestCase):
    def setUp(self):
        self.module=importlib.import_module('SurfaceCageRebuild.turn_lines')

    def test_contrast_boundary_keeps_fold_sides_not_internal_turn_edges(self):
        m=rounded_fold();signature=analysis.mesh_signature(m)
        r=self.module.detect_turn_lines(m,{'turn_method':'CONTRAST','turn_min_length':0})
        self.assertEqual(len(r['lines']),2)
        self.assertTrue(all(line['length']>.99 for line in r['lines']))
        for i in r['edge_indices']:
            for v in m.edges[i].vertices:
                p=m.vertices[v].co
                self.assertTrue(abs(p.z)<1e-6 or abs(p.z-.04)<1e-6)
        self.assertEqual(analysis.mesh_signature(m),signature)
        m.transform(Matrix.Rotation(.71,4,'Y')@Matrix.Scale(-7,4))
        transformed=self.module.detect_turn_lines(m,{'turn_method':'CONTRAST','turn_min_length':0})
        self.assertEqual(r['edge_indices'],transformed['edge_indices'])

    def test_area_change_alone_is_not_a_boundary(self):
        m=grid([0,.01,.02,.3,1],[(0,0),(.01,0),(.2,0),(1,0)])
        self.assertEqual(self.module.detect_turn_lines(m,{'turn_method':'CONTRAST'})['edge_indices'],[])

    def test_same_curvature_density_jump_is_not_a_boundary(self):
        m=grid([0,.01,.02,.1,.5,1],[(.1*math.sin(i*math.pi/48),.1*math.cos(i*math.pi/48)) for i in range(25)])
        r=self.module.detect_turn_lines(m,{'turn_method':'CONTRAST','turn_min_length':0})
        self.assertEqual(r['edge_indices'],[])

    def test_contrast_parameters_reject_invalid_values(self):
        for key,value in [('boundary_area_ratio',1),('boundary_curvature_change',float('nan')),
                          ('boundary_curvature_floor',0)]:
            with self.assertRaises(ValueError):
                self.module.detect_turn_lines(rounded_fold(),{'turn_method':'CONTRAST',key:value})

    def test_surface_fit_recovers_bend_axis_for_both_diagonals(self):
        for reverse in (False,True):
            vertices=[(x*.1,y*.1,2*(x*.1)**2) for y in range(-4,5) for x in range(-4,5)]
            faces=[]
            for y in range(8):
                for x in range(8):
                    a=y*9+x
                    faces.extend([(a,a+1,a+9),(a+1,a+10,a+9)] if reverse else
                                 [(a,a+1,a+10),(a,a+10,a+9)])
            m=bpy.data.meshes.new('QuadraticSurface');m.from_pydata(vertices,[],faces);m.update()
            bm=bmesh.new()
            try:
                bm.from_mesh(m);bm.normal_update();bm.verts.ensure_lookup_table()
                fit=self.module._fit_surface_axis(bm.verts[40],2)
                self.assertIsNotNone(fit)
                self.assertGreater(abs(fit['axis'].x),.99)
                self.assertLess(fit['residual'],1e-4)
                edges={e.index for e in bm.verts[40].link_edges}
                kept,rejected,uncertain=self.module._filter_surface_directions(bm,edges,set(),35)
                transverse={e.index for e in bm.verts[40].link_edges
                            if abs(e.other_vert(bm.verts[40]).co.x)>.09}
                self.assertTrue(transverse<=set(rejected))
                self.assertTrue(kept)
                # Explicit hard corners are never removed by a smooth fit.
                protected=self.module._filter_surface_directions(bm,edges,edges,35)
                self.assertEqual(protected[0],edges)
            finally:bm.free()

    def test_isotropic_patch_has_no_unique_structure_direction(self):
        m=grid([i*.1 for i in range(-4,5)],[(i*.1,0) for i in range(-4,5)])
        for v in m.vertices:v.co.z=v.co.x**2+v.co.y**2
        m.update();bm=bmesh.new()
        try:
            bm.from_mesh(m);bm.normal_update();bm.verts.ensure_lookup_table()
            self.assertIsNone(self.module._fit_surface_axis(bm.verts[40],2))
        finally:bm.free()

    def test_surface_fit_handles_tilted_initial_normal(self):
        from mathutils import Vector
        m=grid([i*.01 for i in range(-4,5)],[(i*.01,2*(i*.01)**2) for i in range(-4,5)])
        bm=bmesh.new()
        try:
            bm.from_mesh(m);bm.normal_update();bm.verts.ensure_lookup_table()
            vertex=bm.verts[40]
            vertex.normal=Vector((.6,0,.8))
            fit=self.module._fit_surface_axis(vertex,2)
            self.assertIsNotNone(fit)
            self.assertGreater(abs(fit['axis'].x),.98)
            self.assertLess(abs(abs(fit['curvature'])-4),.3)
        finally:bm.free()

    def test_nonquadratic_uneven_patch_direction_survives_retriangulation(self):
        xs=[-.4,-.3,-.12,-.04,0,.08,.2,.27,.4]
        ys=[-.4,-.22,-.1,-.04,0,.06,.2,.3,.4]
        axes=[]
        for reverse in (False,True):
            vertices=[(x,y,.08*math.cos(4*x)+.005*math.sin(3*y)+.02*x*y) for y in ys for x in xs]
            faces=[]
            for y in range(8):
                for x in range(8):
                    a=y*9+x
                    faces.extend([(a,a+1,a+9),(a+1,a+10,a+9)] if reverse else
                                 [(a,a+1,a+10),(a,a+10,a+9)])
            mesh=bpy.data.meshes.new('UnevenWave');mesh.from_pydata(vertices,[],faces);mesh.update()
            bm=bmesh.new()
            try:
                bm.from_mesh(mesh);bm.normal_update();bm.verts.ensure_lookup_table()
                fit=self.module._fit_surface_axis(bm.verts[40],2)
                self.assertIsNotNone(fit);axes.append(fit['axis'])
                self.assertGreater(abs(fit['axis'].x),.98)
            finally:bm.free()
        self.assertGreater(abs(axes[0].dot(axes[1])),.99)

    def test_round_fold_produces_two_long_open_boundaries(self):
        m=rounded_fold();signature=analysis.mesh_signature(m)
        r=self.module.detect_turn_lines(m,{'turn_method':'BAND'})
        long=[line for line in r['lines'] if line['length']>.8]
        self.assertEqual(len(long),2)
        self.assertTrue(all(not line['closed'] for line in long))
        self.assertEqual(r['branch_vertices'],[])
        self.assertEqual(r['strong_edge_indices'],[])
        self.assertEqual(r['weak_edge_indices'],[])
        self.assertFalse(r['parameters']['adaptive_area']['enabled'])
        self.assertEqual(analysis.mesh_signature(m),signature)

    def test_dense_plane_does_not_invent_a_turn(self):
        m=grid([0,.001,.002,.05,.3,1],[(0,0),(.001,0),(.1,0),(1,0)])
        self.assertEqual(self.module.detect_turn_lines(m,{})['lines'],[])

    def test_uniform_broad_arc_does_not_become_a_seam(self):
        m=grid([i/8 for i in range(9)],[(math.sin(i*math.pi/32),math.cos(i*math.pi/32)) for i in range(33)])
        self.assertEqual(self.module.detect_turn_lines(m,{})['lines'],[])

    def test_density_variation_does_not_break_round_fold(self):
        r=self.module.detect_turn_lines(rounded_fold(True),{'turn_method':'BAND'})
        self.assertEqual(len([line for line in r['lines'] if line['length']>.8]),2)

    def test_direct_edges_stay_inside_narrow_fold_not_adjacent_large_triangles(self):
        m=rounded_fold(True)
        result=self.module.detect_turn_lines(m,{})
        self.assertEqual(result['method'],'EDGE')
        self.assertGreater(len(result['edge_indices']),0)
        for edge_id in result['edge_indices']:
            for vertex_id in m.edges[edge_id].vertices:
                p=m.vertices[vertex_id].co
                self.assertGreaterEqual(p.x,-1e-6)
                self.assertLessEqual(p.z,.040001)

    def test_invalid_turn_method_rejected(self):
        with self.assertRaises(ValueError):
            self.module.detect_turn_lines(rounded_fold(),{'turn_method':'INVALID'})

    def test_matching_curvature_relaxes_area_but_rejects_flat_or_reversed_bend(self):
        match=self.module._adaptive_area_match
        # Fourfold triangle area change is accepted on the same bend, but not
        # under a fixed twofold area budget or near the curvature tolerance.
        self.assertTrue(match(10,10,1,4,2,3,.35)[0])
        self.assertFalse(match(10,10,1,4,2,1,.35)[0])
        self.assertFalse(match(10,6.6,1,4,2,3,.35)[0])
        self.assertFalse(match(10,-10,1,1,2,3,.35)[0])
        self.assertFalse(match(10,0,1,1,2,3,.35)[0])
        self.assertFalse(match(0,0,1,1,2,3,.35)[0])
        self.assertFalse(match(10,10,1,7,2,3,.35)[0])
        self.assertEqual(match(10,9,1,4,2,3,.35),match(9,10,4,1,2,3,.35))

    def test_adaptive_settings_invalid_values_rejected(self):
        for key,value in [('turn_area_ratio',.9),('turn_area_relax',float('nan')),
                          ('turn_curvature_tolerance',0),('turn_adaptive_area','false')]:
            with self.assertRaises(ValueError):
                self.module.detect_turn_lines(rounded_fold(),{key:value})

    def test_adaptive_area_preserves_continuous_fold_across_density_change(self):
        m=rounded_fold(True)
        # A gently widening rounded fold, with nonuniform longitudinal sampling.
        # Curvature changes by roughly 10%, while adjacent face areas jump >2x.
        for vertex in m.vertices:
            factor=1+.1*vertex.co.y
            vertex.co.x*=factor;vertex.co.z*=factor
        m.update();signature=analysis.mesh_signature(m)
        options={'curvature_floor':53,'feature_angle':80,'density_weight':.45,'turn_min_length':0}
        fixed=self.module.detect_turn_lines(m,dict(options,turn_area_relax=1))
        adaptive=self.module.detect_turn_lines(m,options)
        legacy=self.module.detect_turn_lines(m,dict(options,turn_adaptive_area=False))
        self.assertEqual(fixed['strong_edge_indices'],adaptive['strong_edge_indices'])
        self.assertTrue(set(fixed['weak_edge_indices'])<set(adaptive['weak_edge_indices']))
        self.assertGreater(len(adaptive['area_relaxed_edge_indices']),0)
        self.assertEqual(adaptive['edge_indices'],legacy['edge_indices'])
        self.assertTrue(all(line['length']>.99 for line in adaptive['lines']))
        self.assertEqual(analysis.mesh_signature(m),signature)
        m.transform(Matrix.Rotation(.73,4,'Y')@Matrix.Scale(-11,4))
        transformed=self.module.detect_turn_lines(m,options)
        self.assertEqual(adaptive['edge_indices'],transformed['edge_indices'])

    def test_dense_junctions_are_filtered_by_whole_network_length(self):
        bm=bmesh.new()
        try:
            center=bm.verts.new((0,0,0))
            for point in ((.02,0,0),(-.02,0,0),(0,.02,0)):
                bm.edges.new((center,bm.verts.new(point)))
            bm.edges.new((bm.verts.new((1,0,0)),bm.verts.new((1.01,0,0))))
            bm.edges.index_update();bm.edges.ensure_lookup_table()
            retained,count=self.module._long_components(bm,set(range(4)),.05)
            self.assertEqual(retained,{0,1,2})
            self.assertEqual(count,1)
        finally:bm.free()

    def test_old_region_seed_and_lock_labels_do_not_define_turn_lines(self):
        m=rounded_fold();before=self.module.detect_turn_lines(m,{})
        for name,domain in [('scr_region','FACE'),('scr_seed','FACE'),('scr_locked','EDGE')]:
            attribute=m.attributes.new(name,'INT',domain)
            for i,value in enumerate(attribute.data):value.value=i%3
        after=self.module.detect_turn_lines(m,{})
        self.assertEqual(before['edge_indices'],after['edge_indices'])

    def test_rotation_uniform_scale_and_reflection_keep_edge_ids(self):
        m=rounded_fold();before=self.module.detect_turn_lines(m,{})
        m.transform(Matrix.Rotation(.73,4,'Y')@Matrix.Scale(-11,4))
        after=self.module.detect_turn_lines(m,{})
        self.assertEqual(before['edge_indices'],after['edge_indices'])

    def test_preview_does_not_modify_source_or_region_attributes(self):
        import SurfaceCageRebuild as addon
        addon.register()
        try:
            source=bpy.data.objects.new('LinePreviewFixture',rounded_fold())
            bpy.context.scene.collection.objects.link(source)
            addon._activate(source);signature=analysis.mesh_signature(source.data)
            self.assertEqual(bpy.ops.scr.analyze(),{'FINISHED'})
            work=bpy.context.object
            regions=[v.value for v in work.data.attributes['scr_region'].data]
            self.assertEqual(bpy.ops.scr.turn_lines(),{'FINISHED'})
            import json
            report=json.loads(bpy.data.texts[bpy.context.object.scr_state.report_name].as_string())
            self.assertTrue(report['parameters']['adaptive_area']['enabled'])
            self.assertEqual(report['parameters']['adaptive_area']['base_ratio'],2)
            self.assertTrue(report['parameters']['surface_direction_fit']['enabled'])
            bpy.context.scene.scr_settings.turn_method='CONTRAST'
            self.assertEqual(bpy.ops.scr.turn_lines(),{'FINISHED'})
            report=json.loads(bpy.data.texts[bpy.context.object.scr_state.report_name].as_string())
            self.assertEqual(report['method'],'CONTRAST')
            self.assertTrue(report['parameters']['boundary_contrast']['enabled'])
            self.assertEqual(regions,[v.value for v in work.data.attributes['scr_region'].data])
            self.assertEqual(analysis.mesh_signature(source.data),signature)
            self.assertTrue(any(o.get('SCR_TurnLinePreview') for o in bpy.context.scene.objects))
        finally:
            addon.unregister()
