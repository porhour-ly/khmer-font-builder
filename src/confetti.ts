import { KHMER_FONT_STACK } from './khmerFont';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  life: number;
  text?: string;
}

const COLORS = ['#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93', '#ff70a6', '#ff924c'];
const LETTERS = 'កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវសហឡអ';

let canvas: HTMLCanvasElement | null = null;
let particles: Particle[] = [];
let running = false;

function ensureCanvas(): CanvasRenderingContext2D {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.className = 'confetti';
    document.body.append(canvas);
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function loop(): void {
  const ctx = canvas!.getContext('2d')!;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles = particles.filter((p) => p.life > 0 && p.y < window.innerHeight + 60);
  for (const p of particles) {
    p.vy += 0.25;
    p.vx *= 0.99;
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr;
    p.life -= 1;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = Math.min(1, p.life / 30);
    ctx.fillStyle = p.color;
    if (p.text) {
      ctx.font = `${p.size}px ${KHMER_FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.fillText(p.text, 0, 0);
    } else {
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
    }
    ctx.restore();
  }
  if (particles.length) requestAnimationFrame(loop);
  else {
    running = false;
    canvas?.remove();
    canvas = null;
  }
}

function start(): void {
  if (!running) {
    running = true;
    requestAnimationFrame(loop);
  }
}

/** Small burst, e.g. from the Save button. */
export function burst(x: number, y: number, count = 45): void {
  ensureCanvas();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 3 + Math.random() * 7;
    particles.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - 5,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.4,
      size: 6 + Math.random() * 8,
      color: COLORS[i % COLORS.length],
      life: 70 + Math.random() * 40,
    });
  }
  start();
}

/**
 * Confetti from a button after saving, plus the big celebration when the
 * save completes the alphabet. Returns true when it just became complete.
 */
export function celebrateSave(from: HTMLElement, before: number, after: number, total: number): boolean {
  const r = from.getBoundingClientRect();
  burst(r.left + r.width / 2, r.top + r.height / 2);
  if (after === total && before < total) {
    celebrateBig();
    return true;
  }
  return false;
}

/** Big celebration: confetti and Khmer letters raining from the top. */
export function celebrateBig(): void {
  ensureCanvas();
  const w = window.innerWidth;
  for (let i = 0; i < 260; i++) {
    const isLetter = i % 4 === 0;
    particles.push({
      x: Math.random() * w,
      y: -20 - Math.random() * window.innerHeight * 0.8,
      vx: (Math.random() - 0.5) * 3,
      vy: 1 + Math.random() * 3,
      rot: Math.random() * 6,
      vr: (Math.random() - 0.5) * (isLetter ? 0.05 : 0.3),
      size: isLetter ? 22 + Math.random() * 20 : 7 + Math.random() * 9,
      color: COLORS[i % COLORS.length],
      life: 260 + Math.random() * 80,
      text: isLetter ? LETTERS[i % LETTERS.length] : undefined,
    });
  }
  start();
}
