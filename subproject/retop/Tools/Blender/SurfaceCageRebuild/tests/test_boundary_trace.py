"""One traced line per structural boundary, then the two chamfer support lines beside it."""
import importlib
import json
import math
import unittest

import bpy
import bmesh
from mathutils import Matrix, Vector

from SurfaceCageRebuild import analysis
from test_partition_features import grid
from test_strip_features import circular_profile
from test_turn_lines import rounded_fold


def triangulated(mesh):
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm,faces=list(bm.faces))
    bm.to_mesh(mesh);bm.free();mesh.update()
    return mesh


def rounded_rim(n=96, radius=.08):
    profile=[(.2,0),(.5,0),(.8,0),(1-radius,0)]
    profile+=[(1-radius+radius*math.sin(i*math.pi/16),radius*(1-math.cos(i*math.pi/16))) for i in range(1,9)]
    profile+=[(1,.25),(1,.45),(1,.6)]
    return triangulated(circular_profile(profile,n))


def by_role(report, role):
    return [line for line in report['lines'] if line['role']==role]


def distance_to(points, point):
    return min((Vector(p)-point).length for p in points)


class BoundaryTraceTests(unittest.TestCase):
    def setUp(self):
        self.module=importlib.import_module('SurfaceCageRebuild.turn_lines')

    def trace(self, mesh, **options):
        return self.module.detect_turn_lines(mesh,dict(options,turn_method='TRACE'))

    def test_rounded_fold_gives_one_centre_line_and_two_chamfer_lines(self):
        m=triangulated(rounded_fold());signature=analysis.mesh_signature(m)
        report=self.trace(m)
        self.assertEqual(analysis.mesh_signature(m),signature)
        self.assertTrue(report['requires_confirmation'])
        boundaries=by_role(report,'boundary')
        self.assertEqual(len(boundaries),1)
        line=boundaries[0]
        self.assertGreater(line['length'],.85)
        for x,y,z in line['points']:
            self.assertGreater(x,-.01);self.assertLess(x,.045)
            self.assertGreater(z,-1e-4);self.assertLess(z,.035)
        supports=by_role(report,'support')
        self.assertEqual(len(supports),2)
        self.assertTrue(all(s['parent']==report['lines'].index(line) for s in supports))
        # x+z grows monotonically from the floor, over the fillet, up the wall.
        middle=sum(p[0]+p[2] for p in line['points'])/len(line['points'])
        sides=sorted(sum(p[0]+p[2] for p in s['points'])/len(s['points'])-middle for s in supports)
        self.assertLess(sides[0],-.005);self.assertGreater(sides[1],.005)
        for support in supports:
            self.assertGreater(support['length'],.75)
            gaps=[distance_to(line['points'],Vector(p)) for p in support['points'][3:-3]]
            self.assertGreater(min(gaps),.004);self.assertLess(max(gaps),.08)

    def test_transform_keeps_line_structure(self):
        m=triangulated(rounded_fold());before=self.trace(m)
        m.transform(Matrix.Rotation(.73,4,'Y')@Matrix.Scale(-11,4))
        after=self.trace(m)
        self.assertEqual([l['role'] for l in before['lines']],[l['role'] for l in after['lines']])
        for a,b in zip(before['lines'],after['lines']):
            self.assertAlmostEqual(b['length']/a['length'],11,delta=11*.04)

    def test_smooth_surfaces_do_not_invent_boundaries(self):
        arc=grid([i/8 for i in range(9)],[(math.sin(i*math.pi/32),math.cos(i*math.pi/32)) for i in range(33)])
        dense=grid([0,.001,.002,.05,.3,1],[(0,0),(.001,0),(.1,0),(1,0)])
        for m in (arc,dense):
            self.assertEqual(self.trace(m)['lines'],[])

    def test_rounded_rim_is_one_closed_loop(self):
        report=self.trace(rounded_rim(),trace_support=False)
        boundaries=by_role(report,'boundary')
        self.assertEqual(len(boundaries),1)
        self.assertTrue(boundaries[0]['closed'])
        expected=2*math.pi*(1-.08+.08*math.sin(math.pi/4))
        self.assertAlmostEqual(boundaries[0]['length'],expected,delta=expected*.05)
        self.assertEqual(by_role(report,'support'),[])

    def test_preview_operator_draws_traced_lines(self):
        addon=importlib.import_module('SurfaceCageRebuild')
        addon.register()
        try:
            source=bpy.data.objects.new('TraceFixture',triangulated(rounded_fold()))
            bpy.context.scene.collection.objects.link(source)
            addon._activate(source)
            bpy.context.scene.scr_settings.turn_method='TRACE'
            self.assertEqual(bpy.ops.scr.turn_lines(),{'FINISHED'})
            preview=bpy.context.object
            report=json.loads(bpy.data.texts[preview.scr_state.report_name].as_string())
            self.assertEqual(report['method'],'TRACE')
            lines=[o for o in bpy.data.objects if o.parent==preview and o.type=='CURVE']
            self.assertEqual(len(lines),1)
            self.assertEqual(len(lines[0].data.splines),len(report['lines']))
        finally:
            for name in addon.SCR_Settings.__annotations__:
                bpy.context.scene.scr_settings.property_unset(name)
            addon.unregister()

class CageCurveTests(unittest.TestCase):
    def test_smoothing_is_bounded_and_keeps_corner_and_endpoints(self):
        from SurfaceCageRebuild.boundary_trace import _cage_smooth
        points=[Vector((i*.1, .02 if i%2 else 0, 0)) for i in range(11)]
        result=_cage_smooth(points,False,[5],40,.006)
        for a,b in zip(points,result):
            self.assertLessEqual((a-b).length,.006001)
        for i in (0,5,10):self.assertEqual(points[i],result[i])
        self.assertLess(sum((result[i+1]-2*result[i]+result[i-1]).length for i in range(1,10)),
                        sum((points[i+1]-2*points[i]+points[i-1]).length for i in range(1,10)))

    def test_shared_simplification_preserves_a_rail_feature_and_error_bound(self):
        from SurfaceCageRebuild.boundary_trace import _simple_indices
        centre=[Vector((i*.1,0,0)) for i in range(21)]
        rail=[Vector((i*.1,.1,.08 if i==10 else 0)) for i in range(21)]
        ids=_simple_indices([centre,rail],False,[],.005)
        self.assertIn(10,ids);self.assertLess(len(ids),len(centre))
        for curve in (centre,rail):
            for a,b in zip(ids,ids[1:]):
                d=curve[b]-curve[a]
                for p in curve[a:b+1]:
                    t=min(1,max(0,(p-curve[a]).dot(d)/d.length_squared))
                    self.assertLessEqual((p-curve[a]-t*d).length,.005001)

    def test_invalid_cage_budgets_rejected(self):
        from SurfaceCageRebuild.turn_lines import detect_turn_lines
        m=triangulated(rounded_fold())
        for key in ('trace_cage_allowance','trace_simplify_error'):
            for value in (-1,float('nan'),float('inf')):
                with self.assertRaises(ValueError):detect_turn_lines(m,{'turn_method':'TRACE',key:value})
