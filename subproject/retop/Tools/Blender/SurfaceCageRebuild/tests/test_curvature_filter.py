import unittest,bpy,bmesh
from SurfaceCageRebuild.curvature_filter import enhance_curvature
from SurfaceCageRebuild.plane_boundary import connect_vector_graph
from test_partition_features import grid

class CurvatureEnhanceTests(unittest.TestCase):
    def test_small_changes_smooth_large_changes_expand(self):
        values=[1.,1.1,1.,10.,10.1,10.];adj=[[1],[0,2],[1,3],[2,4],[3,5],[4]]
        result=enhance_curvature(values,adj,1,.25,.5,1)
        self.assertLess(abs(result[0]-result[1]),abs(values[0]-values[1]))
        self.assertGreater(result[3]-result[2],values[3]-values[2])
        self.assertEqual(enhance_curvature(values,adj,0,.25,.5,1),values)

    def test_amplification_is_bounded_and_flat_constant_unchanged(self):
        values=[1.,10.];r=enhance_curvature(values,[[1],[0]],10,.25,.5,1)
        self.assertGreaterEqual(min(r),0);self.assertLessEqual(max(r),15)
        self.assertEqual(enhance_curvature([5,5,5],[[1],[0,2],[1]]),[5,5,5])
        with self.assertRaises(ValueError):enhance_curvature(values,[[1],[0]],gain=float('nan'))

    def mesh(self):
        m=grid([-1,1],[(-1,0),(2,0)]);bm=bmesh.new();bm.from_mesh(m);bm.normal_update();bm.faces.ensure_lookup_table();bm.verts.ensure_lookup_table();return bm

    def test_final_overlap_lines_are_split_and_deduplicated(self):
        bm=self.mesh();g={'vertices':[(0,0,0),(1,0,0),(.25,0,0),(.75,0,0)],'edges':[(0,1),(2,3)]}
        r=connect_vector_graph(g,bm,[1]*len(bm.faces),3)
        self.assertEqual(len(r['edges']),3);self.assertGreater(r['vector_duplicate_edges_removed'],0);bm.free()

    def test_final_close_endpoints_share_vertex(self):
        bm=self.mesh();g={'vertices':[(0,0,0),(.5,0,0),(.50001,0,0),(1,0,0)],'edges':[(0,1),(2,3)]}
        r=connect_vector_graph(g,bm,[1]*len(bm.faces),3)
        self.assertEqual(len(r['vertices']),3);self.assertEqual(r['vector_merged_vertices'],1);bm.free()

    def test_declared_shells_prevent_coincident_cross_layer_weld(self):
        bm=self.mesh();g={'vertices':[(0,0,0),(.5,0,0),(.5,0,0),(1,0,0)],'edges':[(0,1),(2,3)],'vertex_shells':[0,0,1,1]}
        r=connect_vector_graph(g,bm,[1]*len(bm.faces),3)
        self.assertEqual(r['vector_merged_vertices'],0);self.assertEqual(r['evidence_gap_bridges'],0);bm.free()
