import unittest,math,bpy
from mathutils import Vector,Matrix
from SurfaceCageRebuild.plane_boundary import plane_intersection_at,weld_virtual_graph
from SurfaceCageRebuild.turn_lines import detect_turn_lines
from SurfaceCageRebuild.analysis import mesh_signature
from test_turn_lines import rounded_fold

class PlaneBoundaryTests(unittest.TestCase):
    def test_two_planes_extend_to_virtual_corner(self):
        a=(Vector((1,0,0)),.04);b=(Vector((0,0,1)),0)
        p=plane_intersection_at(a,b,Vector((.02,.3,.02)),.1)
        self.assertLess((p-Vector((.04,.3,0))).length,1e-6)
        self.assertIsNone(plane_intersection_at(a,a,Vector(),1))
        self.assertIsNone(plane_intersection_at(a,b,Vector(),.001))

    def test_rounded_fold_produces_one_hard_line_not_fillet_rails(self):
        m=rounded_fold();before=mesh_signature(m)
        r=detect_turn_lines(m,{'turn_method':'NETWORK','network_path':'PLANES','turn_min_length':0})
        self.assertEqual(mesh_signature(m),before)
        self.assertEqual(len(r['lines']),1)
        self.assertGreater(r['diagnostics']['welded_virtual_vertices'],0)
        for p in r['network']['vertices']:
            self.assertAlmostEqual(p[0],.04,delta=1e-5);self.assertAlmostEqual(p[2],0,delta=1e-5)
        self.assertEqual(r['parameters']['rule'],'area AND curvature contrast before plane fitting')

    def test_rotated_scaled_planes_restore_same_corner(self):
        m=rounded_fold();t=Matrix.Translation((2,-3,5))@Matrix.Rotation(.71,4,'Y')@Matrix.Scale(7,4);m.transform(t)
        r=detect_turn_lines(m,{'turn_method':'NETWORK','network_path':'PLANES','turn_min_length':0})
        self.assertTrue(r['lines'])
        for point in r['network']['vertices']:
            local=t.inverted()@Vector(point)
            self.assertAlmostEqual(local.x,.04,delta=1e-4);self.assertAlmostEqual(local.z,0,delta=1e-4)

    def test_weld_does_not_connect_independent_shells(self):
        planes=[[(Vector((1,0,0)),0),(Vector((0,0,1)),0)]]*2
        vs,edges,count=weld_virtual_graph([(0,0,0),(0,0,0)],[],planes,[0,1],.001)
        self.assertEqual(count,0)
