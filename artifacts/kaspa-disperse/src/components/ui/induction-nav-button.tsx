import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

const FS = [
  'precision highp float;',
  'uniform vec2 u_res;',
  'uniform float u_time;',
  'uniform float u_arcs;',
  'uniform float u_flash;',
  'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}',
  'float noise(vec2 p){',
  '  vec2 i=floor(p), f=fract(p);',
  '  vec2 u=f*f*(3.0-2.0*f);',
  '  return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),',
  '             mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);',
  '}',
  'float fbm(vec2 p){',
  '  float v=0.0; float a=0.5;',
  '  for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.05+vec2(9.7,3.1); a*=0.5; }',
  '  return v;',
  '}',
  'float sdRBox(vec2 p, vec2 b, float r){',
  '  vec2 q = abs(p) - b + r;',
  '  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;',
  '}',
  'void main(){',
  '  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;',
  '  float ar = u_res.x / u_res.y;',
  '  vec2 hs = vec2(ar * 0.5 - 0.08, 0.5 - 0.08);',
  '  float d = sdRBox(p, hs, 0.18);',
  '  float t = u_time;',
  '  float hover = clamp(u_arcs / 6.0, 0.0, 1.0);',
  '  vec3 col = vec3(0.02, 0.03, 0.035);',
  '  float plate = 1.0 - smoothstep(-0.004, 0.004, d);',
  '  vec3 plateCol = vec3(0.04, 0.05, 0.055);',
  '  plateCol += vec3(0.014, 0.022, 0.035) * fbm(p * 9.0);',
  '  plateCol += vec3(0.0, 0.25, 0.3) * exp(d * 9.0) * (0.25 + hover * 0.6);',
  '  col = mix(col, plateCol, plate);',
  '  col *= 1.0 + 0.5 * exp(-max(d, 0.0) * 16.0) * (1.0 - plate);',
  '  float a = atan(p.y, p.x);',
  '  vec3 arcCol = vec3(0.0);',
  '  for (int i = 0; i < 6; i++) {',
  '    float fi = float(i);',
  '    float w = clamp(u_arcs - fi, 0.0, 1.0);',
  '    float n1 = fbm(vec2(a * 2.4 + fi * 11.3, t * (1.6 + fi * 0.27) + fi * 53.1));',
  '    float off = (n1 - 0.5) * (0.11 + u_flash * 0.1);',
  '    float seg = smoothstep(0.35, 0.75, noise(vec2(a * 1.8 + fi * 7.7, t * (0.9 + fi * 0.13) + fi * 19.0)));',
  '    seg = 0.3 + 0.7 * seg;',
  '    float g = 0.0042 / (abs(d + off) + 0.006);',
  '    arcCol += (vec3(0.0, 0.75, 0.9) * g + vec3(0.6, 1.0, 0.95) * g * g * 0.55) * w * seg;',
  '  }',
  '  float outerMask = 1.0 - smoothstep(0.04, 0.15, d);',
  '  col += arcCol * (0.6 + 0.4 * hover) * outerMask;',
  '  float ring = 0.006 / (abs(d) + 0.006);',
  '  col += vec3(0.8, 0.98, 1.0) * ring * u_flash * 1.5 * outerMask;',
  '  col += vec3(0.7, 0.95, 1.0) * u_flash * 0.16 * outerMask;',
  '  gl_FragColor = vec4(col, 1.0);',
  '}',
].join('\n');

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string) {
  const program = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!program || !vs || !fs) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  return program;
}

export function InductionNavButton({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef(false);
  const flashRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
    if (!gl) {
      canvas.style.background = '#062630';
      canvas.style.boxShadow = '0 0 0 2px #00f2fe, 0 0 24px rgba(0, 242, 254, .5)';
      return;
    }

    const program = createProgram(gl, VS, FS);
    if (!program) return;
    gl.useProgram(program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const locP = gl.getAttribLocation(program, 'p');
    gl.enableVertexAttribArray(locP);
    gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);

    const uRes = gl.getUniformLocation(program, 'u_res');
    const uTime = gl.getUniformLocation(program, 'u_time');
    const uArcs = gl.getUniformLocation(program, 'u_arcs');
    const uFlash = gl.getUniformLocation(program, 'u_flash');

    let arcs = 3.2;
    let crawl = 0;
    let last = performance.now();
    let frame = 0;
    let alive = true;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const render = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const arcsTarget = hoverRef.current ? 5.8 : 3.2;
      arcs += (arcsTarget - arcs) * Math.min(1, dt * 5);
      flashRef.current *= Math.exp(-3.6 * dt);
      crawl += dt * (0.6 + (arcs / 6) * 1.1 + flashRef.current * 2.0);
      resize();
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, reduced ? 3.0 : crawl);
      gl.uniform1f(uArcs, arcs);
      gl.uniform1f(uFlash, flashRef.current);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      frame = requestAnimationFrame(render);
    };

    resize();
    frame = requestAnimationFrame(render);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <span
      className={cn(
        'relative block h-16 overflow-hidden rounded-[18px] shadow-[0_0_28px_rgba(0,210,255,0.35)]',
        className,
      )}
      onMouseEnter={() => {
        hoverRef.current = true;
      }}
      onMouseLeave={() => {
        hoverRef.current = false;
      }}
      onMouseDown={() => {
        flashRef.current = 1;
      }}
    >
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full rounded-[18px]"
      />
      <span className="relative z-10 flex h-full items-center justify-center px-4 text-center text-[12px] font-medium tracking-[0.22em] text-[#e0f7f8] [text-shadow:0_0_12px_rgba(0,210,255,0.7),0_1px_4px_rgba(0,0,0,0.85)]">
        {label}
      </span>
    </span>
  );
}
