import "pixi.js/unsafe-eval";
import {
  Application,
  Assets,
  BlurFilter,
  Container,
  Graphics,
  Sprite,
  Texture,
  type Ticker,
} from "pixi.js";
import { NeonPostFx } from "./PostFx";
import type {
  GameRenderFrame,
  RenderActor,
  RenderObject,
  RenderPrism,
  RenderPulse,
  RenderQuality,
  VisualThemeId,
} from "./types";

const WIDTH = 960;
const HEIGHT = 540;
const BACKDROPS: Record<VisualThemeId, string> = {
  "glass-horizon": "/art/backdrops/glass-horizon.webp",
  "phase-bloom": "/art/backdrops/phase-bloom.webp",
  "null-circuit": "/art/backdrops/null-circuit.webp",
  daily: "/art/backdrops/phase-bloom.webp",
  endless: "/art/backdrops/null-circuit.webp",
};

const PALETTES: Record<VisualThemeId, { primary: number; secondary: number; accent: number }> = {
  "glass-horizon": { primary: 0x37f5ff, secondary: 0x80bfff, accent: 0xff2bd6 },
  "phase-bloom": { primary: 0xff2bd6, secondary: 0xa777ff, accent: 0x37f5ff },
  "null-circuit": { primary: 0xc8ff4a, secondary: 0x54ff90, accent: 0xff2bd6 },
  daily: { primary: 0x37f5ff, secondary: 0xff2bd6, accent: 0xc8ff4a },
  endless: { primary: 0xc8ff4a, secondary: 0x37f5ff, accent: 0xff2bd6 },
};

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
};

type Ring = { x: number; y: number; radius: number; life: number; color: number };

export type PixiViewOptions = {
  quality?: RenderQuality;
  reducedMotion?: boolean;
  photosensitive?: boolean;
  highContrast?: boolean;
  cosmetics?: Readonly<{
    shellId: string;
    trailId: string;
    burstId: string;
  }>;
};

export class PixiGameView {
  readonly app = new Application();
  private readonly root = new Container();
  private readonly world = new Container();
  private readonly backdropLayer = new Container();
  private readonly farGrid = new Graphics();
  private readonly glowLayer = new Container();
  private readonly glowGeometry = new Graphics();
  private readonly geometry = new Graphics();
  private readonly trail = new Graphics();
  private readonly playerLayer = new Container();
  private readonly actors = new Map<string, Graphics>();
  private readonly particlesGraphic = new Graphics();
  private readonly overlayGraphic = new Graphics();
  private readonly backgroundSprites = new Map<VisualThemeId, Sprite>();
  private readonly particles: Particle[] = [];
  private readonly rings: Ring[] = [];
  private readonly trails = new Map<string, Array<{ x: number; y: number }>>();
  private readonly seenPulses = new Set<string>();
  private postFx: NeonPostFx | null = null;
  private blur: BlurFilter | null = null;
  private frame: GameRenderFrame | null = null;
  private lastTick = -1;
  private theme: VisualThemeId = "glass-horizon";
  private quality: RenderQuality = "high";
  private reducedMotion = false;
  private photosensitive = false;
  private highContrast = false;
  private cosmetics = {
    shellId: "vanta-core",
    trailId: "ion-thread",
    burstId: "clean-break",
  };
  private elapsed = 0;
  private disposed = false;
  private appInitialized = false;
  private initPromise: Promise<void> | null = null;
  private destroyPromise: Promise<void> | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private readonly host: HTMLElement;

  constructor(host: HTMLElement, private readonly canvas: HTMLCanvasElement) {
    this.host = host;
  }

  init(options: PixiViewOptions = {}) {
    if (!this.initPromise) this.initPromise = this.initialize(options);
    return this.initPromise;
  }

  private async initialize(options: PixiViewOptions) {
    this.quality = options.quality ?? "high";
    this.reducedMotion = options.reducedMotion ?? false;
    this.photosensitive = options.photosensitive ?? false;
    this.highContrast = options.highContrast ?? false;
    if (options.cosmetics) this.cosmetics = { ...options.cosmetics };
    const resolutionCap = this.quality === "high" ? 1.5 : this.quality === "medium" ? 1.25 : 1;
    await this.app.init({
      canvas: this.canvas,
      width: Math.max(1, this.host.clientWidth),
      height: Math.max(1, this.host.clientHeight),
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, resolutionCap),
      background: 0x03040a,
      backgroundAlpha: 1,
      preference: "webgl",
      powerPreference: "high-performance",
      hello: false,
    });
    this.appInitialized = true;
    if (this.disposed) return;

    const loaded = await Promise.all(
      Object.entries(BACKDROPS).map(async ([key, url]) => {
        const texture = await Assets.load<Texture>(url);
        return [key as VisualThemeId, texture] as const;
      }),
    );
    if (this.disposed) return;
    for (const [theme, texture] of loaded) {
      if (this.backgroundSprites.has(theme)) continue;
      const sprite = new Sprite(texture);
      sprite.alpha = theme === this.theme ? 0.72 : 0;
      sprite.visible = theme === this.theme;
      this.fitBackdrop(sprite);
      this.backgroundSprites.set(theme, sprite);
      this.backdropLayer.addChild(sprite);
    }

    this.drawFarGrid();
    this.glowLayer.addChild(this.glowGeometry);
    this.blur = new BlurFilter({
      strength: this.quality === "high" ? 7 : 4.5,
      quality: 1,
      resolution: this.quality === "high" ? 0.45 : 0.35,
      kernelSize: 5,
    });
    this.glowLayer.filters = this.quality === "low" ? [] : [this.blur];

    this.world.addChild(
      this.backdropLayer,
      this.farGrid,
      this.glowLayer,
      this.geometry,
      this.trail,
      this.playerLayer,
      this.particlesGraphic,
      this.overlayGraphic,
    );
    this.root.addChild(this.world);
    this.app.stage.addChild(this.root);

    try {
      this.postFx = new NeonPostFx();
      this.postFx.configure({
        intensity: this.quality === "low" ? 0 : this.quality === "high" ? 1 : 0.55,
        photosensitive: this.photosensitive,
        resolution: this.quality === "high" ? 0.75 : 0.6,
      });
      this.world.filters = this.quality === "low" ? [] : [this.postFx.filter];
    } catch {
      this.postFx = null;
      this.world.filters = [];
    }

    this.app.ticker.add(this.onTick, this);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.host);
    this.resize();
  }

  present(frame: GameRenderFrame) {
    this.frame = frame;
  }

  configure(options: PixiViewOptions) {
    if (options.quality) this.quality = options.quality;
    if (options.reducedMotion !== undefined) this.reducedMotion = options.reducedMotion;
    if (options.photosensitive !== undefined) this.photosensitive = options.photosensitive;
    if (options.highContrast !== undefined) this.highContrast = options.highContrast;
    if (options.cosmetics) this.cosmetics = { ...options.cosmetics };
    this.postFx?.configure({
      intensity: this.quality === "low" ? 0 : this.quality === "high" ? 1 : 0.55,
      photosensitive: this.photosensitive,
      resolution: this.quality === "high" ? 0.75 : this.quality === "medium" ? 0.6 : 0.5,
    });
    this.world.filters = this.quality === "low" || !this.postFx ? [] : [this.postFx.filter];
    this.glowLayer.filters = this.quality === "low" || !this.blur ? [] : [this.blur];
  }

  destroy() {
    if (this.destroyPromise) return this.destroyPromise;
    this.disposed = true;
    this.destroyPromise = (async () => {
      try {
        await this.initPromise;
      } catch {
        // Initialization failures still need any partially-created renderer released.
      }
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
      if (!this.appInitialized) return;
      this.app.ticker.remove(this.onTick, this);
      this.postFx?.destroy();
      this.postFx = null;
      this.blur?.destroy();
      this.blur = null;
      this.actors.clear();
      this.trails.clear();
      this.particles.length = 0;
      this.rings.length = 0;
      this.app.destroy({ removeView: false }, { children: true, texture: false, textureSource: false });
    })();
    return this.destroyPromise;
  }

  private readonly onTick = (ticker: Ticker) => {
    const delta = Math.min(0.05, ticker.deltaMS / 1000);
    this.elapsed += delta;
    this.postFx?.update(delta, this.elapsed);
    this.updateParticles(delta);
    if (!this.frame) return;
    this.renderFrame(this.frame, delta);
  };

  private renderFrame(frame: GameRenderFrame, delta: number) {
    const palette = PALETTES[frame.theme];
    if (frame.theme !== this.theme) this.setTheme(frame.theme);
    this.backdropLayer.x = this.reducedMotion ? 0 : -Math.sin(frame.progress * Math.PI) * 26;
    this.backdropLayer.y = this.reducedMotion ? 0 : Math.cos(frame.progress * Math.PI * 2) * 4;
    this.farGrid.x = -(frame.cameraX * 0.08) % 96;
    const shake = this.reducedMotion ? 0 : Math.max(0, frame.shake ?? 0);
    this.world.x = shake ? Math.sin(this.elapsed * 110) * shake : 0;
    this.world.y = shake ? Math.cos(this.elapsed * 97) * shake * 0.6 : 0;

    this.geometry.clear();
    this.glowGeometry.clear();
    for (const object of frame.objects) this.drawObject(object, frame.cameraX, palette);
    for (const prism of frame.prisms) this.drawPrism(prism, frame.cameraX, palette);

    this.drawActors(frame.actors, frame.cameraX, palette, delta);
    if (frame.pulses) this.consumePulses(frame.pulses, frame.cameraX, palette);
    this.drawParticles();
    this.drawOverlay(frame, palette);
    this.lastTick = frame.tick;
  }

  private drawObject(
    object: RenderObject,
    cameraX: number,
    palette: { primary: number; secondary: number; accent: number },
  ) {
    const x = object.x - cameraX;
    if (x + object.width < -80 || x > WIDTH + 80) return;
    const color = object.color ?? palette.primary;
    const alpha = object.active === false ? 0.32 : 1;
    switch (object.kind) {
      case "rail": {
        this.glowGeometry.rect(x, object.y, object.width, object.height).stroke({ width: 9, color, alpha: 0.32 * alpha });
        this.geometry.rect(x, object.y, object.width, object.height).fill({ color: 0x06121a, alpha: 0.92 });
        this.geometry.rect(x, object.y, object.width, object.height).stroke({ width: 2, color, alpha });
        const segments = Math.max(1, Math.floor(object.width / 42));
        for (let i = 0; i < segments; i += 1) {
          const sx = x + i * (object.width / segments);
          this.geometry
            .poly([sx + 5, object.y + object.height - 3, sx + 18, object.y + 6, sx + 31, object.y + object.height - 3])
            .stroke({ width: 1, color, alpha: 0.22 });
        }
        break;
      }
      case "fracture": {
        const teeth = Math.max(1, Math.round(object.width / 28));
        for (let i = 0; i < teeth; i += 1) {
          const left = x + (i * object.width) / teeth;
          const right = x + ((i + 1) * object.width) / teeth;
          const mid = (left + right) / 2;
          this.glowGeometry
            .poly([left, object.y + object.height, mid, object.y, right, object.y + object.height], true)
            .stroke({ width: 8, color: palette.accent, alpha: 0.38 * alpha });
          this.geometry
            .poly([left, object.y + object.height, mid, object.y, right, object.y + object.height], true)
            .fill({ color: 0x020207, alpha: 1 })
            .stroke({ width: this.highContrast ? 3 : 2, color: palette.accent, alpha });
          this.geometry
            .poly([mid, object.y + 6, mid - 4, object.y + object.height - 7, mid + 5, object.y + object.height - 4], true)
            .fill({ color: palette.accent, alpha: 0.22 * alpha });
        }
        break;
      }
      case "shutter": {
        const phase = object.phase ?? 0;
        this.glowGeometry.roundRect(x, object.y, object.width, object.height, 4).stroke({ width: 10, color, alpha: 0.3 * alpha });
        this.geometry.roundRect(x, object.y, object.width, object.height, 4).fill({ color: 0x071019, alpha: 0.96 });
        this.geometry.roundRect(x, object.y, object.width, object.height, 4).stroke({ width: 2, color, alpha });
        for (let y = object.y + 10; y < object.y + object.height; y += 20) {
          this.geometry.moveTo(x + 5, y).lineTo(x + object.width - 5, y + Math.sin(phase * Math.PI * 2) * 4).stroke({ width: 1, color, alpha: 0.65 });
        }
        break;
      }
      case "membrane": {
        this.glowGeometry.ellipse(x + object.width / 2, object.y + object.height / 2, object.width / 2, object.height / 2).stroke({ width: 12, color: palette.secondary, alpha: 0.35 });
        this.geometry.ellipse(x + object.width / 2, object.y + object.height / 2, object.width / 2, object.height / 2).stroke({ width: 3, color: palette.secondary, alpha });
        this.geometry.moveTo(x + 7, object.y + object.height / 2).lineTo(x + object.width - 7, object.y + object.height / 2).stroke({ width: 1, color: 0xffffff, alpha: 0.7 });
        break;
      }
      case "portal": {
        const cx = x + object.width / 2;
        const cy = object.y + object.height / 2;
        this.glowGeometry.ellipse(cx, cy, object.width / 2, object.height / 2).stroke({ width: 14, color, alpha: 0.45 });
        this.geometry.ellipse(cx, cy, object.width / 2, object.height / 2).stroke({ width: 4, color, alpha });
        this.geometry.ellipse(cx, cy, object.width * 0.34, object.height * 0.37).stroke({ width: 1, color: palette.accent, alpha: 0.8 });
        for (let i = 0; i < 8; i += 1) {
          const angle = (i / 8) * Math.PI * 2 + (this.reducedMotion || this.photosensitive ? 0 : this.elapsed);
          this.geometry.circle(cx + Math.cos(angle) * object.width * 0.58, cy + Math.sin(angle) * object.height * 0.58, 2.2).fill({ color: i % 2 ? color : palette.accent, alpha });
        }
        break;
      }
      case "speed-gate": {
        for (let i = 0; i < 3; i += 1) {
          const ox = x + i * 16;
          this.glowGeometry.poly([ox, object.y, ox + 17, object.y + object.height / 2, ox, object.y + object.height]).stroke({ width: 8, color: palette.accent, alpha: 0.28 });
          this.geometry.poly([ox, object.y, ox + 17, object.y + object.height / 2, ox, object.y + object.height]).stroke({ width: 3, color: palette.accent, alpha });
        }
        break;
      }
      case "checkpoint": {
        const cx = x + object.width / 2;
        this.glowGeometry.moveTo(cx, object.y).lineTo(cx, object.y + object.height).stroke({ width: 12, color, alpha: 0.28 });
        this.geometry.moveTo(cx, object.y).lineTo(cx, object.y + object.height).stroke({ width: 1, color, alpha });
        this.geometry.circle(cx, object.y + object.height * 0.25, 7).stroke({ width: 2, color, alpha });
        break;
      }
    }
  }

  private drawPrism(
    prism: RenderPrism,
    cameraX: number,
    palette: { primary: number; secondary: number; accent: number },
  ) {
    if (prism.collected) return;
    const x = prism.x - cameraX;
    if (x < -40 || x > WIDTH + 40) return;
    const y = prism.y + (this.reducedMotion || this.photosensitive ? 0 : Math.sin(this.elapsed * 3 + prism.x * 0.01) * 5);
    const points = [x, y - 18, x + 11, y, x, y + 18, x - 11, y];
    this.glowGeometry.poly(points, true).stroke({ width: 11, color: palette.accent, alpha: 0.42 });
    this.geometry.poly(points, true).fill({ color: 0xffffff, alpha: 0.12 }).stroke({ width: 2, color: palette.accent });
    this.geometry.moveTo(x, y - 14).lineTo(x, y + 14).stroke({ width: 1, color: palette.primary, alpha: 0.9 });
  }

  private drawActors(
    actors: readonly RenderActor[],
    cameraX: number,
    palette: { primary: number; secondary: number; accent: number },
    _delta: number,
  ) {
    const active = new Set<string>();
    this.trail.clear();
    for (let index = 0; index < actors.length; index += 1) {
      const actor = actors[index]!;
      active.add(actor.id);
      let graphic = this.actors.get(actor.id);
      if (!graphic) {
        graphic = new Graphics();
        if (index === 0 && this.cosmetics.shellId === "bloom-shell") {
          graphic
            .poly([0, -20, 16, 0, 0, 20, -16, 0], true)
            .fill({ color: 0x11051a, alpha: 0.94 })
            .stroke({ width: 2.6, color: 0xff2bd6 });
          graphic.poly([0, -12, 9, 0, 0, 12, -9, 0], true).fill({ color: 0xff2bd6, alpha: 0.5 });
        } else if (index === 0 && this.cosmetics.shellId === "null-shell") {
          graphic
            .poly([0, -18, 15, -9, 15, 9, 0, 18, -15, 9, -15, -9], true)
            .fill({ color: 0x07130b, alpha: 0.94 })
            .stroke({ width: 2.6, color: 0xc8ff4a });
          graphic.poly([0, -10, 9, -5, 9, 5, 0, 10, -9, 5, -9, -5], true).fill({ color: 0xc8ff4a, alpha: 0.42 });
        } else {
          graphic
            .poly([0, -17, 15, -3, 8, 16, -10, 13, -17, -5], true)
            .fill({ color: 0x04131b, alpha: 0.92 })
            .stroke({ width: 2.5, color: actor.color ?? palette.primary });
          graphic
            .poly([0, -10, 8, -2, 3, 9, -6, 7, -9, -3], true)
            .fill({ color: actor.color ?? palette.primary, alpha: 0.46 });
        }
        graphic.circle(0, 0, 2.4).fill({ color: 0xffffff, alpha: 0.9 });
        this.actors.set(actor.id, graphic);
        this.playerLayer.addChild(graphic);
      }
      const x = actor.x - cameraX;
      graphic.position.set(x, actor.y);
      graphic.rotation = this.reducedMotion ? 0 : actor.rotation;
      graphic.alpha = actor.dead ? 0.08 : (actor.alpha ?? (index === 0 ? 1 : 0.54));
      const shellTint = this.cosmetics.shellId === "bloom-shell"
        ? 0xff2bd6
        : this.cosmetics.shellId === "null-shell"
          ? 0xc8ff4a
          : palette.primary;
      graphic.tint = actor.color ?? (index === 0 ? shellTint : index === 1 ? palette.secondary : palette.accent);
      graphic.scale.set(actor.dead ? 1.35 : 1);

      let history = this.trails.get(actor.id);
      if (!history) {
        history = [];
        this.trails.set(actor.id, history);
      }
      if (this.lastTick !== this.frame?.tick && !actor.dead) {
        history.push({ x, y: actor.y });
        const cap = this.quality === "low" ? 9 : this.quality === "medium" ? 16 : 25;
        if (history.length > cap) history.splice(0, history.length - cap);
      }
      if (history.length > 1) {
        this.trail.moveTo(history[0]!.x, history[0]!.y);
        for (let i = 1; i < history.length; i += 1) this.trail.lineTo(history[i]!.x, history[i]!.y);
        this.trail.stroke({
          width: index === 0 ? 4 : 2,
          color: index === 0
            ? this.cosmetics.trailId === "afterimage"
              ? 0xff2bd6
              : this.cosmetics.trailId === "event-horizon"
                ? 0xc8ff4a
                : actor.color ?? palette.primary
            : actor.color ?? palette.secondary,
          alpha: index === 0 ? 0.64 : 0.3,
        });
      }
    }
    for (const [id, graphic] of this.actors) {
      if (!active.has(id)) {
        graphic.destroy();
        this.actors.delete(id);
        this.trails.delete(id);
      }
    }
  }

  private consumePulses(
    pulses: readonly RenderPulse[],
    cameraX: number,
    palette: { primary: number; secondary: number; accent: number },
  ) {
    for (const pulse of pulses) {
      if (this.seenPulses.has(pulse.id)) continue;
      this.seenPulses.add(pulse.id);
      if (this.seenPulses.size > 256) {
        const oldest = this.seenPulses.values().next().value as string | undefined;
        if (oldest) this.seenPulses.delete(oldest);
      }
      const x = pulse.x - cameraX;
      const equippedBurst = this.cosmetics.burstId === "phase-flower"
        ? 0xff2bd6
        : this.cosmetics.burstId === "singularity"
          ? 0xc8ff4a
          : palette.primary;
      const color = pulse.type === "prism" ? palette.accent : pulse.color ?? equippedBurst;
      const counts: Record<RenderPulse["type"], number> = {
        jump: 7,
        land: 10,
        perfect: 16,
        prism: 28,
        portal: 22,
        death: 46,
        complete: 60,
      };
      const calmVisuals = this.reducedMotion || this.photosensitive;
      const requested = calmVisuals ? Math.min(4, Math.ceil(counts[pulse.type] * 0.12)) : counts[pulse.type];
      this.emit(x, pulse.y, color, requested, calmVisuals ? 44 : pulse.type === "death" ? 240 : 130);
      if (!calmVisuals) {
        this.rings.push({ x, y: pulse.y, radius: 5, life: pulse.type === "death" ? 0.9 : 0.55, color });
      }
      if (!calmVisuals && (pulse.type === "perfect" || pulse.type === "prism" || pulse.type === "portal" || pulse.type === "death" || pulse.type === "complete")) {
        this.postFx?.trigger(pulse.type === "death" ? 1.35 : 0.75);
      }
    }
  }

  private emit(x: number, y: number, color: number, requested: number, speed: number) {
    const cap = this.quality === "high" ? 320 : this.quality === "medium" ? 180 : 80;
    const count = Math.min(requested, cap - this.particles.length);
    for (let i = 0; i < count; i += 1) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2 + ((i * 17) % 7) * 0.19;
      const velocity = speed * (0.45 + ((i * 37) % 100) / 180);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        life: 0.32 + ((i * 13) % 40) / 100,
        maxLife: 0.72,
        size: 1.2 + (i % 4) * 0.75,
        color,
      });
    }
  }

  private updateParticles(delta: number) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i]!;
      particle.life -= delta;
      if (particle.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx *= 0.985;
      particle.vy = particle.vy * 0.985 + 34 * delta;
    }
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const ring = this.rings[i]!;
      ring.life -= delta;
      ring.radius += delta * 145;
      if (ring.life <= 0) this.rings.splice(i, 1);
    }
  }

  private drawParticles() {
    this.particlesGraphic.clear();
    for (const particle of this.particles) {
      const alpha = Math.min(1, particle.life / particle.maxLife);
      this.particlesGraphic.rect(particle.x, particle.y, particle.size, particle.size).fill({ color: particle.color, alpha });
    }
    for (const ring of this.rings) {
      this.particlesGraphic.circle(ring.x, ring.y, ring.radius).stroke({ width: 2, color: ring.color, alpha: Math.min(1, ring.life * 1.5) });
    }
  }

  private drawOverlay(frame: GameRenderFrame, palette: { primary: number; secondary: number; accent: number }) {
    this.overlayGraphic.clear();
    const pulse = this.reducedMotion || this.photosensitive
      ? 0.5
      : 0.5 + Math.sin(frame.beatPhase * Math.PI * 2) * 0.5;
    this.overlayGraphic.rect(0, HEIGHT - 3, WIDTH * frame.progress, 3).fill({ color: palette.primary, alpha: 0.35 + pulse * 0.25 });
    if (frame.state === "paused") {
      this.overlayGraphic.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x03040a, alpha: 0.18 });
    }
  }

  private setTheme(theme: VisualThemeId) {
    this.theme = theme;
    for (const [id, sprite] of this.backgroundSprites) {
      sprite.visible = id === theme;
      sprite.alpha = id === theme ? 0.72 : 0;
    }
    const palette = PALETTES[theme];
    this.drawFarGrid(palette.primary, palette.accent);
  }

  private drawFarGrid(primary = 0x37f5ff, accent = 0xff2bd6) {
    this.farGrid.clear();
    for (let x = -96; x <= WIDTH + 96; x += 96) {
      this.farGrid.moveTo(x, HEIGHT * 0.64).lineTo(WIDTH / 2 + (x - WIDTH / 2) * 2.2, HEIGHT).stroke({ width: 1, color: primary, alpha: 0.12 });
    }
    for (let i = 0; i < 10; i += 1) {
      const y = HEIGHT * 0.64 + (1 - 1 / (i * 0.34 + 1)) * HEIGHT * 0.36;
      this.farGrid.moveTo(0, y).lineTo(WIDTH, y).stroke({ width: 1, color: i % 3 === 0 ? accent : primary, alpha: 0.1 });
    }
  }

  private fitBackdrop(sprite: Sprite) {
    const scale = Math.max(WIDTH / sprite.texture.width, HEIGHT / sprite.texture.height) * 1.08;
    sprite.scale.set(scale);
    sprite.anchor.set(0.5);
    sprite.position.set(WIDTH / 2, HEIGHT / 2);
  }

  private resize() {
    if (this.disposed || !this.app.renderer) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.app.renderer.resize(width, height);
    const scale = Math.min(width / WIDTH, height / HEIGHT);
    this.root.scale.set(scale);
    this.root.position.set((width - WIDTH * scale) / 2, (height - HEIGHT * scale) / 2);
  }
}
