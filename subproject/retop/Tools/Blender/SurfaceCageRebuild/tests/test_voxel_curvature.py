import unittest
from mathutils import Matrix,Vector
from SurfaceCageRebuild.voxel_curvature import multiscale_curvature

class VoxelCurvatureTests(unittest.TestCase):
    def data(self):
        points=[(i*.005,0,0) for i in range(6)];normals=[(0,0,1)]*6;areas=[1]*6
        adjacency=[[j for j in (i-1,i+1) if 0<=j<6] for i in range(6)]
        return points,normals,areas,adjacency
    def test_multiscale_smooths_low_change_enhances_step(self):
        p,n,a,adj=self.data();values=[1,1.1,1,10,10.1,10]
        out,report=multiscale_curvature(values,p,n,a,adj,1,{'boundary_voxel_layout':'LOCAL','boundary_voxel_size':.01,'boundary_curvature_floor':1})
        self.assertEqual(report['windows'],[3,5,9]);self.assertFalse(report['trainable_parameters'])
        self.assertGreater(out[3]-out[2],values[3]-values[2]);self.assertLessEqual(max(out),15.15)
        self.assertEqual(values,[1,1.1,1,10,10.1,10])
    def test_disconnected_and_folded_layers_do_not_mix(self):
        for p,adj in [([(0,0,0),(0,0,.001)],[[],[]]), ([(0,0,0),(1,0,0),(1,0,.001),(0,0,.001)],[[1],[0,2],[1,3],[2]])]:
            values=[1,100] if len(p)==2 else [1,1,100,100]
            out,r=multiscale_curvature(values,p,[(0,0,1)]*len(p),[1]*len(p),adj,1,{})
            # The distant sheet interiors cannot mix. Samples 1/2 in the
            # folded case are physically adjacent at the connecting rim, where
            # a real large change is correctly enhanced.
            self.assertEqual(out[0],values[0]);self.assertEqual(out[-1],values[-1])
    def test_kernel_is_geometric_after_grid_candidate_search(self):
        p,n,a,adj=self.data();values=[1,1,1,10,10,10]
        out,r=multiscale_curvature(values,p,n,a,adj,1,{'boundary_curvature_floor':1})
        t=Matrix.Translation((1,2,3))@Matrix.Rotation(.71,4,'Y')@Matrix.Scale(7,4)
        pp=[t@Vector(v) for v in p];nn=[(t.to_3x3()@Vector(v)).normalized() for v in n]
        after,r=multiscale_curvature(values,pp,nn,a,adj,7,{'boundary_curvature_floor':1})
        for x,y in zip(out,after):self.assertAlmostEqual(x,y,delta=.002)

    def test_full_voxel_pipeline_restores_virtual_corner(self):
        from test_turn_lines import rounded_fold
        from SurfaceCageRebuild.turn_lines import detect_turn_lines
        from SurfaceCageRebuild.analysis import mesh_signature
        m=rounded_fold();before=mesh_signature(m)
        r=detect_turn_lines(m,{'turn_method':'NETWORK','network_path':'PLANES','boundary_curvature_kernel':'VOXEL','turn_min_length':0})
        self.assertEqual(before,mesh_signature(m));self.assertEqual(len(r['lines']),1)
        for p in r['network']['vertices']:
            self.assertAlmostEqual(p[0],.04,delta=1e-5);self.assertAlmostEqual(p[2],0,delta=1e-5)
        self.assertEqual(r['diagnostics']['curvature_convolution']['global_box']['cells'],1)
        self.assertEqual([v['name'] for v in r['diagnostics']['curvature_convolution']['levels']],['far','middle','near','ultra'])

    def test_operator_exports_actual_shared_vertex_mesh(self):
        import bpy,json,SurfaceCageRebuild as addon
        from test_turn_lines import rounded_fold
        addon.register()
        try:
            source=bpy.data.objects.new('VoxelOperatorFixture',rounded_fold());bpy.context.scene.collection.objects.link(source)
            addon._activate(source);options=bpy.context.scene.scr_settings
            options.turn_method='NETWORK';options.network_path='PLANES';options.boundary_curvature_kernel='VOXEL'
            self.assertEqual(bpy.ops.scr.turn_lines(),{'FINISHED'})
            preview=bpy.context.object
            network=next(o for o in bpy.data.objects if o.parent==preview and o.scr_state.role=='VECTOR_NETWORK')
            r=json.loads(bpy.data.texts[network.scr_state.report_name].as_string())
            self.assertEqual(network.type,'MESH');self.assertEqual(len(network.data.polygons),0)
            self.assertEqual(len(network.data.vertices),len(r['network']['vertices']))
            self.assertEqual(len(network.data.edges),len(r['network']['edges']))
            self.assertTrue(network.data.edges)
        finally:
            for name in addon.SCR_Settings.__annotations__:bpy.context.scene.scr_settings.property_unset(name)
            addon.unregister()

    def test_four_levels_have_large_physical_spacing(self):
        p,n,a,adj=self.data()
        out,r=multiscale_curvature([1]*len(p),p,n,a,adj,1,{})
        self.assertEqual([v['divisions'] for v in r['levels']],[1,8,32,128])
        middle,near,ultra=r['levels'][1:]
        self.assertAlmostEqual(middle['cell_width_relative']/near['cell_width_relative'],4)
        self.assertAlmostEqual(near['cell_width_relative']/ultra['cell_width_relative'],4)
        self.assertEqual(r['global_box']['cells'],1)

    def test_far_box_follows_object_principal_directions(self):
        from SurfaceCageRebuild.voxel_curvature import fitted_box
        p=[Vector((x,y,z)) for x in (-2,2) for y in (-1,1) for z in (-.5,.5)]
        t=Matrix.Translation((1,2,3))@Matrix.Rotation(.71,4,'Y')@Matrix.Scale(7,4)
        r=fitted_box([t@v for v in p],[1]*8,[t@v for v in p])
        for a,b in zip(r['dimensions'],(28,14,7)):self.assertAlmostEqual(a,b,delta=.0001)
