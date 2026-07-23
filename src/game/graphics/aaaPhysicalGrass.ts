import * as THREE from 'three'
import { AAA_CLASSIC } from './aaaSettings'

type GrassMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial

const SHELL_MARKER = '__aaaPhysicalGrassShell'

function createShellMaterial(source: GrassMaterial, layer: number, height: number) {
  const cfg = AAA_CLASSIC.grass.physical
  const material = source.clone()

  material.name = `${source.name || 'field_area'}_grass_shell_${layer.toFixed(2)}`
  material.transparent = false
  material.alphaTest = cfg.alphaTest
  material.alphaToCoverage = true
  material.depthWrite = true
  material.depthTest = true
  material.side = THREE.DoubleSide
  material.metalness = 0
  material.roughness = AAA_CLASSIC.grass.roughness
  material.dithering = true

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uGrassShellHeight: { value: height },
      uGrassShellLayer: { value: layer },
      uGrassShellBladeScale: { value: cfg.bladeScale },
      uGrassShellBladeAspect: { value: cfg.bladeAspect },
      uGrassShellDensity: { value: cfg.density },
      uGrassShellFadeStart: { value: cfg.fadeStart },
      uGrassShellFadeEnd: { value: cfg.fadeEnd },
      uGrassShellAlphaTest: { value: cfg.alphaTest },
    })

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uGrassShellHeight;
varying vec3 vGrassShellWorldPosition;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
transformed += objectNormal * uGrassShellHeight;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vGrassShellWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGrassShellWorldPosition;
uniform float uGrassShellLayer;
uniform float uGrassShellBladeScale;
uniform float uGrassShellBladeAspect;
uniform float uGrassShellDensity;
uniform float uGrassShellFadeStart;
uniform float uGrassShellFadeEnd;
uniform float uGrassShellAlphaTest;

float grassShellHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float grassShellNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(grassShellHash(i), grassShellHash(i + vec2(1.0, 0.0)), f.x),
    mix(
      grassShellHash(i + vec2(0.0, 1.0)),
      grassShellHash(i + vec2(1.0)),
      f.x
    ),
    f.y
  );
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec2 grassShellPosition = vGrassShellWorldPosition.xz * vec2(
  uGrassShellBladeScale,
  uGrassShellBladeScale / max(uGrassShellBladeAspect, 0.001)
);
float grassShellPrimary = grassShellNoise(grassShellPosition + 41.3);
float grassShellCross = grassShellNoise(
  grassShellPosition.yx * vec2(0.41, 1.73) + 91.7
);
float grassShellClump = grassShellNoise(
  vGrassShellWorldPosition.xz * 2.6 + 13.8
);
float grassShellBlade = mix(grassShellPrimary, grassShellCross, 0.24);
grassShellBlade *= mix(0.72, 1.0, grassShellClump);

float grassShellDistance = distance(cameraPosition, vGrassShellWorldPosition);
float grassShellVisibility = 1.0 - smoothstep(
  uGrassShellFadeStart,
  uGrassShellFadeEnd,
  grassShellDistance
);
if (uGrassShellLayer > grassShellVisibility) discard;

float grassShellThreshold = mix(
  1.0 - uGrassShellDensity,
  0.94,
  pow(uGrassShellLayer, 1.22)
);
float grassShellAa = max(fwidth(grassShellBlade) * 1.35, 0.015);
float grassShellCoverage = smoothstep(
  grassShellThreshold - grassShellAa,
  grassShellThreshold + grassShellAa,
  grassShellBlade
);
diffuseColor.a *= grassShellCoverage;
if (diffuseColor.a < uGrassShellAlphaTest) discard;`,
      )
  }

  material.customProgramCacheKey = () =>
    `aaa-physical-grass-shell-v1:${layer.toFixed(3)}`
  material.needsUpdate = true
  return material
}

/**
 * Builds volumetric shell grass above field_area. The original field remains
 * the base layer; these meshes only add physical depth and blade silhouettes.
 */
export function addAaaPhysicalGrass(fieldMesh: THREE.Mesh) {
  const cfg = AAA_CLASSIC.grass.physical
  const parent = fieldMesh.parent
  if (!cfg.enabled || !parent || fieldMesh.userData[SHELL_MARKER]) return

  const sourceMaterials = Array.isArray(fieldMesh.material)
    ? fieldMesh.material
    : [fieldMesh.material]
  if (
    sourceMaterials.some(
      (material) =>
        !(
          material instanceof THREE.MeshStandardMaterial ||
          material instanceof THREE.MeshPhysicalMaterial
        ),
    )
  ) {
    return
  }

  fieldMesh.userData[SHELL_MARKER] = true

  for (let index = 1; index <= cfg.shellCount; index += 1) {
    const layer = index / cfg.shellCount
    const shellHeight = cfg.height * layer
    const shellMaterials = (sourceMaterials as GrassMaterial[]).map((material) =>
      createShellMaterial(material, layer, shellHeight),
    )
    const shell = new THREE.Mesh(
      fieldMesh.geometry,
      shellMaterials.length === 1 ? shellMaterials[0] : shellMaterials,
    )

    shell.name = `${SHELL_MARKER}_${index}`
    shell.position.copy(fieldMesh.position)
    shell.quaternion.copy(fieldMesh.quaternion)
    shell.scale.copy(fieldMesh.scale)
    shell.renderOrder = fieldMesh.renderOrder + index
    shell.castShadow = false
    shell.receiveShadow = true
    shell.frustumCulled = fieldMesh.frustumCulled
    shell.userData[SHELL_MARKER] = true
    shell.raycast = () => undefined
    parent.add(shell)
  }
}
