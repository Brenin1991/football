import * as THREE from 'three'
import { AAA_CLASSIC } from './aaaSettings'

type GrassMaterial = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial

/**
 * Adds procedural grass detail without replacing MeshStandardMaterial.
 * This keeps Three.js lighting, shadows, environment reflections and fog.
 */
export function applyAaaGrassShader(material: GrassMaterial) {
  const grass = AAA_CLASSIC.grass
  if (!grass.enabled) return

  material.roughness = grass.roughness
  material.metalness = 0
  material.envMapIntensity = Math.min(material.envMapIntensity, 0.3)

  const previousCompile = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previousCompile(shader, renderer)

    Object.assign(shader.uniforms, {
      uGrassBladeScale: { value: grass.bladeScale },
      uGrassBladeAspect: { value: grass.bladeAspect },
      uGrassClumpScale: { value: grass.clumpScale },
      uGrassRoughness: { value: grass.roughness },
      uGrassRoughnessVariation: { value: grass.roughnessVariation },
      uGrassMicroNormalStrength: { value: grass.microNormalStrength },
      uGrassStripeWidth: { value: grass.mowingStripeWidth },
      uGrassStripeRoughness: { value: grass.mowingRoughnessVariation },
      uGrassFadeStart: { value: grass.distanceFadeStart },
      uGrassFadeEnd: { value: grass.distanceFadeEnd },
    })

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGrassWorldPosition;`,
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vGrassWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGrassWorldPosition;
uniform float uGrassBladeScale;
uniform float uGrassBladeAspect;
uniform float uGrassClumpScale;
uniform float uGrassRoughness;
uniform float uGrassRoughnessVariation;
uniform float uGrassMicroNormalStrength;
uniform float uGrassStripeWidth;
uniform float uGrassStripeRoughness;
uniform float uGrassFadeStart;
uniform float uGrassFadeEnd;

float grassHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float grassNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(grassHash(i), grassHash(i + vec2(1.0, 0.0)), f.x),
    mix(grassHash(i + vec2(0.0, 1.0)), grassHash(i + vec2(1.0)), f.x),
    f.y
  );
}

float grassBladeHeight(vec2 worldPosition) {
  vec2 bladePosition = worldPosition * vec2(
    uGrassBladeScale,
    uGrassBladeScale / max(uGrassBladeAspect, 0.001)
  );
  float fibers = grassNoise(bladePosition + 73.2);
  float crossedFibers = grassNoise(bladePosition.yx * vec2(0.37, 1.91) + 19.4);
  float clumps = grassNoise(worldPosition * uGrassClumpScale + 31.7);
  return mix(fibers, crossedFibers, 0.28) * mix(0.72, 1.0, clumps);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
vec2 grassPosition = vGrassWorldPosition.xz;
float grassBladeValue = grassBladeHeight(grassPosition);
float grassPixelFootprint =
  length(fwidth(grassPosition)) * max(uGrassBladeScale, 0.001);
float grassMicroFade = 1.0 - smoothstep(
  uGrassFadeStart,
  uGrassFadeEnd,
  grassPixelFootprint
);

float grassStripeWave = sin(
  (grassPosition.y / max(uGrassStripeWidth, 0.001)) * 3.14159265
);
float grassStripeEdge = max(fwidth(grassStripeWave), 0.001);
float grassStripe = smoothstep(-grassStripeEdge, grassStripeEdge, grassStripeWave);
grassStripe = grassStripe * 2.0 - 1.0;

// The original albedo is never changed. It is sampled only to keep painted
// white markings smooth and free of procedural blade normals.
vec3 grassOriginalColor = diffuseColor.rgb;
float grassLuma = dot(grassOriginalColor, vec3(0.2126, 0.7152, 0.0722));
float grassChroma =
  max(grassOriginalColor.r, max(grassOriginalColor.g, grassOriginalColor.b)) -
  min(grassOriginalColor.r, min(grassOriginalColor.g, grassOriginalColor.b));
float grassLineMask =
  smoothstep(0.38, 0.82, grassLuma) *
  (1.0 - smoothstep(0.08, 0.3, grassChroma));`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float grassProceduralRoughness = clamp(
  uGrassRoughness +
  (grassBladeValue - 0.5) * uGrassRoughnessVariation * grassMicroFade +
  grassStripe * uGrassStripeRoughness,
  0.0,
  1.0
);
roughnessFactor = mix(
  grassProceduralRoughness,
  roughnessFactor,
  grassLineMask
);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
float grassNormalStep = 0.35 / max(uGrassBladeScale, 0.001);
float grassHeightX = grassBladeHeight(
  grassPosition + vec2(grassNormalStep, 0.0)
);
float grassHeightZ = grassBladeHeight(
  grassPosition + vec2(0.0, grassNormalStep)
);
vec3 grassWorldNormal = normalize(vec3(
  (grassBladeValue - grassHeightX) * 2.4,
  1.0,
  (grassBladeValue - grassHeightZ) * 2.4
));
vec3 grassViewNormal = normalize(mat3(viewMatrix) * grassWorldNormal);
float grassNormalMix =
  uGrassMicroNormalStrength * grassMicroFade * (1.0 - grassLineMask);
normal = normalize(mix(normal, grassViewNormal, grassNormalMix));`,
      )
  }

  const previousCacheKey = material.customProgramCacheKey.bind(material)
  material.customProgramCacheKey = () =>
    `${previousCacheKey()}|aaa-procedural-grass-v2`
  material.needsUpdate = true
}
