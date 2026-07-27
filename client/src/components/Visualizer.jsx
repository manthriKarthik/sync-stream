import { useEffect, useRef } from 'react';

/**
 * Lightweight canvas spectrum visualizer.
 * Purely decorative: it animates from a timer and the `active` flag only.
 * It never taps the audio element or Web Audio graph, so it cannot affect
 * playback, sync, volume, or output-device routing.
 */
function Visualizer({ active }) {
  const canvasRef = useRef(null);
  const rafRef = useRef(0);
  const activeRef = useRef(active);
  const levelRef = useRef(0); // 0..1 overall energy, eased
  const barsRef = useRef([]); // per-bar smoothed heights

  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const BAR_COUNT = 56;
    if (barsRef.current.length !== BAR_COUNT) {
      barsRef.current = new Array(BAR_COUNT).fill(0);
    }

    let width = 0;
    let height = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Prefers-reduced-motion: draw one calm frame, skip the animation loop.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const draw = (t) => {
      const time = t / 1000;
      // Ease overall energy toward target (1 when playing, 0 when paused)
      const target = activeRef.current ? 1 : 0;
      levelRef.current += (target - levelRef.current) * 0.06;
      const energy = levelRef.current;

      ctx.clearRect(0, 0, width, height);

      const bars = barsRef.current;
      const gap = 2;
      const barW = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;

      for (let i = 0; i < BAR_COUNT; i++) {
        // Organic pseudo-spectrum: layered sines + a center-weighted arch so
        // the mids are tallest, the way real music tends to look.
        const n = i / (BAR_COUNT - 1);
        const envelope = 0.35 + 0.65 * Math.sin(n * Math.PI);
        const wave =
          0.5 +
          0.5 *
            Math.sin(time * 3.1 + i * 0.55) *
            Math.sin(time * 1.7 + i * 0.22) *
            Math.cos(time * 2.3 - i * 0.13);
        const targetH = Math.max(0.04, wave * envelope) * energy;

        // Smooth each bar for fluid motion
        bars[i] += (targetH - bars[i]) * 0.35;
        const h = Math.max(2, bars[i] * height);

        const x = i * (barW + gap);
        const y = height - h;

        const grad = ctx.createLinearGradient(0, height, 0, y);
        grad.addColorStop(0, `rgba(56, 189, 248, ${0.25 + 0.55 * energy})`);
        grad.addColorStop(1, `rgba(167, 139, 250, ${0.35 + 0.55 * energy})`);
        ctx.fillStyle = grad;

        const r = Math.min(barW / 2, 2);
        roundRect(ctx, x, y, barW, h, r);
        ctx.fill();
      }

      if (!reduce) rafRef.current = requestAnimationFrame(draw);
    };

    if (reduce) {
      levelRef.current = active ? 0.25 : 0;
      draw(0);
    } else {
      rafRef.current = requestAnimationFrame(draw);
    }

    return () => {
      cancelAnimationFrame(rafRef.current);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="player-visualizer" aria-hidden="true" />;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default Visualizer;
