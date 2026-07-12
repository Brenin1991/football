import { BlendFunction, Effect } from 'postprocessing'
import { Uniform, Vector2, Vector3 } from 'three'
import { AAA_CLASSIC } from './aaaSettings'
import { PSX_TONE_MAPPING_GLSL, PSX_TONE_MAPPING_MODE } from '../psx/psxToneMapping'

const { color } = AAA_CLASSIC

const fragmentShader = /* glsl */ `
${PSX_TONE_MAPPING_GLSL}

uniform vec2 resolution;
uniform float brightness;
uniform float contrast;
uniform float saturation;
uniform float gamma;
uniform float vignette;
uniform float vignetteDarkness;
uniform vec3 tint;
uniform float toneMappingMode;

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
  vec4 color = texture2D(inputBuffer, uv);
  color.rgb = applyToneMapping(color.rgb, toneMappingMode);
  color.rgb = applyColorGrade(color.rgb, uv);
  outputColor = vec4(color.rgb, inputColor.a);
}
`

/** Pós-processo AAA — tone mapping + color grade do PSX, sem degradação retro */
export class AaaCompositeEffect extends Effect {
  constructor() {
    super('AaaCompositeEffect', fragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['resolution', new Uniform(new Vector2(1, 1))],
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
}
