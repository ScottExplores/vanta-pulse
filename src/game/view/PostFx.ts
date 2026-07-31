import { Filter, GlProgram } from "pixi.js";

const vertex = `
precision highp float;
precision highp int;
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void) {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}
void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}`;

const fragment = `
precision highp float;
precision highp int;
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputClamp;
uniform vec4 uInputSize;
uniform float uTime;
uniform float uIntensity;
uniform float uBurst;
uniform float uPhotosafe;
uniform vec2 uBurstOrigin;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main(void) {
  vec2 uv = vTextureCoord;
  float dynamicFx = 1.0 - uPhotosafe;
  float row = floor(uv.y * 90.0);
  float glitchGate = step(0.985, hash(vec2(row, floor(uTime * 10.0)))) * dynamicFx;
  float glitch = (hash(vec2(row + 3.0, floor(uTime * 7.0))) - 0.5) * 0.006 * glitchGate * uBurst;
  vec2 chroma = vec2((0.00045 + uBurst * 0.0014) * uIntensity * dynamicFx, 0.0);
  vec2 sampleUv = clamp(uv + vec2(glitch, 0.0), uInputClamp.xy, uInputClamp.zw);
  float red = texture(uTexture, clamp(sampleUv + chroma, uInputClamp.xy, uInputClamp.zw)).r;
  vec4 base = texture(uTexture, sampleUv);
  float blue = texture(uTexture, clamp(sampleUv - chroma, uInputClamp.xy, uInputClamp.zw)).b;
  vec3 color = vec3(red, base.g, blue);

  float scan = sin((uv.y * uInputSize.y + uTime * 18.0) * 3.14159265) * 0.012 * uIntensity * dynamicFx;
  color -= scan;
  float vignette = smoothstep(0.92, 0.18, length((uv - 0.5) * vec2(1.0, 0.78)));
  color *= mix(0.72, 1.0, vignette);
  float grain = (hash(gl_FragCoord.xy + uTime * 19.0) - 0.5) * 0.018 * uIntensity * dynamicFx;
  color += grain;

  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(luma), color, 1.0 + 0.16 * uIntensity * dynamicFx);
  color *= 1.0 + 0.035 * uIntensity;

  float safeBurst = uBurst * dynamicFx;
  float radialBurst = exp(-distance(uv, uBurstOrigin) * 7.5) * safeBurst;
  color += vec3(0.035, 0.11, 0.15) * radialBurst;
  finalColor = vec4(color * base.a, base.a);
}`;

type UniformBag = {
  uTime: number;
  uIntensity: number;
  uBurst: number;
  uPhotosafe: number;
  uBurstOrigin: Float32Array;
};

export class NeonPostFx {
  readonly filter: Filter;
  private readonly uniforms: UniformBag;
  private burst = 0;

  constructor() {
    this.filter = new Filter({
      glProgram: GlProgram.from({ name: "vanta-pulse-postfx", vertex, fragment }),
      resources: {
        postFxUniforms: {
          uTime: { value: 0, type: "f32" },
          uIntensity: { value: 1, type: "f32" },
          uBurst: { value: 0, type: "f32" },
          uPhotosafe: { value: 0, type: "f32" },
          uBurstOrigin: { value: new Float32Array([0.5, 0.5]), type: "vec2<f32>" },
        },
      },
      resolution: 1,
      padding: 2,
    });
    this.uniforms = (this.filter.resources.postFxUniforms as { uniforms: UniformBag }).uniforms;
  }

  update(deltaSeconds: number, timeSeconds: number) {
    this.burst = Math.max(0, this.burst - deltaSeconds * 2.8);
    this.uniforms.uTime = timeSeconds;
    this.uniforms.uBurst = this.burst;
  }

  trigger(strength = 1, normalizedX = 0.5, normalizedY = 0.5) {
    this.burst = Math.max(this.burst, Math.min(1.5, strength));
    this.uniforms.uBurstOrigin[0] = Math.max(0, Math.min(1, normalizedX));
    this.uniforms.uBurstOrigin[1] = Math.max(0, Math.min(1, normalizedY));
  }

  configure(options: { intensity: number; photosensitive: boolean; resolution?: number }) {
    this.uniforms.uIntensity = Math.max(0, Math.min(1, options.intensity));
    this.uniforms.uPhotosafe = options.photosensitive ? 1 : 0;
    this.filter.enabled = options.intensity > 0.01;
    if (options.resolution !== undefined) this.filter.resolution = options.resolution;
  }

  destroy() {
    this.filter.destroy();
  }
}
