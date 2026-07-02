import * as THREE from 'three'
import { PSX_CLASSIC, type PsxTextureProfile } from './psxSettings'
import { applyPsxTextureSettings, applyPsxTexturesToMaterial } from './psxTexture'

type StandardLike = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial

const trackedShaderMaterials: THREE.ShaderMaterial[] = []
const trackedStandardMaterials = new Set<THREE.MeshStandardMaterial>()

const PSX_AFFINE_VERTEX_DECL = `
#ifdef USE_MAP
varying vec3 vPsxMapAff;
#endif
#ifdef USE_EMISSIVEMAP
varying vec3 vPsxEmissiveAff;
#endif
#ifdef USE_ALPHAMAP
varying vec3 vPsxAlphaAff;
#endif
`

const PSX_AFFINE_VERTEX_ASSIGN = `
#ifdef USE_MAP
vPsxMapAff = vec3( vMapUv * gl_Position.w, gl_Position.w );
#endif
#ifdef USE_EMISSIVEMAP
vPsxEmissiveAff = vec3( vEmissiveMapUv * gl_Position.w, gl_Position.w );
#endif
#ifdef USE_ALPHAMAP
vPsxAlphaAff = vec3( vAlphaMapUv * gl_Position.w, gl_Position.w );
#endif
`

const PSX_AFFINE_FRAGMENT_DECL = `
#ifdef USE_MAP
varying vec3 vPsxMapAff;
#endif
#ifdef USE_EMISSIVEMAP
varying vec3 vPsxEmissiveAff;
#endif
#ifdef USE_ALPHAMAP
varying vec3 vPsxAlphaAff;
#endif
uniform float uPsxTime;
uniform float uPsxWobbleAmp;
uniform float uPsxWobbleFreq;
uniform float uPsxWobbleSpeed;

vec2 psxAffUv( vec3 aff ) {
  return aff.xy / max( aff.z, 1e-5 );
}

vec2 psxWobbleUv( vec2 uv ) {
  if ( uPsxWobbleAmp <= 0.0 ) return uv;
  uv += vec2(
    sin( uv.y * uPsxWobbleFreq + uPsxTime * uPsxWobbleSpeed ),
    cos( uv.x * uPsxWobbleFreq + uPsxTime * uPsxWobbleSpeed )
  ) * uPsxWobbleAmp;
  return uv;
}
`

function patchPsxAffineMapping(
  shader: THREE.WebGLProgramParametersWithUniforms,
  profile: Required<PsxTextureProfile>,
) {
  const tex = PSX_CLASSIC.material.texture
  if (!profile.affine && profile.wobble <= 0) return

  const wobbleAmp = tex.wobbleIntensity * profile.wobble * 0.004

  shader.uniforms.uPsxTime = { value: 0 }
  shader.uniforms.uPsxWobbleAmp = { value: wobbleAmp }
  shader.uniforms.uPsxWobbleFreq = { value: tex.wobbleFrequency }
  shader.uniforms.uPsxWobbleSpeed = { value: tex.wobbleSpeed }
  shader.uniforms.uPsxAffineMix = { value: profile.affine ? 1 : 0 }

  shader.vertexShader = shader.vertexShader.replace(
    '#include <common>',
    `#include <common>
${PSX_AFFINE_VERTEX_DECL}`,
  )

  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    `#include <project_vertex>
${PSX_AFFINE_VERTEX_ASSIGN}`,
  )

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
${PSX_AFFINE_FRAGMENT_DECL}
uniform float uPsxAffineMix;

vec2 psxMapSampleUv( vec2 perspectiveUv, vec3 aff ) {
  vec2 affineUv = psxAffUv( aff );
  vec2 uv = mix( perspectiveUv, affineUv, uPsxAffineMix );
  return psxWobbleUv( uv );
}`,
  )

  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#ifdef USE_MAP
  vec2 psxMapUv = psxMapSampleUv( vMapUv, vPsxMapAff );
  vec4 sampledDiffuseColor = texture2D( map, psxMapUv );
  #ifdef DECODE_VIDEO_TEXTURE
    sampledDiffuseColor = sRGBTransferEOTF( sampledDiffuseColor );
  #endif
  diffuseColor *= sampledDiffuseColor;
#endif`,
  )
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <emissivemap_fragment>',
    `#ifdef USE_EMISSIVEMAP
  vec2 psxEmissiveUv = psxMapSampleUv( vEmissiveMapUv, vPsxEmissiveAff );
  vec4 emissiveColor = texture2D( emissiveMap, psxEmissiveUv );
  #ifdef DECODE_VIDEO_TEXTURE_EMISSIVE
    emissiveColor = sRGBTransferEOTF( emissiveColor );
  #endif
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif`,
  )
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <alphamap_fragment>',
    `#ifdef USE_ALPHAMAP
  vec2 psxAlphaUv = psxMapSampleUv( vAlphaMapUv, vPsxAlphaAff );
  diffuseColor.a *= texture2D( alphaMap, psxAlphaUv ).g;
#endif`,
  )
}

function isStandardLike(src: THREE.Material): src is StandardLike {
  return (
    src instanceof THREE.MeshStandardMaterial ||
    src instanceof THREE.MeshPhysicalMaterial
  )
}

/** Extrai propriedades do material GLB original — psx-engine.js */
export function extractOriginalProperties(originalMaterial: THREE.Material) {
  const properties: Record<string, unknown> = {}

  if (!isStandardLike(originalMaterial)) return properties

  if (originalMaterial.map) properties.map = originalMaterial.map
  if (originalMaterial.normalMap) properties.normalMap = originalMaterial.normalMap
  if (originalMaterial.roughnessMap) properties.roughnessMap = originalMaterial.roughnessMap
  if (originalMaterial.metalnessMap) properties.metalnessMap = originalMaterial.metalnessMap
  if (originalMaterial.emissiveMap) properties.emissiveMap = originalMaterial.emissiveMap
  if (originalMaterial.aoMap) properties.aoMap = originalMaterial.aoMap
  if (originalMaterial.color) properties.color = originalMaterial.color.clone()
  if (originalMaterial.emissive) properties.emissive = originalMaterial.emissive.clone()

  for (const key of [
    'roughness',
    'metalness',
    'envMapIntensity',
    'emissiveIntensity',
    'opacity',
    'transparent',
  ] as const) {
    const value = originalMaterial[key]
    if (value !== undefined && value !== null) {
      properties[key] = value
    }
  }

  return properties
}

function resolveTextureProfile(overrides?: PsxTextureProfile): Required<PsxTextureProfile> {
  const tex = PSX_CLASSIC.material.texture
  return {
    affine: overrides?.affine ?? tex.affine,
    wobble: overrides?.wobble ?? 1,
  }
}

function textureProfileCacheKey(profile: Required<PsxTextureProfile>) {
  return `${profile.affine ? 1 : 0}_${profile.wobble}`
}

/** Acabamento matte PSX — sem reflexo/metal */
export function patchPsxStandardMaterial(
  material: THREE.MeshStandardMaterial,
  snap: number = PSX_CLASSIC.material.vertexSnap,
  textureProfile?: PsxTextureProfile,
) {
  const profile = resolveTextureProfile(textureProfile)
  material.userData.psxTextureProfile = profile
  material.flatShading = PSX_CLASSIC.material.flatShading
  material.fog = true

  material.metalness = 0
  material.roughness = 1
  material.metalnessMap = null
  material.roughnessMap = null
  material.envMap = null
  material.envMapIntensity = 0

  if (snap > 0) {
    material.customProgramCacheKey = () => {
      const t = PSX_CLASSIC.material.texture
      return `psx_${snap}_${t.maxSize}_${textureProfileCacheKey(profile)}_${t.wobbleIntensity}`
    }
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uPsxSnap = { value: snap }
      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
uniform float uPsxSnap;`,
      )
      shader.vertexShader = shader.vertexShader.replace(
        '#include <project_vertex>',
        `#include <project_vertex>
gl_Position.xy = floor(gl_Position.xy * uPsxSnap) / uPsxSnap;`,
      )
      patchPsxAffineMapping(shader, profile)
      material.userData.psxUniforms = shader.uniforms
    }
  } else {
    material.customProgramCacheKey = () => {
      const t = PSX_CLASSIC.material.texture
      return `psx_nosnap_${t.maxSize}_${textureProfileCacheKey(profile)}_${t.wobbleIntensity}`
    }
    material.onBeforeCompile = (shader) => {
      patchPsxAffineMapping(shader, profile)
      material.userData.psxUniforms = shader.uniforms
    }
  }

  trackedStandardMaterials.add(material)

  material.needsUpdate = true
}

export type PsxStandardOptions = Partial<THREE.MeshStandardMaterialParameters> & {
  vertexSnap?: number
  textureProfile?: PsxTextureProfile
}

export function toPsxStandard(
  src: THREE.Material,
  opts: PsxStandardOptions = {},
): THREE.MeshStandardMaterial {
  const { vertexSnap, textureProfile, ...materialOpts } = opts
  const mat = new THREE.MeshStandardMaterial()

  if (isStandardLike(src)) {
    mat.name = src.name
    mat.color.copy(src.color)
    mat.emissive.copy(src.emissive)
    mat.emissiveIntensity = src.emissiveIntensity
    mat.roughness = src.roughness
    mat.metalness = src.metalness
    mat.opacity = src.opacity
    mat.transparent = src.transparent
    mat.alphaTest = src.alphaTest
    mat.side = src.side
    mat.map = src.map
    mat.normalMap = src.normalMap
    mat.aoMap = src.aoMap
    mat.emissiveMap = src.emissiveMap
    mat.alphaMap = src.alphaMap
    if (src.aoMap) mat.aoMapIntensity = src.aoMapIntensity
    if (src.normalMap) mat.normalScale.set(0.15, 0.15)
  }

  Object.assign(mat, materialOpts)
  applyPsxTexturesToMaterial(mat)
  patchPsxStandardMaterial(
    mat,
    vertexSnap ?? PSX_CLASSIC.material.vertexSnap,
    textureProfile,
  )
  return mat
}

/** Shader PSX completo para meshes estáticos (campo, props) */
export function createPsxShaderMaterial(
  originalProperties: Record<string, unknown> = {},
  fog?: THREE.Fog | THREE.FogExp2 | null,
): THREE.ShaderMaterial {
  const vertexShader = /* glsl */ `
    varying vec2 vUv;
    varying vec3 vAffineUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    uniform float time;

    void main() {
      vUv = uv;
      vec3 jitteredPosition = position;
      jitteredPosition.xy = floor(jitteredPosition.xy * 10.0) / 10.0;
      jitteredPosition.x += sin(position.y * 10.0 + time * 500.0) * 0.008;
      jitteredPosition.y += cos(position.x * 10.0 + time * 500.0) * 0.008;
      vPosition = (modelViewMatrix * vec4(jitteredPosition, 1.0)).xyz;
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(jitteredPosition, 1.0);
      vAffineUv = vec3(uv * gl_Position.w, gl_Position.w);
    }
  `

  const fragmentShader = /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    varying vec3 vAffineUv;
    varying vec3 vPosition;
    varying vec3 vNormal;
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform vec3 lightDirection;
    uniform vec3 lightColor;
    uniform vec3 ambientLightColor;
    uniform float time;
    uniform float uColorDepth;
    uniform float uPsxWobbleAmp;
    uniform float uPsxWobbleFreq;
    uniform float uPsxWobbleSpeed;
    uniform float roughness;
    uniform float metalness;
    uniform vec3 emissive;
    uniform float emissiveIntensity;
    uniform float opacity;

    const float dither[16] = float[16](
      0.0,  8.0,  2.0, 10.0,
      12.0, 4.0, 14.0,  6.0,
      3.0, 11.0,  1.0,  9.0,
      15.0, 7.0, 13.0,  5.0
    );

    void main() {
      vec2 uv = vAffineUv.xy / max(vAffineUv.z, 1e-5);
      uv += vec2(
        sin(uv.y * uPsxWobbleFreq + time * uPsxWobbleSpeed),
        cos(uv.x * uPsxWobbleFreq + time * uPsxWobbleSpeed)
      ) * uPsxWobbleAmp;

      vec4 baseColor = texture2D(tDiffuse, uv);
      vec3 normal = normalize(vNormal);
      vec3 lightDir = normalize(lightDirection);
      float diffuse = max(dot(normal, lightDir), 0.3);
      vec3 lighting = lightColor * diffuse + ambientLightColor;
      vec3 finalColor = baseColor.rgb * lighting + emissive * emissiveIntensity;

      int x = int(mod(gl_FragCoord.x, 4.0));
      int y = int(mod(gl_FragCoord.y, 4.0));
      int index = x + y * 4;
      float threshold = dither[index] / 16.0;
      finalColor = floor(finalColor * uColorDepth + threshold) / uColorDepth;

      float distanceToCamera = length(vPosition);
      float fogFactor = smoothstep(fogNear * 0.6, fogFar, distanceToCamera);
      gl_FragColor = mix(vec4(finalColor, opacity), vec4(fogColor, 1.0), fogFactor);
    }
  `

  const fogColor = fog instanceof THREE.Fog ? fog.color : new THREE.Color(0x8aafcc)
  const fogNear = fog instanceof THREE.Fog ? fog.near : 18
  const fogFar = fog instanceof THREE.Fog ? fog.far : 55
  const texCfg = PSX_CLASSIC.material.texture

  const material = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: {
        value: applyPsxTextureSettings(originalProperties.map as THREE.Texture | undefined),
      },
      uColorDepth: { value: PSX_CLASSIC.post.colorDepth },
      fogColor: { value: fogColor },
      fogNear: { value: fogNear },
      fogFar: { value: fogFar },
      lightDirection: { value: new THREE.Vector3(0.4, 1, 0.3).normalize() },
      lightColor: { value: new THREE.Color(0xfff4e0) },
      ambientLightColor: { value: new THREE.Color(0x8899aa) },
      time: { value: 0 },
      uPsxWobbleAmp: { value: texCfg.wobbleIntensity * 0.004 },
      uPsxWobbleFreq: { value: texCfg.wobbleFrequency },
      uPsxWobbleSpeed: { value: texCfg.wobbleSpeed },
      roughness: { value: (originalProperties.roughness as number) ?? 0.85 },
      metalness: { value: (originalProperties.metalness as number) ?? 0.05 },
      emissive: {
        value:
          (originalProperties.emissive as THREE.Color)?.clone?.() ??
          new THREE.Color(0x000000),
      },
      emissiveIntensity: { value: (originalProperties.emissiveIntensity as number) ?? 0 },
      opacity: { value: (originalProperties.opacity as number) ?? 1 },
    },
    vertexShader,
    fragmentShader,
    fog: false,
  })

  trackedShaderMaterials.push(material)
  return material
}

export function updatePsxShaderTime(time: number) {
  for (const mat of trackedShaderMaterials) {
    if (mat.uniforms.time) mat.uniforms.time.value = time
  }
  for (const mat of trackedStandardMaterials) {
    const uniforms = mat.userData.psxUniforms as
      | { uPsxTime?: { value: number } }
      | undefined
    if (uniforms?.uPsxTime) uniforms.uPsxTime.value = time
  }
}

/** cast/receive shadow + ajustes para SkinnedMesh e cabelo (alphaTest) */
export function applyMeshShadows(
  root: THREE.Object3D,
  opts: { cast?: boolean; receive?: boolean } = {},
) {
  const cast = opts.cast ?? true
  const receive = opts.receive ?? true

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return

    mesh.castShadow = cast
    mesh.receiveShadow = receive

    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      mesh.frustumCulled = false
    }

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue
      if (mat.alphaTest > 0) {
        mat.depthWrite = true
        mat.shadowSide = THREE.DoubleSide
      }
    }
  })
}

export function applyPsxMaterialToMesh(
  mesh: THREE.Mesh,
  useShader = false,
  vertexSnap: number = PSX_CLASSIC.material.vertexSnap,
  textureProfile?: PsxTextureProfile,
) {
  mesh.castShadow = true
  mesh.receiveShadow = true

  const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const converted = sources.map((src) => {
    if (!(src instanceof THREE.Material)) return src
    if (useShader && src instanceof THREE.MeshStandardMaterial && src.map) {
      return createPsxShaderMaterial(extractOriginalProperties(src))
    }
    return toPsxStandard(src, { vertexSnap, textureProfile })
  })
  mesh.material = converted.length === 1 ? converted[0] : converted
}
