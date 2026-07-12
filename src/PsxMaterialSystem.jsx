import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { GAME_CONFIG } from "../config";

function patchMaterial(material) {
  if (!material || material.userData?.psxPatched || material.userData?.skipGraphicsPatches) {
    return;
  }

  const uniforms = {
    uPsxSnap: { value: GAME_CONFIG.psx.material.vertexSnap },
    uPsxTexDepth: { value: GAME_CONFIG.psx.material.textureBitDepth },
  };

  const originalOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (originalOnBeforeCompile) {
      originalOnBeforeCompile(shader, renderer);
    }

    shader.uniforms.uPsxSnap = uniforms.uPsxSnap;
    shader.uniforms.uPsxTexDepth = uniforms.uPsxTexDepth;

    shader.vertexShader = shader.vertexShader
  .replace(
    "#include <common>",
    `#include <common>
uniform float uPsxSnap;`
  )
  .replace(
    "#include <begin_vertex>",
    `#include <begin_vertex>
if (uPsxSnap > 0.0) {
  float snapScale = 32.0 * uPsxSnap;
  transformed.xyz = floor(transformed.xyz * snapScale) / snapScale;
}`
  );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform float uPsxTexDepth;`
      )
      .replace(
        "#include <dithering_fragment>",
        `float psxLevels = max(2.0, exp2(max(1.0, uPsxTexDepth * 0.25)));
gl_FragColor.rgb = floor(gl_FragColor.rgb * psxLevels) / psxLevels;
#include <dithering_fragment>`
      );
  };

  /**
   * Incluir tipo + toggles PSX: se omitirmos tudo, o cache do programa pode colidir com variantes de luz/sombra.
   */
  material.customProgramCacheKey = () =>
    `psx:${material.type}:snap${GAME_CONFIG.psx.material.vertexSnap}:tex${GAME_CONFIG.psx.material.textureBitDepth}`;

  material.userData.psxPatched = true;
  material.userData.psxUniforms = uniforms;
  material.needsUpdate = true;
}

export function PsxMaterialSystem() {
  const { scene } = useThree();
  const patchedMaterialsRef = useRef(new Set());
  const scanCooldownRef = useRef(0);
  const lastSnapRef = useRef(null);
  const lastTexDepthRef = useRef(null);

  useEffect(() => {
    if (!GAME_CONFIG.psx.enabled || !GAME_CONFIG.psx.material.enabled) {
      return;
    }
    scene.traverse((obj) => {
      if (!obj.isMesh) {
        return;
      }
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach((mat) => {
        if (!mat) return;
        patchMaterial(mat);
        patchedMaterialsRef.current.add(mat);
      });
    });
  }, [scene]);

  useFrame((_, delta) => {
    if (!GAME_CONFIG.psx.enabled || !GAME_CONFIG.psx.material.enabled) {
      return;
    }

    scanCooldownRef.current -= delta;
    if (scanCooldownRef.current <= 0) {
      scanCooldownRef.current = 2;
      scene.traverse((obj) => {
        if (!obj.isMesh) {
          return;
        }
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        materials.forEach((mat) => {
          if (!mat) return;
          patchMaterial(mat);
          patchedMaterialsRef.current.add(mat);
        });
      });
    }

    const snap = GAME_CONFIG.psx.material.vertexSnap;
    const depth = GAME_CONFIG.psx.material.textureBitDepth;
    if (snap === lastSnapRef.current && depth === lastTexDepthRef.current) {
      return;
    }
    lastSnapRef.current = snap;
    lastTexDepthRef.current = depth;
    patchedMaterialsRef.current.forEach((mat) => {
      const uniforms = mat.userData?.psxUniforms;
      if (!uniforms) {
        return;
      }
      uniforms.uPsxSnap.value = snap;
      uniforms.uPsxTexDepth.value = depth;
    });
  });

  return null;
}
