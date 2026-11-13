import unittest,math,bpy,bmesh
from mathutils import Vector,Matrix
from SurfaceCageRebuild.structure_network import signed_curvature,join_endpoints
from SurfaceCageRebuild.turn_lines import detect_turn_lines
from SurfaceCageRebuild.analysis import mesh_signature
from test_turn_lines import rounded_fold
from test_partition_features import grid

class StructureNetworkTests(unittest.TestCase):
    def test_signed_curvature_separates_valley_from_ridge(self):
        m=grid([i*.1 for i in range(7)],[(i*.1,0) for i in range(-4,5)])
        for v in m.vertices:v.co.z=v.co.x*v.co.x
        m.update();bm=bmesh.new();bm.from_mesh(m);bm.normal_update()
        values=signed_curvature(bm,1)
        interior=[v.index for v in bm.verts if not v.is_boundary]
        self.assertTrue(all(abs(values[i])>1e-6 for i in interior))
        for v in bm.verts:v.co.z=-v.co.z
        bm.normal_update();opposite=signed_curvature(bm,1)
        self.assertTrue(all(opposite[i]*values[i]<0 for i in interior));bm.free()

    def test_t_contact_becomes_shared_vertex_and_parallel_rails_stay_separate(self):
        m=grid([-1,1],[(-1,0),(1,0)]);bm=bmesh.new();bm.from_mesh(m);bm.normal_update()
        def line(points):return {'points':points,'closed':False}
        lines=[line([(-.8,0,0),(.8,0,0)]),line([(0,.005,0),(0,.8,0)]),line([(-.8,.03,0),(.8,.03,0)])]
        g=join_endpoints(lines,bm,2,.01);bm.free()
        self.assertEqual(g['joined_contacts'],1);self.assertEqual(len(g['junction_vertices']),1)
        self.assertEqual(len(g['edges']),4)

    def test_nearby_disconnected_layers_do_not_join(self):
        vs=[(-1,-1,0),(1,-1,0),(1,1,0),(-1,1,0),(-1,-1,.003),(1,-1,.003),(1,1,.003),(-1,1,.003)]
        m=bpy.data.meshes.new('layers');m.from_pydata(vs,[],[(0,1,2,3),(4,5,6,7)]);m.update()
        bm=bmesh.new();bm.from_mesh(m);bm.normal_update()
        g=join_endpoints([{'points':[(-.8,0,0),(.8,0,0)],'closed':False},{'points':[(0,.004,.003),(0,.8,.003)],'closed':False}],bm,2,.01)
        self.assertEqual(g['joined_contacts'],0);bm.free()

    def test_flat_dense_mesh_does_not_invent_network(self):
        m=grid([0,.001,.01,.1,1],[(0,0),(.001,0),(.01,0),(1,0)])
        self.assertEqual(detect_turn_lines(m,{'turn_method':'NETWORK'})['lines'],[])

    def test_source_unchanged_and_no_reference_inputs(self):
        m=rounded_fold();before=mesh_signature(m)
        r=detect_turn_lines(m,{'turn_method':'NETWORK'})
        self.assertEqual(before,mesh_signature(m));self.assertTrue(r['lines']);self.assertEqual(r['support_count'],0)
        self.assertEqual(r['parameters']['input'],'source mesh geometry only')
        self.assertTrue(all(len(l['points'])==2 for l in r['lines']))

    def test_chain_simplification_preserves_shared_junction(self):
        from SurfaceCageRebuild.structure_network import simplify_network
        g={'vertices':[(-1,0,0),(-.5,.001,0),(0,0,0),(.5,.001,0),(1,0,0),(0,1,0)],'edges':[(0,1),(1,2),(2,3),(3,4),(2,5)]}
        r=simplify_network(g,2,.004)
        self.assertEqual(len(r['junction_vertices']),1)
        self.assertEqual(len(r['vertices']),4)
        self.assertEqual(tuple(r['vertices'][r['junction_vertices'][0]]),(0,0,0))

    def test_rotation_scale_preserve_curvature_sign(self):
        m=rounded_fold();bm=bmesh.new();bm.from_mesh(m);bm.normal_update()
        first=signed_curvature(bm,1)
        transform=Matrix.Rotation(.71,4,'Y')@Matrix.Scale(7,4)
        bmesh.ops.transform(bm,matrix=transform,verts=list(bm.verts));bm.normal_update()
        after=signed_curvature(bm,7)
        for a,b in zip(first,after):
            if abs(a)>1e-4:self.assertAlmostEqual(a,b,delta=max(abs(a)*.001,.001))
        bm.free()

    def test_gaps_require_geometry_evidence(self):
        from SurfaceCageRebuild.structure_network import bridge_evidence_gaps
        m=grid([-1,1],[(-1,0),(1,0)]);bm=bmesh.new();bm.from_mesh(m);bm.normal_update();bm.faces.ensure_lookup_table()
        g={'vertices':[(-.5,0,0),(-.01,0,0),(.01,0,0),(.5,0,0)],'edges':[(0,1),(2,3)]}
        self.assertEqual(bridge_evidence_gaps(g,bm,[0]*len(bm.faces),2,.55)['evidence_gap_bridges'],0)
        self.assertEqual(bridge_evidence_gaps(g,bm,[1]*len(bm.faces),2,.55)['evidence_gap_bridges'],1);bm.free()
