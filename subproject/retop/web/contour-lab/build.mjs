import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
let html=await readFile(path.join(root,'index.html'),'utf8');
const css=await readFile(path.join(root,'styles.css'),'utf8');
const scripts=['engine.js','inlet-transport.js','river-field.js','flow.js','flow-uv.js','flow-surface.js','flow-advection.js','surface-texture.js','boundary-uv.js','boundary-offset.js','boundary-physics.js','boundary-surface.js','input.js','sidebar.js','app.js'];
const js=(await Promise.all(scripts.map(name=>readFile(path.join(root,name),'utf8')))).join('\n');
// One release token prevents a cached pressure solver being mixed with a new
// river surface module. Refreshing the document fetches a coherent asset set.
const release=createHash('sha256').update(css).update(js).digest('hex').slice(0,16);
html=html.replace(/(<link rel="stylesheet" href="styles\.css)(?:\?v=[^"]*)?(">)/,`$1?v=${release}$2`);
for(const name of scripts)html=html.replace(new RegExp('(<script src="'+name.replaceAll('.','\\.')+')(?:\\?v=[^"]*)?("\\x3e)'),`$1?v=${release}$2`);
await writeFile(path.join(root,'index.html'),html);
const reference=(await readFile(path.join(root,'reference/shape-reference-sheet.png'))).toString('base64');
html=html.replace(/<link rel="stylesheet" href="styles\.css(?:\?v=[^"]*)?">/,`<style>${css}</style>`).replace("'reference/shape-reference-sheet.png'",`'data:image/png;base64,${reference}'`);
for(const name of scripts)html=html.replace(new RegExp('<script src="'+name.replaceAll('.','\\.')+'(?:\\?v=[^"]*)?"></script>'),'');
html=html.replace('</body>',`<script>${js.replaceAll('</script','<\\/script')}</script></body>`);
for(const name of ['hole-ring','hole-double','hole-curved-ring']){const image=(await readFile(path.join(root,'reference',name+'.png'))).toString('base64');html=html.replace("'reference/"+name+".png'","'data:image/png;base64,"+image+"'");}
await mkdir(path.join(root,'dist'),{recursive:true});await writeFile(path.join(root,'dist/index.html'),html);console.log('Built portable dist/index.html; no network or dependencies.');
