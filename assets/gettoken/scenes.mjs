// Hero scene: an orbital sunrise over the night side of a planet, drawn by one
// WebGL fragment shader. Decorative only. It renders at reduced resolution,
// pauses off-screen / in background tabs, and draws a single still frame when
// the visitor prefers reduced motion. Returns false if WebGL is unavailable so
// the page can keep its CSS fallback glow.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAGMENT = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;      // backing-store size in device pixels
uniform float uScale;   // device pixels per CSS pixel
uniform float uTime;
uniform float uIntro;   // 0..1 eased entrance: planet rises, air and sun light up
uniform float uHorizon; // y of the planet's top limb, CSS px from the top

const vec3 BG = vec3(0.043, 0.043, 0.063);

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash3(i), hash3(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash3(i + vec3(0.0, 1.0, 0.0)), hash3(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash3(i + vec3(0.0, 0.0, 1.0)), hash3(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash3(i + vec3(0.0, 1.0, 1.0)), hash3(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    amp *= 0.5;
  }
  return sum;
}

float starLayer(vec2 p, float cell, float density) {
  vec2 g = floor(p / cell);
  vec2 f = fract(p / cell) - 0.5;
  float h = hash2(g);
  if (h < 1.0 - density) return 0.0;
  vec2 o = vec2(hash2(g + 3.1), hash2(g + 7.7)) - 0.5;
  float d = length(f - o * 0.7) * cell;
  float twinkle = 0.55 + 0.45 * sin(uTime * (0.8 + h * 2.5) + h * 40.0);
  float size = 0.6 + 1.1 * fract(h * 13.0);
  return smoothstep(size, 0.0, d) * twinkle * (0.4 + 0.6 * fract(h * 7.0));
}

void main() {
  vec2 frag = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  float W = uRes.x / uScale;
  float R = max(W * 1.25, 760.0);
  vec2 c = vec2(W * 0.5, uHorizon + R + (1.0 - uIntro) * 56.0);
  float airIn = smoothstep(0.0, 0.85, uIntro);
  float sunIn = smoothstep(0.35, 1.0, uIntro);
  vec2 d = frag - c;
  float dist = length(d);
  float h = dist - R;                 // > 0 in space, < 0 on the planet (CSS px)
  vec2 nd = d / dist;

  // The sun sits on the limb, right of centre.
  float sa = asin(clamp((0.74 * W - c.x) / R, -1.0, 1.0));
  vec2 sunDir = vec2(sin(sa), -cos(sa));
  vec2 sunPos = c + sunDir * R;
  float towardSun = max(dot(nd, sunDir), 0.0);
  float arcTop = max(-nd.y, 0.0);
  float arcSun = pow(towardSun, 900.0);       // tight around the sun along the arc
  float arcWide = pow(towardSun, 60.0);

  // Space and surface are shaded separately and blended across ~1 device pixel
  // at the limb, so the planet's edge is antialiased instead of stair-stepped.
  float aa = 1.0 / uScale;
  vec3 space = BG;
  vec3 surf = BG;

  if (h > -aa) {
    // Space: nebula wash + two parallax star layers that thin out near the air glow.
    vec2 q = frag / W;
    float neb = fbm(vec3(q * vec2(2.0, 3.0) + vec2(uTime * 0.002, 0.0), uTime * 0.01));
    vec3 nebCol = mix(vec3(0.24, 0.13, 0.52), vec3(0.09, 0.22, 0.6), smoothstep(0.1, 0.9, q.x));
    float nebMask = smoothstep(0.0, 0.5, h / max(uHorizon, 1.0)) * 0.6 + 0.4;
    space += nebCol * pow(neb, 3.2) * 0.42 * nebMask;

    // Two star layers drifting very slowly at different speeds for depth.
    vec2 sp1 = frag + vec2(uTime * 0.6, 0.0);
    vec2 sp2 = frag + vec2(uTime * 1.4, 0.0);
    float stars = starLayer(sp1, 38.0, 0.16) + starLayer(sp2 + 91.0, 71.0, 0.28) * 1.3;
    stars *= smoothstep(10.0, 220.0, h) * smoothstep(0.0, 0.7, uIntro);

    // A rare, faint shooting star in the upper sky.
    float cycle = floor(uTime / 11.0);
    float mt = (uTime - cycle * 11.0 - 4.0) / 0.9;
    if (mt > 0.0 && mt < 1.0) {
      vec2 dir = normalize(vec2(-1.0, 0.42));
      vec2 start = vec2(W * (0.45 + 0.45 * hash2(vec2(cycle, 1.3))), uHorizon * (0.08 + 0.3 * hash2(vec2(cycle, 7.1))));
      vec2 rel = frag - (start + dir * mt * 300.0);
      float along = dot(rel, -dir);
      float across = abs(dot(rel, vec2(-dir.y, dir.x)));
      float trail = step(0.0, along) * exp(-along / 70.0) * exp(-across / 0.8);
      space += vec3(0.82, 0.88, 1.0) * trail * sin(mt * 3.14159) * 0.8;
    }
    space += vec3(0.82, 0.86, 1.0) * stars;
  }
  if (h < aa) {
    // Planet: night side with continents, drifting clouds and warm city lights.
    vec2 uv = d / R;
    float z = sqrt(max(1.0 - dot(uv, uv), 0.0));
    vec3 n = vec3(uv.x, -uv.y, z);
    float tilt = 0.62;
    vec3 p = vec3(n.x, n.y * cos(tilt) - n.z * sin(tilt), n.y * sin(tilt) + n.z * cos(tilt));
    float rot = uTime * 0.01;
    p = vec3(p.x * cos(rot) - p.z * sin(rot), p.y, p.x * sin(rot) + p.z * cos(rot));

    float land = smoothstep(0.5, 0.56, fbm(p * 2.6));
    float cloud = smoothstep(0.48, 0.9, fbm(p * 4.2 + vec3(uTime * 0.008, 0.0, uTime * 0.004)));
    vec3 L = normalize(vec3(sunDir.x * 0.45, -sunDir.y * 0.45, -0.9));   // sun behind the planet: only a thin crescent is lit
    float day = clamp(dot(n, L) * 1.8 + 0.04, 0.0, 1.0);

    surf = mix(vec3(0.012, 0.02, 0.052), vec3(0.035, 0.045, 0.08), land);
    surf += vec3(0.22, 0.38, 0.72) * day * (0.25 + 0.25 * land);

    float clusters = smoothstep(0.48, 0.68, fbm(p * 7.0 + 11.0));
    float sparks = smoothstep(0.74, 0.95, noise(p * 170.0)) + 0.12 * smoothstep(0.62, 0.9, noise(p * 40.0));
    float limbFade = smoothstep(0.03, 0.16, z);
    surf += vec3(1.0, 0.55, 0.2) * sparks * clusters * land * (1.0 - day) * limbFade * 2.0;

    surf = mix(surf, vec3(0.5, 0.62, 0.86) * (0.07 + day * 0.7), cloud * 0.5);

    // Inner haze: the atmosphere seen against the surface near the limb.
    float rim = pow(1.0 - z, 4.0);
    surf += vec3(0.22, 0.42, 1.0) * rim * (0.1 + 0.22 * arcTop + 0.7 * arcWide);

    // Sink the lower planet back into the page colour.
    float deep = smoothstep(140.0, 520.0, -h);
    surf = mix(surf, BG * 0.9, deep * 0.55);
  }
  vec3 col = mix(surf, space, smoothstep(-aa, aa, h));

  // Atmosphere: soft layers instead of a drawn line, brighter toward the sun.
  float strength = 0.16 + 0.38 * arcTop + 0.85 * arcWide;
  float limb = exp(-abs(h) / (h > 0.0 ? 7.0 : 3.5));
  float halo = h > 0.0 ? exp(-h / 34.0) : exp(h / 8.0);
  float veil = h > 0.0 ? exp(-h / 210.0) : exp(h / 40.0);
  strength *= airIn;
  col += vec3(0.62, 0.86, 1.0) * limb * strength * 0.75;
  col += vec3(0.24, 0.46, 1.0) * halo * strength * 0.32;
  col += vec3(0.42, 0.28, 0.95) * veil * (0.05 + 0.13 * arcTop + 0.18 * arcWide) * airIn;

  // Orbital sunrise peeking over the limb, with a slow breathing glow.
  vec2 toSun = frag - sunPos;
  float sd = length(toSun);
  float breathe = (0.88 + 0.12 * sin(uTime * 0.3)) * sunIn;
  float above = smoothstep(-8.0, 14.0, h);
  float core = exp(-sd / 10.0) * 1.6;
  float bloom = 1.0 / (1.0 + sd * sd / 4900.0);
  vec2 tangent = vec2(-sunDir.y, sunDir.x);
  float streak = exp(-abs(dot(toSun, sunDir)) / 2.0) * exp(-abs(dot(toSun, tangent)) / 170.0);
  col += vec3(1.0, 0.86, 0.66) * (core + bloom * 0.38) * breathe * above;
  col += vec3(0.75, 0.85, 1.0) * streak * 0.45 * breathe;
  col += vec3(1.0, 0.7, 0.45) * arcSun * limb * 0.8 * sunIn;

  // Fade the bottom edge into the page so the hero has no seam with the next section.
  float H = uRes.y / uScale;
  col = mix(col, BG, smoothstep(H - 150.0, H - 4.0, frag.y));

  col += (hash2(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;   // dither against banding
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[hero] shader failed:', gl.getShaderInfoLog(shader));
    return null;
  }
  return shader;
}

export function initEarth(canvas, { anchor, hero }) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  if (!gl) return false;
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vs || !fs) return false;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = name => gl.getUniformLocation(program, name);
  const uRes = u('uRes');
  const uScale = u('uScale');
  const uTime = u('uTime');
  const uIntro = u('uIntro');
  const uHorizon = u('uHorizon');

  let scale = 1;
  let baseHorizon = 0;
  let visible = false;
  let raf = 0;
  let last = 0;
  let rise = 0;
  let snap = true;
  const start = performance.now();
  const INTRO_MS = 2600;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Soft glows tolerate a lower render resolution; it keeps the shader cheap.
    const quality = rect.width > 900 ? 0.85 : 0.9;
    scale = Math.min(window.devicePixelRatio || 1, 1.5) * quality;
    canvas.width = Math.round(rect.width * scale);
    canvas.height = Math.round(rect.height * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
    // Put the limb just above the stats panel so the panel sits on the glow.
    const heroRect = hero.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    baseHorizon = Math.min(rect.height - 60, Math.max(rect.height * 0.4, anchorRect.top - heroRect.top - 36));
    draw(performance.now());
  }

  function draw(now) {
    // A gentle parallax: the planet rises at most ~36px while the hero scrolls away.
    // After a pause (off-screen, background tab) jump straight to the target
    // instead of easing back from a stale position.
    const target = Math.min(window.scrollY / Math.max(hero.offsetHeight, 1), 1) * 36;
    rise = reduceMotion.matches || snap ? target : rise + (target - rise) * 0.15;
    snap = false;
    const p = reduceMotion.matches ? 1 : Math.min(1, (now - start) / INTRO_MS);
    const intro = 1 - Math.pow(1 - p, 3);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uScale, scale);
    gl.uniform1f(uTime, reduceMotion.matches ? 8 : (now - start) / 1000);
    gl.uniform1f(uIntro, intro);
    gl.uniform1f(uHorizon, baseHorizon - rise);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // The scene moves slowly, so ~30fps looks the same and halves GPU work.
  function frame(now) {
    raf = 0;
    if (now - last >= 30) {
      last = now;
      draw(now);
    }
    if (visible && !document.hidden && !reduceMotion.matches) raf = requestAnimationFrame(frame);
  }
  const play = () => {
    if (raf || !visible || document.hidden) return;
    snap = true;
    raf = requestAnimationFrame(frame);
  };

  if (reduceMotion.matches) window.addEventListener('scroll', () => { if (visible) draw(performance.now()); }, { passive: true });
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    play();
  }).observe(canvas);
  document.addEventListener('visibilitychange', play);
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); cancelAnimationFrame(raf); raf = 0; hero.classList.remove('has-scene'); });
  hero.classList.add('has-scene');
  return true;
}
