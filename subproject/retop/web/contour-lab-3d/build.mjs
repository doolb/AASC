import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));let html=await readFile(path.join(root,'index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="styles.css">','<style>'+await readFile(path.join(root,'styles.css'),'utf8')+'</style>');
const reference=await readFile(path.join(root,'reference/shoulder.json'),'utf8');
html=html.replace('<script src="engine.js"></script>','<script>window.CONTOUR3D_REFERENCE='+reference.replaceAll('<','\\u003c')+';</script><script>'+ (await readFile(path.join(root,'engine.js'),'utf8')).replaceAll('</script','<\\/script')+'</script>');
for(const name of ['uv-unwrap','symmetry','primitives','hierarchy','boundary-guides','surface-fit','curvature-network','structure-grid','csi-surface','manual-model','contour-check','silhouette-match','viewer','manual-ui','app'])html=html.replace('<script src="'+name+'.js"></script>','<script>'+(await readFile(path.join(root,name+'.js'),'utf8')).replaceAll('</script','<\\/script')+'</script>');
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist/index.html'),html);console.log('Built standalone Contour Lab 3D:',Buffer.byteLength(html),'bytes');
