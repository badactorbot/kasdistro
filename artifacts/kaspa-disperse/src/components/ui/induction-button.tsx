import { useMemo, type CSSProperties } from 'react';

type FocusRole = 'background' | 'button' | 'visual';
type EffectMode = 'light' | 'dark';

type FocusTarget = {
  selector: string;
  role: FocusRole;
  fit?: 'cover' | 'contain-square' | 'wide-wordmark' | 'portrait-stage';
  preserveTransform?: boolean;
};

type EffectDefinition = {
  title: string;
  source: string;
  background: string;
  targets: readonly FocusTarget[];
  theme?: {
    nativeMode?: EffectMode;
    lightBackground: string;
    darkBackground: string;
    invertBackground?: boolean;
  };
  transformSource?: (source: string, mode: EffectMode) => string;
  hiddenTargets?: readonly string[];
  introWordmark?: {
    sceneSelector: string;
    text: string;
    fontSize: number;
    endTime: number;
    holdTime: number;
    logoSvg: string;
  };
};

const inductionSource = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>VALENCE CORE | Kinetic Induction</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://code.iconify.design/iconify-icon/1.0.7/iconify-icon.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.2/gsap.min.js"></script>
</head>
<body class="bg-neutral-950 text-neutral-50 h-screen w-screen overflow-hidden font-sans selection:bg-cyan-500/30 selection:text-cyan-50 flex flex-col relative antialiased">

    <canvas id="bg-canvas" class="absolute inset-0 w-full h-full z-0 opacity-60 pointer-events-none" aria-hidden="true"></canvas>
    <div class="absolute inset-0 z-0 pointer-events-none" style="background: radial-gradient(circle at center, transparent 0%, rgba(10,10,10,0.8) 100%);"></div>

    <nav class="absolute top-0 w-full flex justify-between items-center px-6 py-6 z-20" style="opacity: 0; transform: translateY(-20px);" id="main-nav">
        <div class="flex items-center gap-2">
            <iconify-icon icon="solar:atom-linear" class="text-cyan-500 text-xl" style="stroke-width: 1.5px;"></iconify-icon>
            <span class="font-medium text-sm tracking-tight text-neutral-200">VALENCE SYSTEM</span>
        </div>
        <div class="hidden sm:flex relative p-[1px] rounded-full overflow-hidden items-center justify-center cursor-pointer group transition-transform duration-300 hover:scale-105">
            <div class="absolute inset-0 bg-gradient-to-r from-cyan-500/50 via-neutral-500/10 to-transparent rounded-full group-hover:from-cyan-500/80 transition-colors duration-500"></div>
            <div class="relative bg-neutral-950 rounded-full px-5 py-2 flex items-center gap-2">
                <div class="w-1.5 h-1.5 rounded-full bg-cyan-500" style="box-shadow: 0 0 8px rgba(6, 182, 212, 0.8);"></div>
                <span class="text-xs font-medium tracking-wide text-neutral-300">Induction Active</span>
            </div>
        </div>
    </nav>

    <main class="relative z-10 flex-1 flex flex-col items-center justify-center text-center px-4 w-full h-full max-w-4xl mx-auto">
        <div class="mb-8 flex flex-col items-center" id="intro-tags">
            <div class="font-mono font-medium text-xs tracking-[0.3em] uppercase text-cyan-500 mb-6" style="opacity: 0; transform: translateY(12px);" id="tag-text">
                SYS 12 // Kinetic Pulse
            </div>
            <h1 class="text-4xl sm:text-6xl md:text-7xl font-medium tracking-tight leading-[1.1] text-neutral-50" data-split>
                Command the momentum.
            </h1>
            <p class="mt-6 text-sm sm:text-base text-neutral-400 max-w-md font-normal leading-relaxed" data-split>
                Initialize the valence induction loop. The kinetic perimeter is optimized and standing by for sequence execution.
            </p>
        </div>

        <div class="mt-10 relative flex justify-center w-full" id="btn-container" style="opacity: 0; transform: scale(0.92);">
            <button class="relative flex items-center justify-center w-[280px] h-[96px] bg-transparent cursor-pointer rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 group" id="btn" type="button" style="transition: transform .22s cubic-bezier(.34, 1.4, .5, 1);" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform='translateY(0)'" onmousedown="this.style.transform='translateY(1px) scale(.99)'" onmouseup="this.style.transform='translateY(-2px)'">
                <canvas id="btn-gl" aria-hidden="true" class="absolute inset-0 w-full h-full block rounded-[18px]"></canvas>
                <span id="btn-label" class="relative z-10 pointer-events-none font-medium text-sm tracking-[0.3em] indent-[0.3em] text-[#e0f7f8]" style="text-shadow: 0 0 12px rgba(0, 210, 255, .6), 0 1px 4px rgba(0, 0, 0, .8);">VALENCE CORE</span>
            </button>
        </div>

        <p class="mt-8 text-xs text-neutral-500 tracking-wide font-normal" style="opacity: 0; transform: translateY(12px);" id="note-text">
            Hover to trigger neural arcs, click to unleash a synchronized valence discharge.
        </p>
    </main>

    <script>
        document.addEventListener("DOMContentLoaded", () => {
            document.querySelectorAll('[data-split]').forEach(el => {
                const text = el.innerText;
                el.innerHTML = '';
                text.split(' ').forEach(word => {
                    if (word.trim() === '') return;
                    const wrapper = document.createElement('span');
                    wrapper.style.display = 'inline-block';
                    wrapper.style.overflow = 'hidden';
                    wrapper.style.verticalAlign = 'top';
                    wrapper.style.marginRight = '0.25em';
                    wrapper.style.paddingBottom = '0.1em';
                    const inner = document.createElement('span');
                    inner.style.display = 'inline-block';
                    inner.style.transform = 'translateY(100%)';
                    inner.style.opacity = '0';
                    inner.className = 'mask-target';
                    inner.innerText = word;
                    wrapper.appendChild(inner);
                    el.appendChild(wrapper);
                });
            });

            if (typeof gsap === 'undefined') return;
            const tl = gsap.timeline();
            tl.to("#main-nav", { y: 0, opacity: 1, duration: 1, ease: "power3.out", delay: 0.2 });
            tl.to("#tag-text", { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }, "-=0.6");
            tl.to(".mask-target", { y: "0%", opacity: 1, duration: 0.8, stagger: 0.04, ease: "power3.out" }, "-=0.4");
            tl.to("#btn-container", {
                keyframes: {
                    "0%":   { opacity: 0, scale: 0.92 },
                    "9%":   { opacity: 0.85 },
                    "15%":  { opacity: 0.12 },
                    "24%":  { opacity: 0.92 },
                    "31%":  { opacity: 0.35 },
                    "44%":  { opacity: 1, scale: 1.015 },
                    "100%": { opacity: 1, scale: 1 }
                },
                duration: 1.15,
                ease: "none"
            }, "-=0.2");
            tl.to("#note-text", { y: 0, opacity: 1, duration: 0.8, ease: "power3.out" }, "-=0.5");
        });

        (function () {
            const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            function compileShader(gl, type, src) {
                const s = gl.createShader(type);
                gl.shaderSource(s, src);
                gl.compileShader(s);
                return s;
            }

            function createProgram(gl, vsSrc, fsSrc) {
                const prog = gl.createProgram();
                gl.attachShader(prog, compileShader(gl, gl.VERTEX_SHADER, vsSrc));
                gl.attachShader(prog, compileShader(gl, gl.FRAGMENT_SHADER, fsSrc));
                gl.linkProgram(prog);
                return prog;
            }

            const VS = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';

            function initBackgroundGL() {
                const canvas = document.getElementById('bg-canvas');
                const gl = canvas.getContext('webgl', { alpha: false, antialias: false });
                if (!gl) return;

                const FS_BG = \`
                    precision highp float;
                    uniform vec2 u_res;
                    uniform float u_time;
                    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
                    float noise(vec2 p){
                        vec2 i=floor(p), f=fract(p);
                        vec2 u=f*f*(3.0-2.0*f);
                        return mix(mix(hash(i),hash(i+vec2(1.,0.)),u.x),
                                   mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),u.x),u.y);
                    }
                    float fbm(vec2 p){
                        float v=0.0; float a=0.5;
                        for(int i=0;i<4;i++){ v+=a*noise(p); p=p*2.05+vec2(9.7,3.1); a*=0.5; }
                        return v;
                    }
                    void main(){
                        vec2 uv = gl_FragCoord.xy / u_res.y;
                        float t = u_time * 0.1;
                        float n1 = fbm(uv * 1.5 + vec2(t * 0.2, t * 0.1));
                        float n2 = fbm(uv * 2.0 - vec2(t * 0.15, -t * 0.2) + n1);
                        vec3 baseCol = vec3(0.039, 0.039, 0.039);
                        vec3 highlightCol = vec3(0.01, 0.08, 0.12);
                        vec3 col = mix(baseCol, highlightCol, n2 * 0.4);
                        vec2 grid = fract(uv * 20.0);
                        float line = smoothstep(0.95, 1.0, max(grid.x, grid.y));
                        col += vec3(0.015) * line * (1.0 - n1);
                        gl_FragColor = vec4(col, 1.0);
                    }
                \`;

                const prog = createProgram(gl, VS, FS_BG);
                gl.useProgram(prog);
                const buf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
                const locP = gl.getAttribLocation(prog, 'p');
                gl.enableVertexAttribArray(locP);
                gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);
                const uRes = gl.getUniformLocation(prog, 'u_res');
                const uTime = gl.getUniformLocation(prog, 'u_time');

                function resize() {
                    const dpr = Math.min(window.devicePixelRatio || 1, 2);
                    const w = Math.round(canvas.clientWidth * dpr);
                    const h = Math.round(canvas.clientHeight * dpr);
                    if (canvas.width !== w || canvas.height !== h) {
                        canvas.width = w; canvas.height = h;
                        gl.viewport(0, 0, w, h);
                    }
                }
                window.addEventListener('resize', resize);
                resize();

                function render(now) {
                    resize();
                    gl.uniform2f(uRes, canvas.width, canvas.height);
                    gl.uniform1f(uTime, reduced ? 0 : now / 1000);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    requestAnimationFrame(render);
                }
                requestAnimationFrame(render);
            }

            function initButtonGL() {
                const btn = document.getElementById('btn');
                const canvas = document.getElementById('btn-gl');
                const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
                if (!gl) {
                    btn.style.background = '#062630';
                    btn.style.boxShadow = '0 0 0 2px #00f2fe, 0 0 24px rgba(0, 242, 254, .5)';
                    return;
                }

                const FS_BTN = [
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
                    '  vec2 hs = vec2(ar * 0.5 - 0.2, 0.5 - 0.2);',
                    '  float d = sdRBox(p, hs, 0.14);',
                    '  float t = u_time;',
                    '  float hover = clamp(u_arcs / 6.0, 0.0, 1.0);',
                    '  vec3 col = vec3(0.039, 0.039, 0.039);',
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
                    '}'
                ].join('\\n');

                const prog = createProgram(gl, VS, FS_BTN);
                gl.useProgram(prog);
                const buf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, buf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
                const locP = gl.getAttribLocation(prog, 'p');
                gl.enableVertexAttribArray(locP);
                gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);
                const uRes = gl.getUniformLocation(prog, 'u_res');
                const uTime = gl.getUniformLocation(prog, 'u_time');
                const uArcs = gl.getUniformLocation(prog, 'u_arcs');
                const uFlash = gl.getUniformLocation(prog, 'u_flash');

                function resize() {
                    const dpr = Math.min(window.devicePixelRatio || 1, 2);
                    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
                    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
                    if (canvas.width !== w || canvas.height !== h) {
                        canvas.width = w; canvas.height = h;
                        gl.viewport(0, 0, w, h);
                    }
                }
                window.addEventListener('resize', resize);
                resize();

                let arcs = 2.4, arcsTarget = 2.4, flash = 0, crawl = 0;
                let last = performance.now();

                btn.addEventListener('mouseenter', () => arcsTarget = 5.8);
                btn.addEventListener('mouseleave', () => arcsTarget = 2.4);
                btn.addEventListener('focus', () => arcsTarget = 5.8);
                btn.addEventListener('blur', () => arcsTarget = 2.4);
                btn.addEventListener('click', () => flash = 1);

                function frame(now) {
                    const dt = Math.min(0.05, (now - last) / 1000);
                    last = now;
                    arcs += (arcsTarget - arcs) * Math.min(1, dt * 5);
                    flash *= Math.exp(-3.6 * dt);
                    crawl += dt * (0.6 + (arcs / 6) * 1.1 + flash * 2.0);
                    resize();
                    gl.uniform2f(uRes, canvas.width, canvas.height);
                    gl.uniform1f(uTime, reduced ? 3.0 : crawl);
                    gl.uniform1f(uArcs, arcs);
                    gl.uniform1f(uFlash, flash);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    requestAnimationFrame(frame);
                }
                requestAnimationFrame(frame);
            }

            initBackgroundGL();
            initButtonGL();
        })();
    </script>
</body>
</html>`;

const INDUCTION_EFFECT: EffectDefinition = {
  title: 'Induction Button kinetic button',
  source: inductionSource,
  background: '#050505',
  theme: {
    nativeMode: 'dark',
    lightBackground: '#f4f7fb',
    darkBackground: '#050505',
    invertBackground: true,
  },
  targets: [
    { selector: '#bg-canvas', role: 'background' },
    { selector: '#btn', role: 'button' },
  ],
};

export type InductionButtonProps = {
  mode?: EffectMode;
  hue?: number;
  saturation?: number;
  brightness?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
  compact?: boolean;
};

const DEFAULTS = {
  mode: 'dark' as EffectMode,
  hue: 0,
  saturation: 1,
  brightness: 1,
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function effectBackground(definition: EffectDefinition, mode: EffectMode) {
  return definition.theme?.[`${mode}Background`] ?? definition.background;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildFocusedDocument(
  definition: EffectDefinition,
  mode: EffectMode,
  options: { label?: string; compact?: boolean },
) {
  const background = effectBackground(definition, mode);
  const invertBackground =
    definition.theme?.invertBackground === true &&
    definition.theme.nativeMode !== mode;
  let source =
    definition.transformSource?.(definition.source, mode) ?? definition.source;
  if (options.label) {
    source = source.replace(
      '>VALENCE CORE</span>',
      `>${escapeHtml(options.label)}</span>`,
    );
  }
  const targets = options.compact
    ? definition.targets.filter((target) => target.role === 'button')
    : definition.targets;
  const targetJson = JSON.stringify(targets).replace(/</g, '\\u003c');
  const hiddenTargetJson = JSON.stringify(definition.hiddenTargets ?? []).replace(
    /</g,
    '\\u003c',
  );
  const introWordmarkJson = JSON.stringify(definition.introWordmark ?? null).replace(
    /</g,
    '\\u003c',
  );
  const modeJson = JSON.stringify(mode);
  const backgroundFilter = invertBackground
    ? 'filter: invert(1) hue-rotate(180deg) saturate(.92) brightness(1.02) !important;'
    : '';
  const introWordmarkStyle = definition.introWordmark
    ? `${definition.introWordmark.sceneSelector} .tx { font-size: ${definition.introWordmark.fontSize}px !important; }`
    : '';
  const compactStyle = options.compact
    ? `#btn-container { opacity: 1 !important; transform: none !important; width: 100% !important; height: 100% !important; margin: 0 !important; }
[data-threeui-role="button"] { width: 100% !important; height: 100% !important; max-width: none !important; border-radius: 14px !important; }
#btn { width: 100% !important; height: 100% !important; }
#btn-gl { border-radius: 14px !important; }
#btn-label { font-size: 11px !important; letter-spacing: 0.18em !important; }`
    : '';
  const focusStyle = `<style data-threeui-focus>
html, body { width: 100% !important; height: 100% !important; min-height: 0 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: ${background} !important; color-scheme: ${mode} !important; }
body { position: relative !important; display: flex !important; align-items: center !important; justify-content: center !important; }
body > * { visibility: hidden !important; }
body[data-threeui-ready] > [data-threeui-role] { visibility: visible !important; }
[data-threeui-residual] { display: none !important; }
[data-threeui-hidden] { display: none !important; }
[data-threeui-role="background"] { position: fixed !important; inset: 0 !important; width: 100% !important; height: 100% !important; max-width: none !important; max-height: none !important; z-index: 0 !important; opacity: 1 !important; pointer-events: none !important; ${backgroundFilter} }
[data-threeui-role="background"][data-threeui-fit="contain-square"] { position: absolute !important; top: 50% !important; right: auto !important; bottom: auto !important; left: 50% !important; width: min(100vw, 100vh) !important; height: min(100vw, 100vh) !important; aspect-ratio: 1 / 1 !important; transform: translate(-50%, -50%) !important; }
[data-threeui-role="button"] { position: relative !important; z-index: 2 !important; opacity: 1 !important; flex: none !important; }
[data-threeui-role="button"]:not([data-threeui-preserve-transform]) { transform: none !important; }
[data-threeui-role="visual"] { position: relative !important; z-index: 1 !important; width: min(100%, 1040px) !important; max-width: 1040px !important; max-height: 100% !important; margin: auto !important; padding: 24px !important; overflow: auto !important; opacity: 1 !important; filter: none !important; }
[data-threeui-role="visual"]:not([data-threeui-preserve-transform]) { transform: none !important; }
[data-threeui-role="visual"][data-threeui-fit="contain-square"] { flex: none !important; width: min(calc(100vw - 32px), calc(100vh - 32px)) !important; max-width: none !important; height: min(calc(100vw - 32px), calc(100vh - 32px)) !important; max-height: none !important; aspect-ratio: 1 / 1 !important; padding: 0 !important; overflow: hidden !important; }
[data-threeui-role="visual"][data-threeui-fit="wide-wordmark"] { width: min(calc(100vw - 48px), 1180px) !important; max-width: calc(100vw - 48px) !important; height: auto !important; max-height: none !important; aspect-ratio: 16 / 3 !important; padding: 0 !important; overflow: hidden !important; }
[data-threeui-role="visual"][data-threeui-fit="portrait-stage"] { position: absolute !important; top: 50% !important; right: auto !important; bottom: auto !important; left: 50% !important; width: 1080px !important; max-width: none !important; height: 1350px !important; max-height: none !important; padding: 0 !important; overflow: hidden !important; transform-origin: center !important; }
${introWordmarkStyle}
${compactStyle}
</style>`;
  const focusScript = `<script data-threeui-focus>
(function () {
  document.documentElement.dataset.sfMode = ${modeJson};
  var isolated = false;
  function isolate() {
    if (isolated) return;
    var specs = ${targetJson};
    var hiddenSelectors = ${hiddenTargetJson};
    var introWordmark = ${introWordmarkJson};
    var roots = [];
    hiddenSelectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (element) {
        element.setAttribute('data-threeui-hidden', '');
        element.setAttribute('aria-hidden', 'true');
        if ('inert' in element) element.inert = true;
      });
    });
    specs.forEach(function (spec) {
      var element = document.querySelector(spec.selector);
      if (!element) return;
      element.setAttribute('data-threeui-role', spec.role);
      if (spec.fit) element.setAttribute('data-threeui-fit', spec.fit);
      if (spec.preserveTransform) element.setAttribute('data-threeui-preserve-transform', '');
      if (!roots.some(function (root) { return root.contains(element); })) roots.push(element);
    });
    if (introWordmark) {
      var introScene = document.querySelector(introWordmark.sceneSelector);
      var introText = introScene && introScene.querySelector('.tx');
      var introMark = introText && introText.querySelector('.mark');
      if (introText && introMark) {
        introMark.innerHTML = introWordmark.logoSvg;
        var introCharacters = Array.from(introText.children).filter(function (element) { return element !== introMark; });
        introCharacters.forEach(function (element, index) {
          element.textContent = introWordmark.text[index] === ' ' ? '\\u00a0' : (introWordmark.text[index] || '');
          element.style.display = index < introWordmark.text.length ? 'inline-block' : 'none';
        });
      }
      var introReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      var introStartedAt = performance.now();
      function renderIntroWordmark(now) {
        if (typeof window.__seek !== 'function') return;
        if (introReducedMotion) {
          window.__seek(introWordmark.endTime);
          return;
        }
        var introCycle = introWordmark.endTime + introWordmark.holdTime;
        var introTime = ((now - introStartedAt) / 1000) % introCycle;
        window.__seek(Math.min(introTime, introWordmark.endTime));
        requestAnimationFrame(renderIntroWordmark);
      }
      requestAnimationFrame(renderIntroWordmark);
    }
    if (!roots.length) return;
    isolated = true;
    roots.forEach(function (root) {
      var placeholderLink = root.matches('a[href="#"]') ? root : root.querySelector('a[href="#"]');
      if (placeholderLink) placeholderLink.addEventListener('click', function (event) { event.preventDefault(); });
      document.body.appendChild(root);
    });
    Array.from(document.body.children).forEach(function (element) {
      if (roots.indexOf(element) !== -1) return;
      element.setAttribute('data-threeui-residual', '');
      element.setAttribute('aria-hidden', 'true');
      if ('inert' in element) element.inert = true;
    });
    document.body.setAttribute('data-threeui-ready', '');
    requestAnimationFrame(function () { window.dispatchEvent(new Event('resize')); });
  }
  function scheduleIsolation() { setTimeout(isolate, ${options.compact ? 0 : 100}); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scheduleIsolation, { once: true });
  else scheduleIsolation();
  window.addEventListener('load', isolate, { once: true });
})();
</script>`;
  return source
    .replace(/<\/head>/i, `${focusStyle}</head>`)
    .replace(/<\/body>/i, `${focusScript}</body>`);
}

function NeuformIsolatedEffect({
  definition,
  mode = DEFAULTS.mode,
  hue = DEFAULTS.hue,
  saturation = DEFAULTS.saturation,
  brightness = DEFAULTS.brightness,
  className,
  style,
  label,
  compact = false,
}: InductionButtonProps & { definition: EffectDefinition }) {
  const safeMode: EffectMode = mode === 'light' ? 'light' : 'dark';
  const background = effectBackground(definition, safeMode);
  const source = useMemo(
    () => buildFocusedDocument(definition, safeMode, { label, compact }),
    [definition, safeMode, label, compact],
  );
  const safeHue = clamp(hue, -180, 180);
  const safeSaturation = clamp(saturation, 0, 2);
  const safeBrightness = clamp(brightness, 0.35, 1.65);
  const filter =
    safeHue === 0 && safeSaturation === 1 && safeBrightness === 1
      ? undefined
      : `hue-rotate(${safeHue}deg) saturate(${safeSaturation}) brightness(${safeBrightness})`;

  return (
    <iframe
      className={className}
      data-mode={safeMode}
      title={definition.title}
      srcDoc={source}
      sandbox="allow-scripts"
      loading="eager"
      tabIndex={-1}
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        border: 0,
        background,
        filter,
        ...style,
      }}
    />
  );
}

function InductionButton(props: InductionButtonProps) {
  return <NeuformIsolatedEffect {...props} definition={INDUCTION_EFFECT} />;
}

export default InductionButton;
