import { BlendFunction, Effect } from 'postprocessing'
import { Uniform, Vector2, Vector3 } from 'three'
import { PSX_CLASSIC } from './psxSettings'
import { PSX_TONE_MAPPING_GLSL, PSX_TONE_MAPPING_MODE } from './psxToneMapping'

const { post, color } = PSX_CLASSIC

const fragmentShader = /* glsl */ `
${PSX_TONE_MAPPING_GLSL}

uniform float time;
uniform vec2 resolution;
uniform float pixelSize;
uniform float resolutionScale;
uniform float colorDepth;
uniform float ditherIntensity;
uniform float bands;
uniform float bandIntensity;
uniform float scanOpacity;
uniform float scanCount;
uniform float uvJitter;
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform float gamma;
uniform float vignette;
uniform float vignetteDarkness;
uniform vec3 tint;
uniform float toneMappingMode;

float bayerPSX(vec2 coord) {
  float bayer[16] = float[16](
    0.0,  8.0,  2.0, 10.0,
    12.0, 4.0, 14.0,  6.0,
    3.0, 11.0,  1.0,  9.0,
    15.0, 7.0, 13.0,  5.0
  );
  int x = int(mod(coord.x, 4.0));
  int y = int(mod(coord.y, 4.0));
  return bayer[y * 4 + x] / 16.0;
}

vec3 applyColorGrade(vec3 rgb, vec2 uv) {
  rgb = (rgb - 0.5) * contrast + 0.5;
  rgb += brightness;

  float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  rgb = mix(vec3(luma), rgb, saturation);

  rgb *= tint;

  if (gamma > 0.001) {
    rgb = pow(max(rgb, 0.0), vec3(1.0 / gamma));
  }

  if (vignette > 0.0) {
    vec2 vigUv = uv * (1.0 - uv.yx);
    float vig = vigUv.x * vigUv.y * 15.0;
    vig = pow(clamp(vig, 0.0, 1.0), vignetteDarkness);
    rgb *= mix(1.0 - vignette, 1.0, vig);
  }

  return clamp(rgb, 0.0, 1.0);
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec2 sampleUV = uv;

  if (uvJitter > 0.0) {
    sampleUV.x += sin(uv.y * 8.0 + time * 5.0) * uvJitter;
    sampleUV.y += cos(uv.x * 8.0 + time * 5.0) * uvJitter;
  }

  vec4 color = inputColor;

  if (pixelSize > 0.5 && resolutionScale > 0.0) {
    vec2 screenSize = resolution * resolutionScale;
    sampleUV = floor(sampleUV * screenSize / pixelSize) * pixelSize / screenSize;
    color = texture2D(inputBuffer, sampleUV);
  } else {
    color = texture2D(inputBuffer, sampleUV);
  }

  if (bandIntensity > 0.0 && bands > 1.0) {
    vec3 banded = floor(color.rgb * bands) / bands;
    color.rgb = mix(color.rgb, banded, bandIntensity);
  }

  if (ditherIntensity > 0.0 && colorDepth > 1.0) {
    vec2 pixelCoord = floor(uv * resolution);
    float threshold = bayerPSX(pixelCoord);
    vec3 dithered = floor(color.rgb * colorDepth + threshold) / colorDepth;
    color.rgb = mix(color.rgb, dithered, ditherIntensity);
  }

  if (scanOpacity > 0.0) {
    float scanline = sin(uv.y * scanCount + time * 100.0) * 0.5 + 0.5;
    scanline = pow(scanline, 4.0);
    color.rgb *= mix(1.0, scanline, scanOpacity);
  }

  color.rgb = applyToneMapping(color.rgb, toneMappingMode);
  color.rgb = applyColorGrade(color.rgb, uv);
  outputColor = vec4(color.rgb, inputColor.a);
}
`

export class PsxCompositeEffect extends Effect {
  constructor() {
    super('PsxCompositeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['time', new Uniform(0)],
        ['resolution', new Uniform(new Vector2(1, 1))],
        ['pixelSize', new Uniform(post.pixelSize)],
        ['resolutionScale', new Uniform(post.resolutionScale)],
        ['colorDepth', new Uniform(post.colorDepth)],
        ['ditherIntensity', new Uniform(post.ditherIntensity)],
        ['bands', new Uniform(post.bands)],
        ['bandIntensity', new Uniform(post.bandIntensity)],
        ['scanOpacity', new Uniform(post.scanOpacity)],
        ['scanCount', new Uniform(post.scanCount)],
        ['uvJitter', new Uniform(post.uvJitter)],
        ['exposure', new Uniform(color.exposure)],
        ['toneMappingMode', new Uniform(PSX_TONE_MAPPING_MODE[color.toneMapping])],
        ['brightness', new Uniform(color.brightness)],
        ['contrast', new Uniform(color.contrast)],
        ['saturation', new Uniform(color.saturation)],
        ['gamma', new Uniform(color.gamma)],
        ['vignette', new Uniform(color.vignette)],
        ['vignetteDarkness', new Uniform(color.vignetteDarkness)],
        ['tint', new Uniform(new Vector3(...color.tint))],
      ]),
    })
  }

  override setSize(width: number, height: number) {
    this.uniforms.get('resolution')!.value.set(width, height)
  }

  override update(_renderer: unknown, _inputBuffer: unknown, deltaTime: number) {
    this.uniforms.get('time')!.value += deltaTime
  }
}
