import type { ChromaKey } from "./model";

/*
 * Green screen, on the graphics card: every pixel of a picture close to the key colour turns
 * see-through, with a soft edge and the green that spills onto the person taken out. One WebGL
 * canvas, reused frame after frame, for the preview and the export alike (compose.ts draws its
 * result straight away, before the next picture is keyed). Without WebGL the picture is drawn
 * as it is.
 */

type Gl = {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  gl: WebGLRenderingContext;
  texture: WebGLTexture;
  uniforms: { key: WebGLUniformLocation | null; similarity: WebGLUniformLocation | null; smooth: WebGLUniformLocation | null };
};

let state: Gl | null | undefined;

const VERTEX = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = vec2((position.x + 1.0) / 2.0, (1.0 - position.y) / 2.0);
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
uniform sampler2D picture;
uniform vec3 key;
uniform float similarity;
uniform float smoothness;
varying vec2 uv;
vec2 chroma(vec3 c) {
  return vec2(-0.1687 * c.r - 0.3313 * c.g + 0.5 * c.b, 0.5 * c.r - 0.4187 * c.g - 0.0813 * c.b);
}
void main() {
  vec4 c = texture2D(picture, uv);
  float distance = length(chroma(c.rgb) - chroma(key));
  float edge = similarity * 0.42;
  float alpha = smoothstep(edge, edge + 0.002 + smoothness * 0.22, distance);
  // Spill: near the edge, the key's colour is drained out of what stays.
  float spill = (1.0 - smoothstep(edge, edge + 0.2, distance)) * 0.6;
  float grey = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 rgb = mix(c.rgb, vec3(grey), spill);
  gl_FragColor = vec4(rgb * alpha, alpha);
}`;

function setUp(): Gl | null {
  try {
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(2, 2) : document.createElement("canvas");
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, preserveDrawingBuffer: true }) as WebGLRenderingContext | null;
    if (!gl) return null;
    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)!;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
      return shader;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return {
      canvas,
      gl,
      texture,
      uniforms: { key: gl.getUniformLocation(program, "key"), similarity: gl.getUniformLocation(program, "similarity"), smooth: gl.getUniformLocation(program, "smoothness") },
    };
  } catch {
    return null;
  }
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** Whether green screen can be done in this browser. */
export const canKey = () => {
  state ??= typeof document === "undefined" ? null : setUp();
  return state !== null;
};

/**
 * The picture with its key colour see-through, at `width` x `height` (null without WebGL). The
 * result is the shared canvas: draw it before keying the next picture.
 */
export function keyOut(image: CanvasImageSource, width: number, height: number, key: ChromaKey): HTMLCanvasElement | OffscreenCanvas | null {
  if (!canKey() || !state || width <= 0 || height <= 0) return null;
  const { canvas, gl, texture, uniforms } = state;
  // A frame larger than the frame being drawn isn't needed: 1920 on its longer side at most.
  const k = Math.min(1, 1920 / Math.max(width, height));
  const w = Math.max(2, Math.round(width * k));
  const h = Math.max(2, Math.round(height * k));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  try {
    gl.viewport(0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image as TexImageSource);
    gl.uniform3fv(uniforms.key, rgb(key.color));
    gl.uniform1f(uniforms.similarity, key.similarity);
    gl.uniform1f(uniforms.smooth, key.smooth);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return canvas;
  } catch {
    return null;
  }
}
