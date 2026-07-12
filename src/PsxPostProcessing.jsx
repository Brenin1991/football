import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  ACESFilmicToneMapping,
  MathUtils,
  PCFShadowMap,
  Quaternion,
  Vector2,
  Vector3,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SSRPass } from "three/examples/jsm/postprocessing/SSRPass.js";
import { TAARenderPass } from "three/examples/jsm/postprocessing/TAARenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { GAME_CONFIG } from "../config";

const _mbDq = new Quaternion();
const _mbAxis = new Vector3();
const _mbDpos = new Vector3();
const _mbInvQ = new Quaternion();
const _mbBlur = new Vector2();

function clampPostComposerScale(scale) {
  const n = Number(scale);
  if (!Number.isFinite(n)) return 1;
  return Math.min(1, Math.max(0.25, n));
}

/** Tamanho lógico passado a `EffectComposer#setSize` (Three multiplica pelo DPR nos RTs). */
function postComposerLogicalSize(canvasW, canvasH, scale) {
  const s = clampPostComposerScale(scale);
  return {
    width: Math.max(2, Math.round(canvasW * s)),
    height: Math.max(2, Math.round(canvasH * s)),
  };
}

const ROAD_OBJECT_NAME_RE = /(^|[^a-z0-9])road([_\-\s]?\d+)?($|[^a-z0-9])/i;

function includesToken(value, tokens) {
  const v = String(value ?? "").toLowerCase();
  for (let i = 0; i < tokens.length; i++) {
    if (v.includes(tokens[i])) return true;
  }
  return false;
}

function materialUsesAlpha(mat) {
  if (!mat) return false;
  if (mat.transparent === true) return true;
  if (typeof mat.opacity === "number" && mat.opacity < 0.999) return true;
  if (mat.alphaMap) return true;
  if (mat.alphaTest && mat.alphaTest > 0) return true;
  return false;
}

function meshUsesAlphaMaterial(obj) {
  if (!obj) return false;
  if (Array.isArray(obj.material)) {
    for (let i = 0; i < obj.material.length; i++) {
      if (materialUsesAlpha(obj.material[i])) return true;
    }
    return false;
  }
  return materialUsesAlpha(obj.material);
}

function collectRoadMeshes(scene, tokens) {
  const roads = [];
  scene.traverse((obj) => {
    if (!obj?.isMesh || !obj.geometry) return;
    if (meshUsesAlphaMaterial(obj)) return;
    const name = String(obj.name ?? "");
    if (ROAD_OBJECT_NAME_RE.test(name) || includesToken(name, tokens)) {
      roads.push(obj);
      return;
    }
    if (Array.isArray(obj.material)) {
      for (let i = 0; i < obj.material.length; i++) {
        if (includesToken(obj.material[i]?.name, tokens)) {
          roads.push(obj);
          return;
        }
      }
      return;
    }
    if (includesToken(obj.material?.name, tokens)) {
      roads.push(obj);
    }
  });
  return roads;
}

function mapAoOutput(mode) {
  switch (String(mode ?? "").toLowerCase()) {
    case "ssao":
      return SSAOPass.OUTPUT.SSAO;
    case "blur":
      return SSAOPass.OUTPUT.Blur;
    case "depth":
      return SSAOPass.OUTPUT.Depth;
    case "normal":
      return SSAOPass.OUTPUT.Normal;
    default:
      return SSAOPass.OUTPUT.Default;
  }
}

export function PsxPostProcessing({
  isRaining = false,
  daylight = 1,
  visualEnvironmentRef = null,
  lightningFlashRef = null,
  psxOverrides = null,
}) {
  const { gl, scene, camera, size, viewport } = useThree();
  const composerRef = useRef(null);
  const taaPassRef = useRef(null);
  const renderPassRef = useRef(null);
  const aoPassRef = useRef(null);
  const ssrPassRef = useRef(null);
  const pixelPassRef = useRef(null);
  const rgbSplitPassRef = useRef(null);
  const colorPassRef = useRef(null);
  const contactShadowPassRef = useRef(null);
  const screenLightPassRef = useRef(null);
  const chromaticDirtPassRef = useRef(null);
  const bloomFogPassRef = useRef(null);
  const colorGradePassRef = useRef(null);
  const sharpenPassRef = useRef(null);
  const bloomPassRef = useRef(null);
  const vignettePassRef = useRef(null);
  const motionBlurPassRef = useRef(null);
  const filmGrainPassRef = useRef(null);
  const prevMbQuatRef = useRef(null);
  const prevMbPosRef = useRef(null);
  const previousToneMappingRef = useRef(null);
  const previousExposureRef = useRef(null);
  const previousShadowMapTypeRef = useRef(null);
  const aoAlphaMeshesRef = useRef([]);
  const aoAlphaScanCooldownRef = useRef(0);
  const roadMeshCacheRef = useRef([]);
  const roadScanCooldownRef = useRef(0);
  const aoAlphaScannedOnceRef = useRef(false);
  const roadMeshScannedOnceRef = useRef(false);
  const prevCamPos3Ref = useRef(null);
  const prevCamQuatRef = useRef(null);
  const lastPsxUniformKeyRef = useRef("");
  /** Último `postComposerResolutionScale` aplicado — lido sempre de `GAME_CONFIG` (evita closure “congelado”). */
  const composerResolutionScaleAppliedRef = useRef(null);
  const {
    enabled,
    pixelSize,
    colorDepth,
    ditherStrength,
    vignette,
    rgbShift,
    rgbShiftAngle,
    bloomNightOnly,
    bloomStrength,
    bloomRadius,
    bloomThreshold,
    hdrExposure,
    saturation,
    contrast,
    brightness,
    gamma,
    colorCorrection,
    colorMultiply,
    sharpen,
    hueShift,
    tintColor,
    tintStrength,
  } = GAME_CONFIG.psx;

  const passes = useMemo(() => {
    const pixelationShader = {
      uniforms: {
        tDiffuse: { value: null },
        /** Atualizado em `useLayoutEffect` com `cw * dpr` — não depender de `size` evita recriar o composer a cada resize. */
        resolution: { value: new Vector2(2, 2) },
        pixelSize: { value: pixelSize },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float pixelSize;
        varying vec2 vUv;
        void main() {
          vec2 dxy = max(vec2(1.0), vec2(pixelSize)) / resolution;
          vec2 coord = dxy * floor(vUv / dxy);
          gl_FragColor = texture2D(tDiffuse, coord);
        }
      `,
    };

    const colorDepthDitherShader = {
      uniforms: {
        tDiffuse: { value: null },
        colorDepth: { value: colorDepth },
        ditherStrength: { value: ditherStrength },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float colorDepth;
        uniform float ditherStrength;
        varying vec2 vUv;
        const float bayer4[16] = float[16](
           0.0,  8.0,  2.0, 10.0,
          12.0,  4.0, 14.0,  6.0,
           3.0, 11.0,  1.0,  9.0,
          15.0,  7.0, 13.0,  5.0
        );
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          int x = int(mod(gl_FragCoord.x, 4.0));
          int y = int(mod(gl_FragCoord.y, 4.0));
          int i = x + y * 4;
          float threshold = (bayer4[i] / 16.0 - 0.5) * ditherStrength;
          vec3 q = floor((c.rgb + threshold) * colorDepth) / colorDepth;
          gl_FragColor = vec4(clamp(q, 0.0, 1.0), c.a);
        }
      `,
    };

    const rgbSplitShader = {
      uniforms: {
        tDiffuse: { value: null },
        amount: { value: rgbShift },
        angle: { value: rgbShiftAngle },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float amount;
        uniform float angle;
        varying vec2 vUv;
        void main() {
          vec2 dir = vec2(cos(angle), sin(angle)) * amount;
          vec4 cR = texture2D(tDiffuse, vUv + dir);
          vec4 cG = texture2D(tDiffuse, vUv);
          vec4 cB = texture2D(tDiffuse, vUv - dir);
          gl_FragColor = vec4(cR.r, cG.g, cB.b, cG.a);
        }
      `,
    };

    const vignetteShader = {
      uniforms: {
        tDiffuse: { value: null },
        vignette: { value: vignette },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float vignette;
        varying vec2 vUv;
        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          vec2 uv = vUv - 0.5;
          float vig = smoothstep(0.8, 0.15, dot(uv, uv));
          col.rgb *= mix(1.0, vig, vignette);
          gl_FragColor = col;
        }
      `,
    };

    const motionBlurShader = {
      uniforms: {
        tDiffuse: { value: null },
        uDirNorm: { value: new Vector2(0, 1) },
        uStepUv: { value: 0 },
        uMix: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uDirNorm;
        uniform float uStepUv;
        uniform float uMix;
        varying vec2 vUv;
        void main() {
          vec3 c0 = texture2D(tDiffuse, vUv).rgb;
          if (uMix < 0.001 || uStepUv < 1e-6) {
            gl_FragColor = vec4(c0, 1.0);
            return;
          }
          vec2 s = uDirNorm * uStepUv;
          vec3 acc = c0;
          acc += texture2D(tDiffuse, vUv + s * 1.0).rgb;
          acc += texture2D(tDiffuse, vUv - s * 1.0).rgb;
          acc += texture2D(tDiffuse, vUv + s * 2.0).rgb;
          acc += texture2D(tDiffuse, vUv - s * 2.0).rgb;
          acc += texture2D(tDiffuse, vUv + s * 3.0).rgb;
          acc += texture2D(tDiffuse, vUv - s * 3.0).rgb;
          acc /= 7.0;
          gl_FragColor = vec4(mix(c0, acc, uMix), 1.0);
        }
      `,
    };

    const colorGradeShader = {
      uniforms: {
        tDiffuse: { value: null },
        hdrExposure: { value: hdrExposure },
        saturation: { value: saturation },
        contrast: { value: contrast },
        brightness: { value: brightness },
        gamma: { value: gamma },
        colorCorrection: { value: [1, 1, 1] },
        colorMultiply: { value: [1, 1, 1] },
        hueShift: { value: hueShift },
        tintColor: { value: [0.784, 0.831, 1.0] },
        tintStrength: { value: tintStrength },
        lutEnabled: { value: 0 },
        lutAmount: { value: 1 },
        lutDayWeight: { value: 1 },
        lutNightWeight: { value: 0 },
        lutRainWeight: { value: 0 },
        lutDayLift: { value: [0, 0, 0] },
        lutDayGamma: { value: [1, 1, 1] },
        lutDayGain: { value: [1, 1, 1] },
        lutNightLift: { value: [0, 0, 0] },
        lutNightGamma: { value: [1, 1, 1] },
        lutNightGain: { value: [1, 1, 1] },
        lutRainLift: { value: [0, 0, 0] },
        lutRainGamma: { value: [1, 1, 1] },
        lutRainGain: { value: [1, 1, 1] },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float hdrExposure;
        uniform float saturation;
        uniform float contrast;
        uniform float brightness;
        uniform float gamma;
        uniform vec3 colorCorrection;
        uniform vec3 colorMultiply;
        uniform float hueShift;
        uniform vec3 tintColor;
        uniform float tintStrength;
        uniform float lutEnabled;
        uniform float lutAmount;
        uniform float lutDayWeight;
        uniform float lutNightWeight;
        uniform float lutRainWeight;
        uniform vec3 lutDayLift;
        uniform vec3 lutDayGamma;
        uniform vec3 lutDayGain;
        uniform vec3 lutNightLift;
        uniform vec3 lutNightGamma;
        uniform vec3 lutNightGain;
        uniform vec3 lutRainLift;
        uniform vec3 lutRainGamma;
        uniform vec3 lutRainGain;
        varying vec2 vUv;
        vec3 hueRotate(vec3 color, float angle) {
          float s = sin(angle);
          float c = cos(angle);
          mat3 m = mat3(
            vec3(0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928),
            vec3(0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283),
            vec3(0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072)
          );
          return clamp(m * color, 0.0, 1.0);
        }
        vec3 applyLutGrade(vec3 color, vec3 lift, vec3 gammaV, vec3 gain) {
          vec3 lifted = max(color + lift, vec3(0.0));
          vec3 curved = pow(lifted, max(gammaV, vec3(0.001)));
          return clamp(curved * gain, 0.0, 1.0);
        }
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          c.rgb *= max(hdrExposure, 0.0);
          float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          c.rgb = mix(vec3(luma), c.rgb, saturation);
          c.rgb = (c.rgb - 0.5) * contrast + 0.5;
          c.rgb += brightness;
          c.rgb = hueRotate(c.rgb, hueShift);
          c.rgb = mix(c.rgb, c.rgb * tintColor, tintStrength);
          c.rgb = pow(max(c.rgb, vec3(0.0)), max(colorCorrection, vec3(0.001)));
          c.rgb *= colorMultiply;
          if (lutEnabled > 0.5) {
            vec3 dayCol = applyLutGrade(c.rgb, lutDayLift, lutDayGamma, lutDayGain);
            vec3 nightCol = applyLutGrade(c.rgb, lutNightLift, lutNightGamma, lutNightGain);
            vec3 rainCol = applyLutGrade(c.rgb, lutRainLift, lutRainGamma, lutRainGain);
            float wSum = max(1e-4, lutDayWeight + lutNightWeight + lutRainWeight);
            vec3 lutMix = (dayCol * lutDayWeight + nightCol * lutNightWeight + rainCol * lutRainWeight) / wSum;
            c.rgb = mix(c.rgb, lutMix, clamp(lutAmount, 0.0, 1.0));
          }
          c.rgb = pow(max(c.rgb, 0.0), vec3(1.0 / max(0.001, gamma)));
          gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
        }
      `,
    };

    const sharpenShader = {
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new Vector2(2, 2) },
        amount: { value: sharpen },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float amount;
        varying vec2 vUv;
        void main() {
          vec2 texel = 1.0 / resolution;
          vec3 center = texture2D(tDiffuse, vUv).rgb;
          vec3 north = texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb;
          vec3 south = texture2D(tDiffuse, vUv - vec2(0.0, texel.y)).rgb;
          vec3 east = texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb;
          vec3 west = texture2D(tDiffuse, vUv - vec2(texel.x, 0.0)).rgb;
          vec3 laplace = (north + south + east + west) - 4.0 * center;
          vec3 sharpened = center - laplace * amount;
          gl_FragColor = vec4(clamp(sharpened, 0.0, 1.0), 1.0);
        }
      `,
    };

    const screenSpaceLightShader = {
      uniforms: {
        tDiffuse: { value: null },
        intensity: { value: 0.22 },
        threshold: { value: 0.62 },
        shadowStrength: { value: 0.18 },
        radius: { value: 0.28 },
        center: { value: new Vector2(0.5, 0.42) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float intensity;
        uniform float threshold;
        uniform float shadowStrength;
        uniform float radius;
        uniform vec2 center;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
          float highMask = smoothstep(threshold, 1.0, luma);
          float lowMask = smoothstep(0.0, threshold, luma);
          float dist = distance(vUv, center);
          float radial = 1.0 - smoothstep(0.0, max(0.01, radius), dist);
          float lightBoost = highMask * (0.35 + radial * 0.65) * intensity;
          float shadowBoost = (1.0 - lowMask) * shadowStrength * (0.5 + (1.0 - radial) * 0.5);
          vec3 lit = c.rgb + c.rgb * lightBoost;
          vec3 shadowed = lit * (1.0 - shadowBoost);
          gl_FragColor = vec4(clamp(shadowed, 0.0, 1.0), c.a);
        }
      `,
    };

    const bloomFogShader = {
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new Vector2(2, 2) },
        threshold: { value: 0.62 },
        softKnee: { value: 0.22 },
        glowStrength: { value: 0.9 },
        fogTintMix: { value: 0.7 },
        radiusPx: { value: 3.5 },
        outerRadiusMul: { value: 2.2 },
        veilStrength: { value: 0.08 },
        fogColor: { value: new Vector3(0.75, 0.75, 0.75) },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float threshold;
        uniform float softKnee;
        uniform float glowStrength;
        uniform float fogTintMix;
        uniform float radiusPx;
        uniform float outerRadiusMul;
        uniform float veilStrength;
        uniform vec3 fogColor;
        varying vec2 vUv;

        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

        vec3 sampleBright(vec2 uv) {
          vec3 c = texture2D(tDiffuse, uv).rgb;
          float y = luma(c);
          float k = max(0.0001, softKnee);
          float m = smoothstep(threshold - k, threshold + k, y);
          return c * m;
        }

        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          vec2 texel = vec2(1.0) / max(resolution, vec2(2.0));
          vec2 r1 = texel * max(radiusPx, 0.0);
          vec2 r2 = r1 * max(1.1, outerRadiusMul);

          // kernel radial denso para evitar "espinhos" direcionais.
          vec3 acc = vec3(0.0);
          float w = 0.0;
          acc += sampleBright(vUv) * 0.14; w += 0.14;
          const int DIRS = 24;
          const float TAU = 6.28318530718;
          for (int i = 0; i < DIRS; i++) {
            float a = (float(i) / float(DIRS)) * TAU;
            vec2 dir = vec2(cos(a), sin(a));
            vec2 o1 = vec2(dir.x * r1.x, dir.y * r1.y);
            vec2 o2 = vec2(dir.x * r2.x, dir.y * r2.y);
            acc += sampleBright(vUv + o1) * 0.030;
            acc += sampleBright(vUv + o2) * 0.016;
            w += 0.046;
          }

          acc /= max(w, 1e-5);

          vec3 glow = mix(acc, fogColor * luma(acc), clamp(fogTintMix, 0.0, 1.0));
          vec3 outCol = src.rgb + glow * max(0.0, glowStrength);
          outCol = mix(outCol, mix(outCol, fogColor, 0.5), clamp(veilStrength, 0.0, 1.0));
          gl_FragColor = vec4(clamp(outCol, 0.0, 1.0), src.a);
        }
      `,
    };

    const chromaticDirtShader = {
      uniforms: {
        tDiffuse: { value: null },
        amount: { value: 0.0012 },
        radialStrength: { value: 0.6 },
        center: { value: new Vector2(0.5, 0.5) },
        dirtStrength: { value: 0.16 },
        dirtScale: { value: 1.7 },
        dirtThreshold: { value: 0.65 },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float amount;
        uniform float radialStrength;
        uniform vec2 center;
        uniform float dirtStrength;
        uniform float dirtScale;
        uniform float dirtThreshold;
        uniform float time;
        varying vec2 vUv;

        float hash21(vec2 p) {
          p = fract(p * vec2(123.34, 345.45));
          p += dot(p, p + 34.345);
          return fract(p.x * p.y);
        }

        void main() {
          vec2 dir = vUv - center;
          float r = length(dir);
          vec2 nd = normalize(dir + vec2(1e-6));
          float aberr = amount * (1.0 + radialStrength * r * r);
          vec2 off = nd * aberr;

          vec4 cR = texture2D(tDiffuse, vUv + off * 1.25);
          vec4 cG = texture2D(tDiffuse, vUv);
          vec4 cB = texture2D(tDiffuse, vUv - off);
          vec3 ca = vec3(cR.r, cG.g, cB.b);

          float luma = dot(cG.rgb, vec3(0.2126, 0.7152, 0.0722));
          vec2 dirtUv = (vUv - 0.5) * dirtScale + 0.5;
          float n1 = hash21(floor(dirtUv * 120.0) + vec2(time * 0.03, -time * 0.02));
          float n2 = hash21(floor((dirtUv + 0.37) * 200.0) - vec2(time * 0.01, time * 0.03));
          float dirt = smoothstep(dirtThreshold, 1.0, (n1 * 0.65 + n2 * 0.35));
          float bloomMask = smoothstep(0.55, 1.0, luma);
          vec3 dirtTint = vec3(1.0, 0.92, 0.78) * dirt * dirtStrength * bloomMask;

          gl_FragColor = vec4(clamp(ca + dirtTint, 0.0, 1.0), cG.a);
        }
      `,
    };

    const filmGrainShader = {
      uniforms: {
        tDiffuse: { value: null },
        time: { value: 0 },
        /** Força global (0–~0.08 recomendado); máscara de luma no fragment. */
        intensity: { value: 0.022 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform sampler2D tDiffuse;
        uniform float time;
        uniform float intensity;
        varying vec2 vUv;

        float hash21(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }

        void main() {
          vec4 col = texture2D(tDiffuse, vUv);
          float Y = dot(col.rgb, vec3(0.2126, 0.7152, 0.0722));

          /* Curva tipo “foot + shoulder”: mais grão em mid-tones; pouco em negro e em highlights. */
          float mid = 4.0 * Y * (1.0 - Y);
          float foot = smoothstep(0.0, 0.12, Y);
          float shoulder = smoothstep(1.0, 0.74, Y);
          float w = clamp(mid * foot * shoulder, 0.0, 1.0);

          /* Uma célula por pixel + fase temporal → grão fino sem padrão fixo em UV. */
          vec2 q = floor(gl_FragCoord.xy);
          float ph = time * 23.976;
          vec2 o = vec2(ph * 1.713, ph * -0.937);
          float h0 = hash21(q + o);
          float h1 = hash21(q + vec2(-ph * 0.6 + 19.0, ph * 0.31 + 4.0));
          float h2 = hash21(q + vec2(ph * 0.22 + 41.0, -ph + 91.0));
          float g = (h0 + h1 + h2 - 1.5) * 0.68;

          /* Grão levemente cromático (R/B), típico de filme — muito subtil. */
          float cr = (hash21(q + vec2(7.0, ph + 3.0)) - 0.5) * 2.0;
          float cb = (hash21(q + vec2(-2.0, ph * 1.1 + 9.0)) - 0.5) * 2.0;
          vec3 grain = vec3(g + cr * 0.22, g, g + cb * 0.22) * intensity * w;

          col.rgb = clamp(col.rgb + grain, 0.0, 1.0);
          gl_FragColor = vec4(col.rgb, col.a);
        }
      `,
    };

    const screenSpaceContactShadowShader = {
      uniforms: {
        tDiffuse: { value: null },
        resolution: { value: new Vector2(2, 2) },
        strength: { value: 0.24 },
        radius: { value: 1.8 },
        threshold: { value: 0.1 },
        lowerScreenBoost: { value: 0.35 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 resolution;
        uniform float strength;
        uniform float radius;
        uniform float threshold;
        uniform float lowerScreenBoost;
        varying vec2 vUv;

        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

        void main() {
          vec2 texel = max(vec2(1.0), vec2(radius)) / max(resolution, vec2(1.0));
          vec3 c0 = texture2D(tDiffuse, vUv).rgb;
          float l0 = luma(c0);
          float sum = 0.0;
          sum += abs(l0 - luma(texture2D(tDiffuse, vUv + vec2(texel.x, 0.0)).rgb));
          sum += abs(l0 - luma(texture2D(tDiffuse, vUv + vec2(-texel.x, 0.0)).rgb));
          sum += abs(l0 - luma(texture2D(tDiffuse, vUv + vec2(0.0, texel.y)).rgb));
          sum += abs(l0 - luma(texture2D(tDiffuse, vUv + vec2(0.0, -texel.y)).rgb));
          sum += abs(l0 - luma(texture2D(tDiffuse, vUv + vec2(texel.x, texel.y)).rgb));
          sum += abs(l0 - luma(texture2D(tDiffuse, vUv + vec2(-texel.x, texel.y)).rgb));
          sum += abs(l0 - luma(texture2D(tDiffuse, vUv + vec2(texel.x, -texel.y)).rgb));
          sum += abs(l0 - luma(texture2D(tDiffuse, vUv + vec2(-texel.x, -texel.y)).rgb));
          float edge = sum / 8.0;
          float contact = smoothstep(threshold, threshold * 3.0, edge);
          float lowerMask = smoothstep(0.25, 1.0, 1.0 - vUv.y);
          float shade = contact * strength * (1.0 + lowerMask * lowerScreenBoost);
          vec3 outCol = c0 * (1.0 - shade);
          gl_FragColor = vec4(clamp(outCol, 0.0, 1.0), 1.0);
        }
      `,
    };

    return {
      pixelationShader,
      colorDepthDitherShader,
      rgbSplitShader,
      vignetteShader,
      colorGradeShader,
      sharpenShader,
      screenSpaceContactShadowShader,
      screenSpaceLightShader,
      bloomFogShader,
      chromaticDirtShader,
      motionBlurShader,
      filmGrainShader,
    };
  }, [
    pixelSize,
    colorDepth,
    ditherStrength,
    vignette,
    rgbShift,
    rgbShiftAngle,
    hdrExposure,
    saturation,
    contrast,
    brightness,
    gamma,
    colorCorrection,
    colorMultiply,
    sharpen,
    hueShift,
    tintStrength,
  ]);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    previousToneMappingRef.current = gl.toneMapping;
    previousExposureRef.current = gl.toneMappingExposure;
    previousShadowMapTypeRef.current = gl.shadowMap.type;
    gl.toneMapping = ACESFilmicToneMapping;
    gl.shadowMap.type = PCFShadowMap;

    const composer = new EffectComposer(gl);
    const renderPass = new RenderPass(scene, camera);
    const taaPass = new TAARenderPass(scene, camera);
    taaPass.sampleLevel = 1;
    taaPass.unbiased = true;
    taaPass.accumulate = false;
    composer.addPass(renderPass);
    composer.addPass(taaPass);
    const ssrPass = new SSRPass({
      renderer: gl,
      scene,
      camera,
      width: size.width,
      height: size.height,
      selects: [],
      bouncing: false,
    });
    ssrPass.maxDistance = 36;
    ssrPass.thickness = 0.9;
    ssrPass.opacity = 0.72;
    ssrPass.infiniteThick = false;
    composer.addPass(ssrPass);
    const aoPass = new SSAOPass(scene, camera, size.width, size.height);
    aoPass.kernelRadius = 8;
    aoPass.minDistance = 0.005;
    aoPass.maxDistance = 0.1;
    const alphaPrevVisible = new WeakMap();
    const aoOverrideBase = aoPass._overrideVisibility.bind(aoPass);
    const aoRestoreBase = aoPass._restoreVisibility.bind(aoPass);
    aoPass._overrideVisibility = function overrideVisibilityWithAlphaIgnore() {
      aoOverrideBase();
      const alphaMeshes = aoAlphaMeshesRef.current;
      for (let i = 0; i < alphaMeshes.length; i++) {
        const mesh = alphaMeshes[i];
        if (!mesh) continue;
        alphaPrevVisible.set(mesh, mesh.visible);
        mesh.visible = false;
      }
    };
    aoPass._restoreVisibility = function restoreVisibilityWithAlphaIgnore() {
      const alphaMeshes = aoAlphaMeshesRef.current;
      for (let i = 0; i < alphaMeshes.length; i++) {
        const mesh = alphaMeshes[i];
        if (!mesh) continue;
        const prev = alphaPrevVisible.get(mesh);
        if (prev !== undefined) {
          mesh.visible = prev;
          alphaPrevVisible.delete(mesh);
        }
      }
      aoRestoreBase();
    };
    composer.addPass(aoPass);

    const pixelPass = new ShaderPass(passes.pixelationShader);
    const colorPass = new ShaderPass(passes.colorDepthDitherShader);
    const lowFi = GAME_CONFIG.psx.lowFiScreen !== false;
    const px = typeof GAME_CONFIG.psx.pixelSize === "number" ? GAME_CONFIG.psx.pixelSize : 0;
    pixelPass.enabled = lowFi && px > 0;
    colorPass.enabled = lowFi && GAME_CONFIG.psx.colorQuantization !== false;
    const rgbSplitPass = new ShaderPass(passes.rgbSplitShader);
    const contactShadowPass = new ShaderPass(passes.screenSpaceContactShadowShader);
    const screenLightPass = new ShaderPass(passes.screenSpaceLightShader);
    const bloomFogPass = new ShaderPass(passes.bloomFogShader);
    const chromaticDirtPass = new ShaderPass(passes.chromaticDirtShader);
    const colorGradePass = new ShaderPass(passes.colorGradeShader);
    const bloomPass = new UnrealBloomPass(
      new Vector2(size.width, size.height),
      bloomStrength,
      bloomRadius,
      bloomThreshold
    );
    const sharpenPass = new ShaderPass(passes.sharpenShader);
    const vignettePass = new ShaderPass(passes.vignetteShader);

    composer.addPass(pixelPass);
    composer.addPass(colorPass);
    composer.addPass(rgbSplitPass);
    composer.addPass(contactShadowPass);
    composer.addPass(screenLightPass);
    composer.addPass(bloomFogPass);
    composer.addPass(chromaticDirtPass);
    composer.addPass(colorGradePass);
    composer.addPass(bloomPass);
    composer.addPass(sharpenPass);
    composer.addPass(vignettePass);
    const motionBlurPass = new ShaderPass(passes.motionBlurShader);
    motionBlurPass.enabled = GAME_CONFIG.psx.motionBlur?.enabled !== false;
    composer.addPass(motionBlurPass);
    const filmGrainPass = new ShaderPass(passes.filmGrainShader);
    const fgInit = GAME_CONFIG.psx.filmGrain ?? {};
    const fgInitInt =
      typeof fgInit.intensity === "number" && Number.isFinite(fgInit.intensity)
        ? MathUtils.clamp(fgInit.intensity, 0, 0.1)
        : 0.022;
    filmGrainPass.uniforms.intensity.value = fgInitInt;
    filmGrainPass.enabled = fgInit.enabled !== false && fgInitInt > 1e-5;
    composer.addPass(filmGrainPass);

    composerRef.current = composer;
    renderPassRef.current = renderPass;
    taaPassRef.current = taaPass;
    aoPassRef.current = aoPass;
    ssrPassRef.current = ssrPass;
    pixelPassRef.current = pixelPass;
    colorPassRef.current = colorPass;
    rgbSplitPassRef.current = rgbSplitPass;
    contactShadowPassRef.current = contactShadowPass;
    screenLightPassRef.current = screenLightPass;
    bloomFogPassRef.current = bloomFogPass;
    chromaticDirtPassRef.current = chromaticDirtPass;
    colorGradePassRef.current = colorGradePass;
    bloomPassRef.current = bloomPass;
    sharpenPassRef.current = sharpenPass;
    vignettePassRef.current = vignettePass;
    motionBlurPassRef.current = motionBlurPass;
    filmGrainPassRef.current = filmGrainPass;

    gl.toneMappingExposure = GAME_CONFIG.psx.hdrExposure;

    {
      const scaleLive = clampPostComposerScale(GAME_CONFIG.psx.postComposerResolutionScale);
      const { width: cw, height: ch } = postComposerLogicalSize(size.width, size.height, scaleLive);
      const dpr = viewport.dpr ?? gl.getPixelRatio() ?? 1;
      const effW = cw * dpr;
      const effH = ch * dpr;
      composer.setSize(cw, ch);
      aoPass.setSize(cw, ch);
      ssrPass.setSize(cw, ch);
      pixelPass.uniforms.resolution.value.set(effW, effH);
      bloomFogPass.uniforms.resolution.value.set(effW, effH);
      contactShadowPass.uniforms.resolution.value.set(effW, effH);
      sharpenPass.uniforms.resolution.value.set(effW, effH);
      composerResolutionScaleAppliedRef.current = scaleLive;
    }

    return () => {
      if (previousToneMappingRef.current !== null) {
        gl.toneMapping = previousToneMappingRef.current;
      }
      if (previousExposureRef.current !== null) {
        gl.toneMappingExposure = previousExposureRef.current;
      }
      if (previousShadowMapTypeRef.current !== null) {
        gl.shadowMap.type = previousShadowMapTypeRef.current;
      }
      composerResolutionScaleAppliedRef.current = null;
      composerRef.current?.dispose();
      composerRef.current = null;
      renderPassRef.current = null;
      taaPassRef.current?.dispose?.();
      taaPassRef.current = null;
      aoPassRef.current = null;
      ssrPassRef.current = null;
      pixelPassRef.current = null;
      colorPassRef.current = null;
      rgbSplitPassRef.current = null;
      contactShadowPassRef.current = null;
      screenLightPassRef.current = null;
      bloomFogPassRef.current = null;
      chromaticDirtPassRef.current = null;
      colorGradePassRef.current = null;
      bloomPassRef.current = null;
      sharpenPassRef.current = null;
      vignettePassRef.current = null;
      motionBlurPassRef.current = null;
      filmGrainPassRef.current = null;
    };
  }, [enabled, gl, scene, camera, passes, bloomStrength, bloomRadius, bloomThreshold]);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;

    const scaleLive = clampPostComposerScale(GAME_CONFIG.psx.postComposerResolutionScale);
    const { width: cw, height: ch } = postComposerLogicalSize(size.width, size.height, scaleLive);
    const dpr = viewport.dpr ?? gl.getPixelRatio() ?? 1;
    const effW = cw * dpr;
    const effH = ch * dpr;

    composer.setSize(cw, ch);
    if (aoPassRef.current) {
      aoPassRef.current.setSize(cw, ch);
    }
    if (ssrPassRef.current) {
      ssrPassRef.current.setSize(cw, ch);
    }
    if (pixelPassRef.current) {
      pixelPassRef.current.uniforms.resolution.value.set(effW, effH);
    }
    if (bloomFogPassRef.current) {
      bloomFogPassRef.current.uniforms.resolution.value.set(effW, effH);
    }
    if (contactShadowPassRef.current) {
      contactShadowPassRef.current.uniforms.resolution.value.set(effW, effH);
    }
    if (sharpenPassRef.current) {
      sharpenPassRef.current.uniforms.resolution.value.set(effW, effH);
    }
    composerResolutionScaleAppliedRef.current = scaleLive;
  }, [enabled, gl, size.width, size.height, viewport.dpr]);

  useFrame((_, delta) => {
    if (!enabled || !composerRef.current) {
      return;
    }

    const scaleLive = clampPostComposerScale(GAME_CONFIG.psx.postComposerResolutionScale);
    if (composerResolutionScaleAppliedRef.current !== scaleLive) {
      composerResolutionScaleAppliedRef.current = scaleLive;
      const composer = composerRef.current;
      const { width: cw, height: ch } = postComposerLogicalSize(size.width, size.height, scaleLive);
      const dpr = viewport.dpr ?? gl.getPixelRatio() ?? 1;
      const effW = cw * dpr;
      const effH = ch * dpr;
      composer.setSize(cw, ch);
      if (aoPassRef.current) {
        aoPassRef.current.setSize(cw, ch);
      }
      if (ssrPassRef.current) {
        ssrPassRef.current.setSize(cw, ch);
      }
      if (pixelPassRef.current) {
        pixelPassRef.current.uniforms.resolution.value.set(effW, effH);
      }
      if (bloomFogPassRef.current) {
        bloomFogPassRef.current.uniforms.resolution.value.set(effW, effH);
      }
      if (contactShadowPassRef.current) {
        contactShadowPassRef.current.uniforms.resolution.value.set(effW, effH);
      }
      if (sharpenPassRef.current) {
        sharpenPassRef.current.uniforms.resolution.value.set(effW, effH);
      }
    }

    const psx = GAME_CONFIG.psx;
    const taaCfg = psx.temporalAA ?? {};
    const taaPass = taaPassRef.current;
    const renderPass = renderPassRef.current;
    if (taaPass && renderPass) {
      const taaEnabled = taaCfg.enabled === true;
      const sampleLevel = typeof taaCfg.sampleLevel === "number" ? MathUtils.clamp(Math.floor(taaCfg.sampleLevel), 0, 5) : 1;
      const posThreshold = typeof taaCfg.motionPositionThreshold === "number" ? Math.max(0, taaCfg.motionPositionThreshold) : 0.003;
      const rotThreshold = typeof taaCfg.motionRotationThreshold === "number" ? Math.max(0, taaCfg.motionRotationThreshold) : 0.0012;

      const camPos = camera.position;
      const camQuat = camera.quaternion;
      if (!prevCamPos3Ref.current) {
        prevCamPos3Ref.current = camPos.clone();
      }
      if (!prevCamQuatRef.current) {
        prevCamQuatRef.current = camQuat.clone();
      }
      const movePos = prevCamPos3Ref.current.distanceTo(camPos);
      const moveRot = 1 - Math.abs(prevCamQuatRef.current.dot(camQuat));
      const isMoving = movePos > posThreshold || moveRot > rotThreshold;

      taaPass.enabled = taaEnabled;
      renderPass.enabled = !taaEnabled;
      taaPass.sampleLevel = sampleLevel;
      taaPass.unbiased = taaCfg.unbiased !== false;
      taaPass.accumulate = taaEnabled && !isMoving;
      if (isMoving) {
        taaPass.accumulateIndex = -1;
      }
      prevCamPos3Ref.current.copy(camPos);
      prevCamQuatRef.current.copy(camQuat);
    }

    const lowFiScreen = psx.lowFiScreen !== false;
    if (pixelPassRef.current) {
      const px = typeof psx.pixelSize === "number" ? psx.pixelSize : 0;
      pixelPassRef.current.enabled = lowFiScreen && px > 0;
    }
    if (colorPassRef.current) {
      colorPassRef.current.enabled = lowFiScreen && psx.colorQuantization !== false;
    }

    const env = visualEnvironmentRef?.current;
    const daylightUse =
      env && typeof env.daylight === "number" && Number.isFinite(env.daylight) ? env.daylight : daylight;
    const envRainWeight =
      env && typeof env.rain === "number" && Number.isFinite(env.rain) ? MathUtils.clamp(env.rain, 0, 1) : isRaining
        ? 1
        : 0;

    const effectiveBrightness =
      typeof psxOverrides?.brightness === "number" && Number.isFinite(psxOverrides.brightness)
        ? psxOverrides.brightness
        : psx.brightness;
    const effectiveColorCorrection = Array.isArray(env?.colorCorrection)
      ? env.colorCorrection
      : Array.isArray(psxOverrides?.colorCorrection)
        ? psxOverrides.colorCorrection
        : (psx.colorCorrection ?? [1, 1, 1]);
    const effectiveTintColor =
      typeof env?.tintColor === "string"
        ? env.tintColor
        : typeof psxOverrides?.tintColor === "string"
          ? psxOverrides.tintColor
          : psx.tintColor;
    const effectiveTintStrength =
      typeof env?.tintStrength === "number" && Number.isFinite(env.tintStrength)
        ? env.tintStrength
        : typeof psxOverrides?.tintStrength === "number" && Number.isFinite(psxOverrides.tintStrength)
          ? psxOverrides.tintStrength
          : psx.tintStrength;
    const lutCfg = psx.colorLUT ?? {};
    const lutEnabled = lutCfg.enabled === true;
    const dayWBase = MathUtils.clamp(daylightUse, 0, 1);
    const nightWBase = MathUtils.clamp(1 - daylightUse, 0, 1);
    const rainWBase = envRainWeight;
    const dayWeight = dayWBase * (typeof lutCfg.dayWeight === "number" ? Math.max(0, lutCfg.dayWeight) : 1);
    const nightWeight = nightWBase * (typeof lutCfg.nightWeight === "number" ? Math.max(0, lutCfg.nightWeight) : 1);
    const rainWeight = rainWBase * (typeof lutCfg.rainWeight === "number" ? Math.max(0, lutCfg.rainWeight) : 1);
    const aoCfg = psx.ambientOcclusion ?? {};
    const aoPass = aoPassRef.current;
    if (aoPass) {
      aoPass.enabled = aoCfg.enabled === true;
      aoPass.output = mapAoOutput(aoCfg.output);
      aoPass.kernelRadius = typeof aoCfg.kernelRadius === "number" ? MathUtils.clamp(aoCfg.kernelRadius, 0, 32) : 8;
      const minD = typeof aoCfg.minDistance === "number" ? MathUtils.clamp(aoCfg.minDistance, 0.0001, 0.2) : 0.005;
      const maxD = typeof aoCfg.maxDistance === "number" ? MathUtils.clamp(aoCfg.maxDistance, 0.001, 0.5) : 0.1;
      aoPass.minDistance = Math.min(minD, maxD - 0.0005);
      aoPass.maxDistance = Math.max(maxD, aoPass.minDistance + 0.0005);

      /**
       * SSAOPass do three só copia projection / inverseProjection em `setSize`.
       * Com câmera em movimento (terceira pessoa), as matrizes ficam defasadas →
       * reconstrução de posição errada e AO virando manchas pretas na tela.
       */
      if (aoPass.enabled && aoPass.ssaoMaterial?.uniforms && aoPass.depthRenderMaterial?.uniforms) {
        const u = aoPass.ssaoMaterial.uniforms;
        u.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
        u.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse);
        u.cameraNear.value = camera.near;
        u.cameraFar.value = camera.far;
        const du = aoPass.depthRenderMaterial.uniforms;
        du.cameraNear.value = camera.near;
        du.cameraFar.value = camera.far;
      }

      aoAlphaScanCooldownRef.current -= delta;
      if (aoAlphaScanCooldownRef.current <= 0) {
        aoAlphaScanCooldownRef.current = aoPass.enabled ? 6.0 : 2.0;
        if (aoCfg.ignoreAlpha !== false) {
          if (!aoAlphaScannedOnceRef.current || aoAlphaMeshesRef.current.length === 0) {
            const alphaMeshes = [];
            scene.traverse((obj) => {
              if (!obj?.isMesh || !obj.geometry) return;
              if (meshUsesAlphaMaterial(obj)) alphaMeshes.push(obj);
            });
            aoAlphaMeshesRef.current = alphaMeshes;
            aoAlphaScannedOnceRef.current = true;
          }
        } else {
          aoAlphaMeshesRef.current = [];
          aoAlphaScannedOnceRef.current = false;
        }
      }
    }
    const rainSsrCfg = GAME_CONFIG.world?.rainRoadSSR ?? {};
    const rainReflectionMode = String(rainSsrCfg.reflectionMode ?? "ssr").toLowerCase();
    const ssrEnabled = rainSsrCfg.enabled !== false && isRaining && rainReflectionMode === "ssr";
    const csCfg = psx.contactShadows ?? {};
    const contactShadowPass = contactShadowPassRef.current;
    if (contactShadowPass) {
      contactShadowPass.enabled = csCfg.enabled === true;
      contactShadowPass.uniforms.strength.value =
        typeof csCfg.strength === "number" ? MathUtils.clamp(csCfg.strength, 0, 1) : 0.24;
      contactShadowPass.uniforms.radius.value =
        typeof csCfg.radius === "number" ? MathUtils.clamp(csCfg.radius, 0.5, 6) : 1.8;
      contactShadowPass.uniforms.threshold.value =
        typeof csCfg.threshold === "number" ? MathUtils.clamp(csCfg.threshold, 0.005, 0.4) : 0.1;
      contactShadowPass.uniforms.lowerScreenBoost.value =
        typeof csCfg.lowerScreenBoost === "number" ? MathUtils.clamp(csCfg.lowerScreenBoost, 0, 2) : 0.35;
    }
    const sslCfg = psx.screenSpaceLight ?? {};
    const screenLightPass = screenLightPassRef.current;
    if (screenLightPass) {
      screenLightPass.enabled = sslCfg.enabled === true;
      screenLightPass.uniforms.intensity.value =
        typeof sslCfg.intensity === "number" ? MathUtils.clamp(sslCfg.intensity, 0, 3) : 0.22;
      screenLightPass.uniforms.threshold.value =
        typeof sslCfg.threshold === "number" ? MathUtils.clamp(sslCfg.threshold, 0, 1) : 0.62;
      screenLightPass.uniforms.shadowStrength.value =
        typeof sslCfg.shadowStrength === "number" ? MathUtils.clamp(sslCfg.shadowStrength, 0, 1) : 0.18;
      screenLightPass.uniforms.radius.value =
        typeof sslCfg.radius === "number" ? MathUtils.clamp(sslCfg.radius, 0.01, 2) : 0.28;
      const cx = typeof sslCfg.centerX === "number" ? MathUtils.clamp(sslCfg.centerX, 0, 1) : 0.5;
      const cy = typeof sslCfg.centerY === "number" ? MathUtils.clamp(sslCfg.centerY, 0, 1) : 0.42;
      screenLightPass.uniforms.center.value.set(cx, cy);
    }

    const bfCfg = psx.bloomFog ?? {};
    const bfPass = bloomFogPassRef.current;
    if (bfPass) {
      const nightThreshold =
        typeof bfCfg.nightDaylightThreshold === "number"
          ? MathUtils.clamp(bfCfg.nightDaylightThreshold, 0, 1)
          : 0.28;
      const nightGate = bfCfg.nightOnly === true ? daylightUse <= nightThreshold : true;
      const bfEnabled = bfCfg.enabled === true && psx.fogEnabled !== false && nightGate;
      bfPass.enabled = bfEnabled;
      if (bfEnabled) {
        bfPass.uniforms.threshold.value =
          typeof bfCfg.threshold === "number" ? MathUtils.clamp(bfCfg.threshold, 0, 1) : 0.62;
        bfPass.uniforms.softKnee.value =
          typeof bfCfg.softKnee === "number" ? MathUtils.clamp(bfCfg.softKnee, 0.01, 0.5) : 0.22;
        bfPass.uniforms.glowStrength.value =
          typeof bfCfg.glowStrength === "number" ? Math.max(0, bfCfg.glowStrength) : 0.9;
        bfPass.uniforms.fogTintMix.value =
          typeof bfCfg.fogTintMix === "number" ? MathUtils.clamp(bfCfg.fogTintMix, 0, 1) : 0.7;
        bfPass.uniforms.radiusPx.value =
          typeof bfCfg.radiusPx === "number" ? MathUtils.clamp(bfCfg.radiusPx, 0, 12) : 3.5;
        bfPass.uniforms.outerRadiusMul.value =
          typeof bfCfg.outerRadiusMul === "number" ? MathUtils.clamp(bfCfg.outerRadiusMul, 1.1, 10) : 2.2;
        bfPass.uniforms.veilStrength.value =
          typeof bfCfg.veilStrength === "number" ? MathUtils.clamp(bfCfg.veilStrength, 0, 1) : 0.08;
        const fogCol = new Vector3(0.75, 0.75, 0.75);
        try {
          const hex = String(psx.fogColor ?? "#bfbfbf").replace("#", "");
          if (hex.length === 6) {
            fogCol.set(
              Number.parseInt(hex.slice(0, 2), 16) / 255,
              Number.parseInt(hex.slice(2, 4), 16) / 255,
              Number.parseInt(hex.slice(4, 6), 16) / 255
            );
          }
        } catch {
          /* keep fallback */
        }
        bfPass.uniforms.fogColor.value.copy(fogCol);
      }
    }

    const cadCfg = psx.chromaticDirt ?? {};
    const chromaticDirtPass = chromaticDirtPassRef.current;
    if (chromaticDirtPass) {
      chromaticDirtPass.enabled = cadCfg.enabled === true;
      chromaticDirtPass.uniforms.amount.value =
        typeof cadCfg.amount === "number" ? MathUtils.clamp(cadCfg.amount, 0, 0.01) : 0.0012;
      chromaticDirtPass.uniforms.radialStrength.value =
        typeof cadCfg.radialStrength === "number" ? MathUtils.clamp(cadCfg.radialStrength, 0, 3) : 0.6;
      chromaticDirtPass.uniforms.dirtStrength.value =
        typeof cadCfg.dirtStrength === "number" ? MathUtils.clamp(cadCfg.dirtStrength, 0, 1) : 0.16;
      chromaticDirtPass.uniforms.dirtScale.value =
        typeof cadCfg.dirtScale === "number" ? MathUtils.clamp(cadCfg.dirtScale, 0.5, 4) : 1.7;
      chromaticDirtPass.uniforms.dirtThreshold.value =
        typeof cadCfg.dirtThreshold === "number" ? MathUtils.clamp(cadCfg.dirtThreshold, 0, 1) : 0.65;
      const cx = typeof cadCfg.centerX === "number" ? MathUtils.clamp(cadCfg.centerX, 0, 1) : 0.5;
      const cy = typeof cadCfg.centerY === "number" ? MathUtils.clamp(cadCfg.centerY, 0, 1) : 0.5;
      chromaticDirtPass.uniforms.center.value.set(cx, cy);
      chromaticDirtPass.uniforms.time.value += delta;
    }
    const ssrPass = ssrPassRef.current;
    if (ssrPass) {
      ssrPass.enabled = ssrEnabled;
      ssrPass.opacity = typeof rainSsrCfg.ssrOpacity === "number" ? Math.max(0, rainSsrCfg.ssrOpacity) : 0.72;
      ssrPass.maxDistance = typeof rainSsrCfg.ssrMaxDistance === "number" ? Math.max(0.1, rainSsrCfg.ssrMaxDistance) : 36;
      ssrPass.thickness = typeof rainSsrCfg.ssrThickness === "number" ? Math.max(0.001, rainSsrCfg.ssrThickness) : 0.9;
      ssrPass.infiniteThick = rainSsrCfg.ssrInfiniteThickness === true;

      roadScanCooldownRef.current -= delta;
      if (roadScanCooldownRef.current <= 0) {
        roadScanCooldownRef.current = ssrEnabled ? 8 : 2;
        if (!roadMeshScannedOnceRef.current || roadMeshCacheRef.current.length === 0) {
          const tokensRaw = Array.isArray(rainSsrCfg.roadNameTokens)
            ? rainSsrCfg.roadNameTokens
            : ["road", "asphalt", "street", "ground"];
          const tokens = tokensRaw.map((t) => String(t).toLowerCase()).filter(Boolean);
          roadMeshCacheRef.current = collectRoadMeshes(scene, tokens);
          roadMeshScannedOnceRef.current = true;
        }
      }
      ssrPass.selects = roadMeshCacheRef.current;
    }

    const correction = effectiveColorCorrection;
    /** `brightness` muda em quase todos os frames durante relâmpago (`WeatherAmbience`); não entra na chave para evitar re-parse de hex e re-push de todos os uniforms. */
    const psxUniformKey = [
      psx.lowFiScreen === false ? 0 : 1,
      psx.colorQuantization === false ? 0 : 1,
      psx.pixelSize,
      psx.colorDepth,
      psx.ditherStrength,
      psx.rgbShift,
      psx.rgbShiftAngle,
      psx.hdrExposure,
      psx.saturation,
      psx.contrast,
      psx.gamma,
      correction[0],
      correction[1],
      correction[2],
      psx.colorMultiply ?? "",
      psx.hueShift,
      effectiveTintColor ?? "",
      effectiveTintStrength,
      psx.bloomStrength,
      psx.bloomRadius,
      psx.bloomThreshold,
      psx.sharpen,
      psx.vignette,
      taaCfg.enabled === true ? 1 : 0,
      taaCfg.sampleLevel ?? "",
      taaCfg.unbiased === false ? 0 : 1,
      lutEnabled ? 1 : 0,
      lutCfg.amount ?? "",
      dayWeight,
      nightWeight,
      rainWeight,
      aoCfg.enabled === true ? 1 : 0,
      aoCfg.kernelRadius ?? "",
      aoCfg.minDistance ?? "",
      aoCfg.maxDistance ?? "",
      csCfg.enabled === true ? 1 : 0,
      csCfg.strength ?? "",
      csCfg.radius ?? "",
      csCfg.threshold ?? "",
      csCfg.lowerScreenBoost ?? "",
      sslCfg.enabled === true ? 1 : 0,
      sslCfg.intensity ?? "",
      sslCfg.threshold ?? "",
      sslCfg.shadowStrength ?? "",
      sslCfg.radius ?? "",
      sslCfg.centerX ?? "",
      sslCfg.centerY ?? "",
      cadCfg.enabled === true ? 1 : 0,
      cadCfg.amount ?? "",
      cadCfg.radialStrength ?? "",
      cadCfg.dirtStrength ?? "",
      cadCfg.dirtScale ?? "",
      cadCfg.dirtThreshold ?? "",
      cadCfg.centerX ?? "",
      cadCfg.centerY ?? "",
      ssrEnabled ? 1 : 0,
    ].join("\0");

    if (psxUniformKey !== lastPsxUniformKeyRef.current) {
      lastPsxUniformKeyRef.current = psxUniformKey;

      if (pixelPassRef.current) {
        pixelPassRef.current.uniforms.pixelSize.value = psx.pixelSize;
      }
      if (colorPassRef.current) {
        colorPassRef.current.uniforms.colorDepth.value = psx.colorDepth;
        colorPassRef.current.uniforms.ditherStrength.value = psx.ditherStrength;
      }
      if (rgbSplitPassRef.current) {
        rgbSplitPassRef.current.uniforms.amount.value = psx.rgbShift;
        rgbSplitPassRef.current.uniforms.angle.value = psx.rgbShiftAngle;
      }
      if (colorGradePassRef.current) {
        colorGradePassRef.current.uniforms.hdrExposure.value = psx.hdrExposure;
        colorGradePassRef.current.uniforms.saturation.value = psx.saturation;
        colorGradePassRef.current.uniforms.contrast.value = psx.contrast;
        colorGradePassRef.current.uniforms.gamma.value = psx.gamma;
        colorGradePassRef.current.uniforms.colorCorrection.value[0] = correction[0] ?? 1;
        colorGradePassRef.current.uniforms.colorCorrection.value[1] = correction[1] ?? 1;
        colorGradePassRef.current.uniforms.colorCorrection.value[2] = correction[2] ?? 1;
        const multiply = colorGradePassRef.current.uniforms.colorMultiply.value;
        const multiplyHex = psx.colorMultiply ?? "#ffffff";
        const mr = Number.parseInt(multiplyHex.slice(1, 3), 16) / 255;
        const mg = Number.parseInt(multiplyHex.slice(3, 5), 16) / 255;
        const mb = Number.parseInt(multiplyHex.slice(5, 7), 16) / 255;
        multiply[0] = Number.isFinite(mr) ? mr : 1;
        multiply[1] = Number.isFinite(mg) ? mg : 1;
        multiply[2] = Number.isFinite(mb) ? mb : 1;
        colorGradePassRef.current.uniforms.hueShift.value = psx.hueShift;
        const tint = colorGradePassRef.current.uniforms.tintColor.value;
        const tintHex = effectiveTintColor ?? "#ffffff";
        const r = Number.parseInt(tintHex.slice(1, 3), 16) / 255;
        const g = Number.parseInt(tintHex.slice(3, 5), 16) / 255;
        const b = Number.parseInt(tintHex.slice(5, 7), 16) / 255;
        tint[0] = Number.isFinite(r) ? r : 1;
        tint[1] = Number.isFinite(g) ? g : 1;
        tint[2] = Number.isFinite(b) ? b : 1;
        colorGradePassRef.current.uniforms.tintStrength.value = effectiveTintStrength;
        colorGradePassRef.current.uniforms.lutEnabled.value = lutEnabled ? 1 : 0;
        colorGradePassRef.current.uniforms.lutAmount.value =
          typeof lutCfg.amount === "number" ? MathUtils.clamp(lutCfg.amount, 0, 1) : 1;
        colorGradePassRef.current.uniforms.lutDayWeight.value = dayWeight;
        colorGradePassRef.current.uniforms.lutNightWeight.value = nightWeight;
        colorGradePassRef.current.uniforms.lutRainWeight.value = rainWeight;

        const dayLift = Array.isArray(lutCfg.day?.lift) ? lutCfg.day.lift : [0, 0, 0];
        const dayGamma = Array.isArray(lutCfg.day?.gamma) ? lutCfg.day.gamma : [1, 1, 1];
        const dayGain = Array.isArray(lutCfg.day?.gain) ? lutCfg.day.gain : [1, 1, 1];
        const nightLift = Array.isArray(lutCfg.night?.lift) ? lutCfg.night.lift : [0, 0, 0];
        const nightGamma = Array.isArray(lutCfg.night?.gamma) ? lutCfg.night.gamma : [1, 1, 1];
        const nightGain = Array.isArray(lutCfg.night?.gain) ? lutCfg.night.gain : [1, 1, 1];
        const rainLift = Array.isArray(lutCfg.rain?.lift) ? lutCfg.rain.lift : [0, 0, 0];
        const rainGamma = Array.isArray(lutCfg.rain?.gamma) ? lutCfg.rain.gamma : [1, 1, 1];
        const rainGain = Array.isArray(lutCfg.rain?.gain) ? lutCfg.rain.gain : [1, 1, 1];

        colorGradePassRef.current.uniforms.lutDayLift.value[0] = dayLift[0] ?? 0;
        colorGradePassRef.current.uniforms.lutDayLift.value[1] = dayLift[1] ?? 0;
        colorGradePassRef.current.uniforms.lutDayLift.value[2] = dayLift[2] ?? 0;
        colorGradePassRef.current.uniforms.lutDayGamma.value[0] = dayGamma[0] ?? 1;
        colorGradePassRef.current.uniforms.lutDayGamma.value[1] = dayGamma[1] ?? 1;
        colorGradePassRef.current.uniforms.lutDayGamma.value[2] = dayGamma[2] ?? 1;
        colorGradePassRef.current.uniforms.lutDayGain.value[0] = dayGain[0] ?? 1;
        colorGradePassRef.current.uniforms.lutDayGain.value[1] = dayGain[1] ?? 1;
        colorGradePassRef.current.uniforms.lutDayGain.value[2] = dayGain[2] ?? 1;

        colorGradePassRef.current.uniforms.lutNightLift.value[0] = nightLift[0] ?? 0;
        colorGradePassRef.current.uniforms.lutNightLift.value[1] = nightLift[1] ?? 0;
        colorGradePassRef.current.uniforms.lutNightLift.value[2] = nightLift[2] ?? 0;
        colorGradePassRef.current.uniforms.lutNightGamma.value[0] = nightGamma[0] ?? 1;
        colorGradePassRef.current.uniforms.lutNightGamma.value[1] = nightGamma[1] ?? 1;
        colorGradePassRef.current.uniforms.lutNightGamma.value[2] = nightGamma[2] ?? 1;
        colorGradePassRef.current.uniforms.lutNightGain.value[0] = nightGain[0] ?? 1;
        colorGradePassRef.current.uniforms.lutNightGain.value[1] = nightGain[1] ?? 1;
        colorGradePassRef.current.uniforms.lutNightGain.value[2] = nightGain[2] ?? 1;

        colorGradePassRef.current.uniforms.lutRainLift.value[0] = rainLift[0] ?? 0;
        colorGradePassRef.current.uniforms.lutRainLift.value[1] = rainLift[1] ?? 0;
        colorGradePassRef.current.uniforms.lutRainLift.value[2] = rainLift[2] ?? 0;
        colorGradePassRef.current.uniforms.lutRainGamma.value[0] = rainGamma[0] ?? 1;
        colorGradePassRef.current.uniforms.lutRainGamma.value[1] = rainGamma[1] ?? 1;
        colorGradePassRef.current.uniforms.lutRainGamma.value[2] = rainGamma[2] ?? 1;
        colorGradePassRef.current.uniforms.lutRainGain.value[0] = rainGain[0] ?? 1;
        colorGradePassRef.current.uniforms.lutRainGain.value[1] = rainGain[1] ?? 1;
        colorGradePassRef.current.uniforms.lutRainGain.value[2] = rainGain[2] ?? 1;
      }
      if (bloomPassRef.current) {
        bloomPassRef.current.strength = psx.bloomStrength;
        bloomPassRef.current.radius = psx.bloomRadius;
        bloomPassRef.current.threshold = psx.bloomThreshold;
      }
      if (sharpenPassRef.current) {
        sharpenPassRef.current.uniforms.amount.value = psx.sharpen;
      }
      if (vignettePassRef.current) {
        vignettePassRef.current.uniforms.vignette.value = psx.vignette;
      }
    }

    const cg = colorGradePassRef.current;
    if (cg) {
      const flashBoost = lightningFlashRef?.current ? lightningFlashRef.current * 0.68 : 0;
      cg.uniforms.brightness.value = effectiveBrightness + flashBoost;
    }

    const mbPass = motionBlurPassRef.current;
    if (mbPass) {
      const mbCfg = psx.motionBlur ?? {};
      const mbOn = mbCfg.enabled !== false;
      mbPass.enabled = mbOn;
      if (mbOn) {
        if (!prevMbQuatRef.current) {
          prevMbQuatRef.current = new Quaternion();
          prevMbPosRef.current = new Vector3();
          prevMbQuatRef.current.copy(camera.quaternion);
          prevMbPosRef.current.copy(camera.position);
          mbPass.uniforms.uDirNorm.value.set(0, 1);
          mbPass.uniforms.uStepUv.value = 0;
          mbPass.uniforms.uMix.value = 0;
        } else {
          _mbDq.copy(prevMbQuatRef.current).invert().multiply(camera.quaternion);
          const w = MathUtils.clamp(_mbDq.w, -1, 1);
          const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
          const angle = 2 * Math.acos(w);
          if (sinHalf > 1e-5) {
            const inv = 1 / sinHalf;
            _mbAxis.set(_mbDq.x * inv, _mbDq.y * inv, _mbDq.z * inv);
          } else {
            _mbAxis.set(0, 0, 0);
          }
          _mbAxis.applyQuaternion(_mbInvQ.copy(camera.quaternion).invert());
          const kR =
            typeof mbCfg.rotationScale === "number" && Number.isFinite(mbCfg.rotationScale) ? mbCfg.rotationScale : 3.2;
          _mbBlur.set(_mbAxis.x * angle * kR, _mbAxis.y * angle * kR);
          _mbDpos.copy(camera.position).sub(prevMbPosRef.current);
          _mbDpos.applyQuaternion(_mbInvQ.copy(camera.quaternion).invert());
          const kT =
            typeof mbCfg.translationScale === "number" && Number.isFinite(mbCfg.translationScale)
              ? mbCfg.translationScale
              : 0.0025;
          _mbBlur.x += _mbDpos.x * kT;
          _mbBlur.y += _mbDpos.y * kT;
          const maxUv = typeof mbCfg.maxBlurUv === "number" && mbCfg.maxBlurUv > 0 ? mbCfg.maxBlurUv : 0.04;
          const len = _mbBlur.length();
          if (len > 1e-6) {
            const cappedLen = Math.min(len, maxUv);
            const invLen = 1 / len;
            mbPass.uniforms.uDirNorm.value.set(_mbBlur.x * invLen, _mbBlur.y * invLen);
            mbPass.uniforms.uStepUv.value = cappedLen * (1.0 / 3.2);
            const str = typeof mbCfg.strength === "number" ? MathUtils.clamp(mbCfg.strength, 0, 1) : 0.5;
            mbPass.uniforms.uMix.value = MathUtils.clamp(str * (cappedLen / maxUv) * 1.12, 0, 1);
          } else {
            mbPass.uniforms.uDirNorm.value.set(0, 1);
            mbPass.uniforms.uStepUv.value = 0;
            mbPass.uniforms.uMix.value = 0;
          }
        }
      } else {
        mbPass.uniforms.uMix.value = 0;
      }
    }

    const filmGrainPass = filmGrainPassRef.current;
    if (filmGrainPass) {
      const fgCfg = psx.filmGrain ?? {};
      const fgInt =
        typeof fgCfg.intensity === "number" && Number.isFinite(fgCfg.intensity)
          ? MathUtils.clamp(fgCfg.intensity, 0, 0.1)
          : 0.022;
      filmGrainPass.uniforms.intensity.value = fgInt;
      filmGrainPass.enabled = fgCfg.enabled !== false && fgInt > 1e-5;
      filmGrainPass.uniforms.time.value += delta;
    }

    gl.toneMappingExposure = psx.hdrExposure;
    composerRef.current.render(delta);

    if (prevMbQuatRef.current && prevMbPosRef.current) {
      prevMbQuatRef.current.copy(camera.quaternion);
      prevMbPosRef.current.copy(camera.position);
    }
  }, 1);

  return null;
}
