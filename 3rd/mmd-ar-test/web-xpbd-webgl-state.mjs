import { DataTexture, WebGLRenderTarget, FloatType, RGBAFormat, NearestFilter, NoColorSpace,
    RawShaderMaterial, GLSL3, Scene, Mesh, BufferGeometry, Float32BufferAttribute, Camera, Vector4 } from 'three';

// 所有数据按线性vec4索引打包，避免用模型数量直接作为纹理宽度；不使用颜色转换或插值。
export function textureShape(texels, limit = 4096) {
    const width = Math.min(limit, Math.max(1, Math.ceil(Math.sqrt(texels))));
    const height = Math.max(1, Math.ceil(texels / width));
    if (height > limit) throw new Error('WebGL XPBD数据超出纹理容量');
    return { width, height };
}
export function createData(values, limit) {
    const { width, height } = textureShape(Math.ceil(values.length / 4), limit);
    const data = new Float32Array(width * height * 4); data.set(values);
    const texture = new DataTexture(data, width, height, RGBAFormat, FloatType);
    texture.minFilter = texture.magFilter = NearestFilter; texture.colorSpace = NoColorSpace;
    texture.generateMipmaps = false; texture.needsUpdate = true; return texture;
}
export function createGpuState(renderer) {
    const gl = renderer?.getContext();
    if (!renderer?.capabilities.isWebGL2 || !gl?.getExtension('EXT_color_buffer_float')) {
        throw new Error('需要WebGL2及EXT_color_buffer_float，使用CPU XPBD');
    }
    if (gl.isContextLost()) throw new Error('WebGL上下文已丢失');
    const limit = renderer.capabilities.maxTextureSize;
    const owned = new Set(); let bytes = 0, passes = 0;
    const own = value => { owned.add(value); return value; };
    const target = texels => {
        const size = textureShape(texels, limit);
        const allocation = size.width * size.height * 16;
        if (bytes + allocation > 64 * 1024 * 1024) throw new Error('WebGL XPBD贴图超过64MiB预算，使用CPU XPBD');
        const rt = own(new WebGLRenderTarget(size.width, size.height, { type: FloatType,
            format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter,
            depthBuffer: false, stencilBuffer: false, generateMipmaps: false }));
        rt.texture.colorSpace = NoColorSpace; bytes += allocation; return rt;
    };
    const data = values => {
        const texture = createData(values, limit); const allocation = texture.image.data.byteLength;
        if (bytes + allocation > 64 * 1024 * 1024) { texture.dispose(); throw new Error('WebGL XPBD数据超过64MiB预算'); }
        bytes += allocation; return own(texture);
    };
    const geometry = own(new BufferGeometry());
    geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const scene = new Scene(), camera = new Camera(), mesh = new Mesh(geometry); mesh.frustumCulled = false; scene.add(mesh);
    const material = source => own(new RawShaderMaterial({ glslVersion: GLSL3,
        vertexShader: 'in vec3 position; void main(){gl_Position=vec4(position,1.0);}',
        fragmentShader: source, depthTest: false, depthWrite: false, toneMapped: false, uniforms: {} }));
    // 共用显示renderer；物理运行结束（包括抛错）必须恢复目标、视口和裁剪，不能清除主画面。
    const scope = action => {
        const previous = renderer.getRenderTarget(), face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
        const viewport = renderer.getViewport(new Vector4()), scissor = renderer.getScissor(new Vector4());
        const scissorTest = renderer.getScissorTest(), autoClear = renderer.autoClear, xr = renderer.xr.enabled;
        const onShaderError = renderer.debug.onShaderError;
        renderer.debug.onShaderError = (context, program, vertex, fragment) => {
            throw new Error('WebGL XPBD shader编译失败：' + context.getProgramInfoLog(program)
                + context.getShaderInfoLog(vertex) + context.getShaderInfoLog(fragment));
        };
        try { renderer.autoClear = false; renderer.xr.enabled = false; renderer.setScissorTest(false); return action(); }
        finally { renderer.setRenderTarget(previous, face, mip); renderer.setViewport(viewport); renderer.setScissor(scissor);
            renderer.setScissorTest(scissorTest); renderer.autoClear = autoClear; renderer.xr.enabled = xr; renderer.debug.onShaderError = onShaderError; }
    };
    const draw = (shader, output, uniforms) => {
        for (const [key, value] of Object.entries({ ...uniforms, uWidth: output.width })) {
            if (value === output.texture) throw new Error('XPBD禁止采样当前写入目标');
            if (!shader.uniforms[key]) shader.uniforms[key] = { value }; else shader.uniforms[key].value = value;
        }
        mesh.material = shader; renderer.setRenderTarget(output); renderer.setViewport(0, 0, output.width, output.height);
        renderer.render(scene, camera); passes += 1;
    };
    const dispose = () => { for (const object of owned) object.dispose(); owned.clear(); scene.clear(); bytes = 0; };
    try {
        const probe = target(1);
        scope(() => { renderer.setRenderTarget(probe); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
            throw new Error('RGBA32F帧缓冲不可用');
        } });
        probe.dispose(); owned.delete(probe); bytes -= 16;
    } catch (error) { dispose(); throw error; }
    return { target, data, material, scope, draw, dispose, gl, get bytes() { return bytes; },
        get passes() { return passes; }, resetStats() { passes = 0; } };
}
