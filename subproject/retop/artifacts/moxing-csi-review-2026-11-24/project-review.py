import json, math, sys
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree

root=Path(__file__).resolve().parent
final='--final' in sys.argv
file=root / ('csi-partition-v2.json' if final else 'review-v2-base.json')
data=json.loads(file.read_text(encoding='utf8'))
mesh=data['postprocess']['mesh']
tree=BVHTree.FromPolygons([Vector(p) for p in mesh['vertices']],mesh['faces'],all_triangles=False)
height=max(p[1] for p in mesh['vertices'])-min(p[1] for p in mesh['vertices'])
if final:
    for c in data['reviewGuides']['curves']:
        c['displaySamples']=[]
        for p in c['samples']:
            hit,normal,face,distance=tree.find_nearest(Vector(p))
            c['displaySamples'].append(list(hit+normal*height*.0003))
    file.write_text(json.dumps(data,separators=(',',':')),encoding='utf8')
else:
    result=json.loads((root/'review-paths.json').read_text(encoding='utf8'))
    for route in result['paths']:
        dense=[]
        for a,b in zip(route['points'],route['points'][1:]):
            a,b=Vector(a),Vector(b)
            count=max(1,math.ceil((b-a).length/(height*.003)))
            dense.extend(a.lerp(b,i/count) for i in range(count))
        dense.append(Vector(route['points'][-1]))
        hits=[tree.find_nearest(p) for p in dense]
        route['maximumProjectionDistance']=max(hit[3] for hit in hits)
        route['projected']=[list(hit[0]) for hit in hits]
        # 这里只是候选映射，距离过大说明对应关系不可靠，拒绝整条路径。
        route['accepted']=route['maximumProjectionDistance']<=height*.03
    (root/'review-paths-projected.json').write_text(json.dumps(result,ensure_ascii=False),encoding='utf8')
    print([(p['name'],p['accepted'],p['maximumProjectionDistance']) for p in result['paths']])
