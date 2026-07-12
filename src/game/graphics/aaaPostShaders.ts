import { Vector2, Vector3 } from 'three'
import type { AaaSettings } from './aaaSettings'

type PostColor = AaaSettings['post']['colorGrade']

export function createAaaPostShaders(color: PostColor) {
  const rgbSplitShader = {
    uniforms: {
      tDiffuse: { value: null },
      amount: { value: color.rgbShift.amount },
      angle: { value: color.rgbShift.angle },
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
  }

  const vignetteShader = {
    uniforms: {
      tDiffuse: { value: null },
      vignette: { value: color.vignette },
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
  }

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
  }

  const colorGradeShader = {
    uniforms: {
      tDiffuse: { value: null },
      hdrExposure: { value: color.hdrExposure },
      saturation: { value: color.saturation },
      contrast: { value: color.contrast },
      brightness: { value: color.brightness },
      gamma: { value: color.gamma },
      colorCorrection: { value: [...color.colorCorrection] },
      colorMultiply: { value: [1, 1, 1] },
      hueShift: { value: color.hueShift },
      tintColor: { value: new Vector3(0.784, 0.831, 1.0) },
      tintStrength: { value: color.tintStrength },
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
      varying vec2 vUv;
      vec3 hueRotate(vec3 c, float angle) {
        float s = sin(angle);
        float c0 = cos(angle);
        mat3 m = mat3(
          vec3(0.213 + c0 * 0.787 - s * 0.213, 0.715 - c0 * 0.715 - s * 0.715, 0.072 - c0 * 0.072 + s * 0.928),
          vec3(0.213 - c0 * 0.213 + s * 0.143, 0.715 + c0 * 0.285 + s * 0.140, 0.072 - c0 * 0.072 - s * 0.283),
          vec3(0.213 - c0 * 0.213 - s * 0.787, 0.715 - c0 * 0.715 + s * 0.715, 0.072 + c0 * 0.928 + s * 0.072)
        );
        return clamp(m * c, 0.0, 1.0);
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
        c.rgb = pow(max(c.rgb, vec3(0.0)), vec3(1.0 / max(0.001, gamma)));
        gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
      }
    `,
  }

  const sharpenShader = {
    uniforms: {
      tDiffuse: { value: null },
      resolution: { value: new Vector2(2, 2) },
      amount: { value: color.sharpen },
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
  }

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
  }

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
  }

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
  }

  const filmGrainShader = {
    uniforms: {
      tDiffuse: { value: null },
      time: { value: 0 },
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
        float mid = 4.0 * Y * (1.0 - Y);
        float foot = smoothstep(0.0, 0.12, Y);
        float shoulder = smoothstep(1.0, 0.74, Y);
        float w = clamp(mid * foot * shoulder, 0.0, 1.0);
        vec2 q = floor(gl_FragCoord.xy);
        float ph = time * 23.976;
        vec2 o = vec2(ph * 1.713, ph * -0.937);
        float h0 = hash21(q + o);
        float h1 = hash21(q + vec2(-ph * 0.6 + 19.0, ph * 0.31 + 4.0));
        float h2 = hash21(q + vec2(ph * 0.22 + 41.0, -ph + 91.0));
        float g = (h0 + h1 + h2 - 1.5) * 0.68;
        float cr = (hash21(q + vec2(7.0, ph + 3.0)) - 0.5) * 2.0;
        float cb = (hash21(q + vec2(-2.0, ph * 1.1 + 9.0)) - 0.5) * 2.0;
        vec3 grain = vec3(g + cr * 0.22, g, g + cb * 0.22) * intensity * w;
        col.rgb = clamp(col.rgb + grain, 0.0, 1.0);
        gl_FragColor = vec4(col.rgb, col.a);
      }
    `,
  }

  const contactShadowShader = {
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
        gl_FragColor = vec4(clamp(c0 * (1.0 - shade), 0.0, 1.0), 1.0);
      }
    `,
  }

  return {
    rgbSplitShader,
    vignetteShader,
    motionBlurShader,
    colorGradeShader,
    sharpenShader,
    screenSpaceLightShader,
    bloomFogShader,
    chromaticDirtShader,
    filmGrainShader,
    contactShadowShader,
  }
}

export function hexToRgb01(hex: string): [number, number, number] {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return [1, 1, 1]
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255
  return [
    Number.isFinite(r) ? r : 1,
    Number.isFinite(g) ? g : 1,
    Number.isFinite(b) ? b : 1,
  ]
}
