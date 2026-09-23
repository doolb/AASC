/*
 * PMX 材质的 Toon / 普通直射光切换。
 * 只修改本次加载出的 MMDToonMaterial 实例，不修改 Three.js 内置 shader 或模型文件。
 */
import { Color, Vector3 } from 'three';

const TOON_IRRADIANCE =
    'vec3 irradiance = getGradientIrradiance( geometryNormal, directLight.direction ) * directLight.color;';
const SWITCHABLE_IRRADIANCE = `
    vec3 toonIrradiance = getGradientIrradiance( geometryNormal, directLight.direction );
    vec3 standardIrradiance = vec3( max( dot( geometryNormal, directLight.direction ), 0.0 ) );
    vec3 irradiance = mix( toonIrradiance, standardIrradiance, pmxStandardLighting ) * directLight.color;`;
const UNIFORM_ANCHOR = 'varying vec3 vViewPosition;';
const OUTPUT_ANCHOR = '#include <opaque_fragment>';
const RIM_FRAGMENT = `
    // 只在朝向镜头的轮廓处叠加颜色；独立于普通直射光和 Toon 渐变。
    float pmxRimViewDot = max( dot( normal, normalize( vViewPosition ) ), 0.0 );
    float pmxRimEdge = smoothstep( 0.35, 0.8, 1.0 - pmxRimViewDot );
    vec3 pmxRimViewDir1 = normalize( mat3( viewMatrix ) * pmxRimDirection1 );
    vec3 pmxRimViewDir2 = normalize( mat3( viewMatrix ) * pmxRimDirection2 );
    outgoingLight += pmxRimEdge * (
        pmxRimColor1 * pmxRimIntensity1 * max( dot( normal, pmxRimViewDir1 ), 0.0 ) +
        pmxRimColor2 * pmxRimIntensity2 * max( dot( normal, pmxRimViewDir2 ), 0.0 )
    );
    ${OUTPUT_ANCHOR}`;

function applyRimsToMaterial(material, rimLights = []) {
    for (const index of [0, 1]) {
        const rim = rimLights[index] || {};
        const suffix = index + 1;
        const longitude = Number(rim.direction?.longitude || 0) * Math.PI / 180;
        const latitude = Number(rim.direction?.latitude || 0) * Math.PI / 180;
        material.uniforms[`pmxRimColor${suffix}`].value.set(rim.color || '#ffffff');
        material.uniforms[`pmxRimIntensity${suffix}`].value = rim.enabled === true ? Number(rim.intensity) || 0 : 0;
        material.uniforms[`pmxRimDirection${suffix}`].value.set(
            Math.sin(longitude) * Math.cos(latitude),
            Math.sin(latitude),
            Math.cos(longitude) * Math.cos(latitude)
        );
    }
}

export function preparePmxLightingMaterial(material, pmxToonEnabled) {
    if (!material?.isMMDToonMaterial) return false;
    if (!material.uniforms?.pmxStandardLighting) {
        // 对模型实例的直射光表达式加模式参数；主光和补光会经过同一个 shader 路径。
        if (!material.fragmentShader.includes(TOON_IRRADIANCE)
            || !material.fragmentShader.includes(UNIFORM_ANCHOR)
            || !material.fragmentShader.includes(OUTPUT_ANCHOR)) {
            throw new Error('PMX Toon shader 不包含预期的直射光计算式');
        }
        material.fragmentShader = material.fragmentShader
            .replace(UNIFORM_ANCHOR, `uniform float pmxStandardLighting;
uniform vec3 pmxRimColor1;
uniform vec3 pmxRimColor2;
uniform float pmxRimIntensity1;
uniform float pmxRimIntensity2;
uniform vec3 pmxRimDirection1;
uniform vec3 pmxRimDirection2;
${UNIFORM_ANCHOR}`)
            .replace(TOON_IRRADIANCE, SWITCHABLE_IRRADIANCE)
            .replace(OUTPUT_ANCHOR, RIM_FRAGMENT);
        material.uniforms.pmxStandardLighting = { value: 0 };
        for (const index of [1, 2]) {
            material.uniforms[`pmxRimColor${index}`] = { value: new Color('#ffffff') };
            material.uniforms[`pmxRimIntensity${index}`] = { value: 0 };
            material.uniforms[`pmxRimDirection${index}`] = { value: new Vector3(0, 0, -1) };
        }
        material.needsUpdate = true;
    }
    material.uniforms.pmxStandardLighting.value = pmxToonEnabled === false ? 1 : 0;
    return true;
}

export function setPmxRimLights(root, rimLights) {
    root?.traverse?.((object) => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (material?.uniforms?.pmxRimIntensity1) applyRimsToMaterial(material, rimLights);
        }
    });
}

export function setPmxLightingMode(root, pmxToonEnabled) {
    root?.traverse?.((object) => {
        if (!object.isMesh) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
            if (material?.uniforms?.pmxStandardLighting) {
                material.uniforms.pmxStandardLighting.value = pmxToonEnabled === false ? 1 : 0;
            }
        }
    });
}
