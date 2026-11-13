import unittest,math,bpy,bmesh
from mathutils import Matrix,Vector
from SurfaceCageRebuild.cell_network import relief_cells,contract_x_junctions
from SurfaceCageRebuild.turn_lines import detect_turn_lines
from SurfaceCageRebuild.analysis import mesh_signature

def bumps(reverse=False):
    n=31;vs=[];fs=[]
    for j in range(n):
        for i in range(n):
            x=-1+2*i/(n-1);y=-1+2*j/(n-1)
            z=sum(.18*math.exp(-((x-a)**2+(y-b)**2)/.045) for a in (-.4,.4) for b in (-.4,.4))
            vs.append((x,y,z))
    for j in range(n-1):
        for i in range(n-1):
            a=j*n+i;fs.extend([(a,a+1,a+n),(a+1,a+n+1,a+n)] if reverse else [(a,a+1,a+n+1),(a,a+n+1,a+n)])
    m=bpy.data.meshes.new('Controlled bumps');m.from_pydata(vs,[],fs);m.update();return m

class CellNetworkTests(unittest.TestCase):
    def test_four_relief_peaks_remain_distinct(self):
        m=bumps();bm=bmesh.new();bm.from_mesh(m);bm.normal_update()
        labels,r=relief_cells(bm,3,{})
        self.assertGreaterEqual(r['regions'],4);self.assertLessEqual(r['regions'],12)
        centers=[]
        for x in (-.4,.4):
            for y in (-.4,.4):
                v=min(bm.verts,key=lambda v:(v.co.x-x)**2+(v.co.y-y)**2);centers.append(labels[v.index])
        self.assertEqual(len(set(centers)),4);bm.free()

    def test_rotation_scale_translation_do_not_change_partition(self):
        m=bumps();bm=bmesh.new();bm.from_mesh(m);bm.normal_update();a,r=relief_cells(bm,3,{})
        t=Matrix.Translation((2,-3,5))@Matrix.Rotation(.71,4,'Y')@Matrix.Scale(7,4)
        bmesh.ops.transform(bm,matrix=t,verts=list(bm.verts));bm.normal_update();b,s=relief_cells(bm,21,{})
        self.assertEqual(a,b);bm.free()

    def test_flat_mesh_has_no_cells_or_grid(self):
        m=bumps()
        for v in m.vertices:v.co.z=0
        m.update();r=detect_turn_lines(m,{'turn_method':'NETWORK','network_path':'CELLS'})
        self.assertFalse(r['lines'])

    def test_mesh_and_source_attributes_unchanged(self):
        m=bumps();signature=mesh_signature(m)
        r=detect_turn_lines(m,{'turn_method':'NETWORK','network_path':'CELLS'})
        self.assertEqual(signature,mesh_signature(m));self.assertEqual(r['parameters']['input'],'source mesh geometry only')
        self.assertEqual(r['parameters']['path'],'RELIEF_CELLS')
        self.assertGreater(r['network']['accepted_chains']+r['network']['rejected_chains'],0)

    def test_only_opposite_four_spokes_contract(self):
        g={'vertices':[(-.005,0,0),(.005,0,0),(-1,0,0),(0,1,0),(1,0,0),(0,-1,0)],'edges':[(0,1),(0,2),(0,3),(1,4),(1,5)]}
        r=contract_x_junctions(g,2);self.assertEqual(r['contracted_x_junctions'],1);self.assertEqual(len(r['edges']),4)
        g['vertices'][5]=(1,.2,0)
        self.assertEqual(contract_x_junctions(g,2)['contracted_x_junctions'],0)

    def test_invalid_parameters_rejected(self):
        m=bumps();bm=bmesh.new();bm.from_mesh(m);bm.normal_update()
        for options in ({'network_relief_prominence':float('nan')},{'network_relief_rounds':0}):
            with self.assertRaises(ValueError):relief_cells(bm,3,options)
        bm.free()

    def test_unsupported_branch_is_removed_before_smoothing(self):
        from SurfaceCageRebuild.cell_network import filter_supported_chains
        g={'vertices':[(-1,0,0),(0,0,0),(1,0,0),(0,1,0)],'edges':[(0,1),(1,2),(1,3)]}
        r=filter_supported_chains(g,{(0,1):1.2,(1,2):1.2,(1,3):.1},.55)
        self.assertEqual(r['accepted_chains'],2);self.assertEqual(r['rejected_chains'],1)
        self.assertEqual({tuple(e) for e in r['edges']},{(0,1),(1,2)})

    def test_chain_selection_keeps_supported_chain_through_short_weak_sample(self):
        from SurfaceCageRebuild.cell_network import filter_supported_chains
        g={'vertices':[(i*.1,0,0) for i in range(11)],'edges':[(i,i+1) for i in range(10)]}
        scores={(i,i+1):1.2 for i in range(10)};scores[(5,6)]=.1
        r=filter_supported_chains(g,scores,.55)
        self.assertEqual(len(r['edges']),10)

    def test_vector_smoothing_keeps_notch_and_limits_drift(self):
        from SurfaceCageRebuild.structure_network import simplify_network
        vs=[(-1+i*.1,.005*(i%2),0) for i in range(11)]
        vs.extend((0,i*.1,0) for i in range(1,11))
        g={'vertices':vs,'edges':[(i,i+1) for i in range(20)]}
        r=simplify_network(g,2,.001,20,.003,protect_corners=True)
        self.assertTrue(any((Vector(p)-Vector(vs[10])).length<1e-6 for p in r['vertices']))
        self.assertEqual(tuple(r['vertices'][0]),vs[0])
        self.assertLess(len(r['vertices']),len(vs))
        self.assertLessEqual(r['max_smooth_displacement_relative'],.003001)
