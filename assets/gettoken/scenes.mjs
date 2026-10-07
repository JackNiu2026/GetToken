// Canvas scene for the hero horizon. Decorative only.
// It pauses off-screen / in background tabs and renders one still frame
// when the visitor prefers reduced motion.

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function createLoop(canvas, draw, { onResize } = {}) {
  const ctx = canvas.getContext('2d');
  let width = 0;
  let height = 0;
  let dpr = 1;
  let visible = false;
  let raf = 0;
  let start = performance.now();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    onResize?.(width, height);
    if (!raf) frame(performance.now());
  }

  function frame(now) {
    raf = 0;
    if (!width || !height) return;
    draw(ctx, width, height, (now - start) / 1000);
    if (visible && !document.hidden && !reduceMotion.matches) raf = requestAnimationFrame(frame);
  }

  function play() {
    if (!raf && visible) raf = requestAnimationFrame(frame);
  }

  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    if (visible) play();
  }).observe(canvas);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) play(); });
  reduceMotion.addEventListener?.('change', play);
  return { play, reset: () => { start = performance.now(); } };
}

/* ---------- Hero horizon ---------- */
export function initHorizon(canvas, { anchor, hero }) {
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  let stars = [];
  let horizonY = 0;

  function seedStars(w, h) {
    const count = Math.round(Math.min(160, (w * h) / 9000));
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h * 0.75,
      r: Math.random() * 1.1 + 0.25,
      a: Math.random() * 0.6 + 0.15,
      p: Math.random() * Math.PI * 2,
      d: Math.random() * 0.6 + 0.2,
    }));
  }

  function measure(w, h) {
    // Put the planet's rim just above the stats panel so the panel sits on the glow.
    const heroRect = hero.getBoundingClientRect();
    const anchorRect = anchor.getBoundingClientRect();
    horizonY = Math.min(h - 60, Math.max(h * 0.4, anchorRect.top - heroRect.top - 36));
    seedStars(w, h);
  }

  window.addEventListener('pointermove', event => {
    pointer.tx = (event.clientX / window.innerWidth - 0.5) * 2;
    pointer.ty = (event.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });

  function draw(ctx, w, h, t) {
    pointer.x += (pointer.tx - pointer.x) * 0.04;
    pointer.y += (pointer.ty - pointer.y) * 0.04;
    ctx.clearRect(0, 0, w, h);

    // Stars with gentle twinkle and parallax.
    for (const s of stars) {
      const alpha = s.a * (0.6 + 0.4 * Math.sin(t * s.d * 2 + s.p));
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#c9cdf5';
      ctx.beginPath();
      ctx.arc(s.x - pointer.x * 8 * s.d, s.y - pointer.y * 6 * s.d, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const cx = w / 2 + pointer.x * 18;
    const radius = Math.max(w * 1.15, 1100);
    const cy = horizonY + radius;

    // Atmosphere glow above the rim.
    const glow = ctx.createRadialGradient(cx, horizonY + 40, 0, cx, horizonY + 40, Math.max(w * 0.6, 520));
    glow.addColorStop(0, 'rgba(120, 90, 255, 0.38)');
    glow.addColorStop(0.35, 'rgba(80, 110, 255, 0.14)');
    glow.addColorStop(1, 'rgba(80, 110, 255, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    // Flowing aurora bands that ride along the horizon.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bands = [
      { amp: 26, len: 0.0042, speed: 0.35, off: -46, color: [91, 140, 255], alpha: 0.16 },
      { amp: 34, len: 0.0031, speed: -0.22, off: -18, color: [160, 123, 255], alpha: 0.2 },
      { amp: 18, len: 0.0056, speed: 0.5, off: -70, color: [229, 122, 214], alpha: 0.1 },
    ];
    for (const b of bands) {
      const grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, `rgba(${b.color}, 0)`);
      grad.addColorStop(0.5, `rgba(${b.color}, ${b.alpha})`);
      grad.addColorStop(1, `rgba(${b.color}, 0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.2;
      for (let k = 0; k < 6; k += 1) {
        ctx.beginPath();
        for (let x = 0; x <= w; x += 12) {
          const curve = Math.pow((x - cx) / (w * 0.9), 2) * 120;
          const y = horizonY + b.off - k * 7 + curve * 0.5 +
            Math.sin(x * b.len + t * b.speed + k * 0.35) * b.amp * (1 - k * 0.1) +
            pointer.y * 6;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.globalAlpha = 1 - k * 0.14;
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Planet body.
    const body = ctx.createLinearGradient(0, horizonY, 0, h);
    body.addColorStop(0, '#0f0d22');
    body.addColorStop(0.3, '#08080f');
    body.addColorStop(1, '#07070b');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Latitude dots drifting across the surface.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
    for (let row = 1; row < 9; row += 1) {
      const rr = radius - row * row * 6;
      const alpha = 0.32 - row * 0.032;
      ctx.fillStyle = `rgba(170, 160, 255, ${alpha})`;
      const step = 0.006 + row * 0.0012;
      const shift = (t * 0.012 * (row % 2 ? 1 : -1)) % step;
      for (let a = -Math.PI / 2 - 0.9; a < -Math.PI / 2 + 0.9; a += step) {
        const ang = a + shift;
        const x = cx + Math.cos(ang) * rr;
        const y = cy + Math.sin(ang) * rr;
        if (x < -4 || x > w + 4 || y > h) continue;
        ctx.fillRect(x, y, 1.3, 1.3);
      }
    }
    ctx.restore();

    // Rim light.
    const rim = ctx.createLinearGradient(cx - w * 0.6, 0, cx + w * 0.6, 0);
    rim.addColorStop(0, 'rgba(91, 140, 255, 0)');
    rim.addColorStop(0.3, 'rgba(143, 177, 255, 0.85)');
    rim.addColorStop(0.5, 'rgba(210, 190, 255, 1)');
    rim.addColorStop(0.7, 'rgba(229, 122, 214, 0.8)');
    rim.addColorStop(1, 'rgba(229, 122, 214, 0)');
    ctx.save();
    ctx.strokeStyle = rim;
    ctx.shadowColor = 'rgba(160, 123, 255, 0.9)';
    ctx.shadowBlur = 24;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    ctx.restore();

    // A slow sweep of light travelling along the rim.
    const sweep = -Math.PI / 2 + Math.sin(t * 0.18) * 0.32;
    const sx = cx + Math.cos(sweep) * radius;
    const sy = cy + Math.sin(sweep) * radius;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flare = ctx.createRadialGradient(sx, sy, 0, sx, sy, 90);
    flare.addColorStop(0, 'rgba(235, 225, 255, 0.35)');
    flare.addColorStop(0.25, 'rgba(180, 160, 255, 0.12)');
    flare.addColorStop(1, 'rgba(180, 160, 255, 0)');
    ctx.fillStyle = flare;
    ctx.fillRect(sx - 90, sy - 90, 180, 180);
    ctx.restore();
  }

  return createLoop(canvas, draw, { onResize: measure });
}
