import "pixi.js/unsafe-eval";
import {
  Application,
  Assets,
  BlurFilter,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
  type Ticker,
} from "pixi.js";
import { NeonPostFx } from "./PostFx";
import {
  projectTrailX,
  projectCourierAnchor,
  selectCourierFrame,
  selectTrailSamplesByAge,
  trailSampleFor,
  type CourierFrameIndex,
  type TrailSample,
} from "./presentation";
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
const COURIER_SHEET = "/art/sprites/vanta-courier-v1.webp";
const COURIER_FRAME_SIZE = 128;
const COURIER_CONTENT_SIZE = 108;
const COURIER_CONTACT_Y = 118 / COURIER_FRAME_SIZE;
const COURIER_SCALE = 42 / COURIER_CONTENT_SIZE;
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
  /** World-space x so particles remain attached to the scrolling playfield. */
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

type ActorVisual = {
  root: Container;
  spring: Container;
  sprite: Sprite | null;
  fallback: Graphics;
  halo: Graphics;
  lastGrounded: boolean;
  launchAt: number;
  landAt: number;
};

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
  private readonly trailGlow = new Graphics();
  private readonly geometry = new Graphics();
  private readonly trail = new Graphics();
  private readonly afterimageLayer = new Container();
  private readonly playerLayer = new Container();
  private readonly actors = new Map<string, ActorVisual>();
  private readonly afterimages: Sprite[] = [];
  private readonly particlesGraphic = new Graphics();
  private readonly overlayGraphic = new Graphics();
  private readonly backgroundSprites = new Map<VisualThemeId, Sprite>();
  private readonly particles: Particle[] = [];
  private readonly rings: Ring[] = [];
  private readonly trails = new Map<string, TrailSample[]>();
  private readonly seenPulses = new Set<string>();
  private postFx: NeonPostFx | null = null;
  private blur: BlurFilter | null = null;
  private frame: GameRenderFrame | null = null;
  private lastTick = -1;
  private lastAttempt = -1;
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
  private courierFrames: Texture[] | null = null;
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
    this.world.filterArea = new Rectangle(0, 0, WIDTH, HEIGHT);
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

    try {
      const sheet = await Assets.load<Texture>(COURIER_SHEET);
      if (!this.disposed) {
        this.courierFrames = Array.from({ length: 6 }, (_, index) => new Texture({
          source: sheet.source,
          frame: new Rectangle(
            (index % 3) * COURIER_FRAME_SIZE,
            Math.floor(index / 3) * COURIER_FRAME_SIZE,
            COURIER_FRAME_SIZE,
            COURIER_FRAME_SIZE,
          ),
        }));
        for (let index = 0; index < 6; index += 1) {
          const ghost = new Sprite(this.courierFrames[0]);
          ghost.anchor.set(0.5, COURIER_CONTACT_Y);
          ghost.scale.set(COURIER_SCALE);
          ghost.blendMode = "add";
          ghost.visible = false;
          this.afterimages.push(ghost);
          this.afterimageLayer.addChild(ghost);
        }
      }
    } catch {
      // The vector courier below is an intentional offline/fetch fallback.
      this.courierFrames = null;
    }

    this.drawFarGrid();
    this.trail.blendMode = "add";
    this.trailGlow.blendMode = "add";
    this.particlesGraphic.blendMode = "add";
    this.glowLayer.addChild(this.glowGeometry, this.trailGlow);
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
      this.afterimageLayer,
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
      this.world.filters = [];
      this.glowLayer.filters = [];
      this.postFx?.destroy();
      this.postFx = null;
      this.blur?.destroy();
      this.blur = null;
      this.actors.clear();
      this.trails.clear();
      this.afterimages.length = 0;
      this.backgroundSprites.clear();
      this.seenPulses.clear();
      this.particles.length = 0;
      this.rings.length = 0;
      for (const texture of this.courierFrames ?? []) {
        // Pixi 8.13 does not detach a subtexture from its shared source when
        // destroySource is false, so release the resize listener explicitly.
        texture.source.off("resize", texture.update, texture);
        texture.destroy(false);
      }
      this.courierFrames = null;
      this.app.destroy({ removeView: false }, { children: true, texture: false, textureSource: false });
    })();
    return this.destroyPromise;
  }

  private readonly onTick = (ticker: Ticker) => {
    const rawDelta = Math.min(0.05, ticker.deltaMS / 1000);
    const delta = this.frame?.state === "paused" ? 0 : rawDelta;
    this.elapsed += delta;
    this.postFx?.update(delta, this.elapsed);
    if (delta > 0) this.updateParticles(delta);
    if (!this.frame) return;
    this.renderFrame(this.frame, delta);
  };

  private renderFrame(frame: GameRenderFrame, delta: number) {
    if (frame.attempt !== this.lastAttempt || frame.tick < this.lastTick) {
      this.resetTransientEffects(frame);
    }
    const palette = PALETTES[frame.theme];
    if (frame.theme !== this.theme) this.setTheme(frame.theme);
    this.backdropLayer.x = this.reducedMotion ? 0 : -Math.sin(frame.progress * Math.PI) * 26;
    this.backdropLayer.y = this.reducedMotion ? 0 : Math.cos(frame.progress * Math.PI * 2) * 4;
    this.farGrid.x = this.reducedMotion ? 0 : -(frame.cameraX * 0.08) % 96;
    const shake = this.reducedMotion ? 0 : Math.max(0, frame.shake ?? 0);
    this.world.x = shake ? Math.sin(this.elapsed * 110) * shake : 0;
    this.world.y = shake ? Math.cos(this.elapsed * 97) * shake * 0.6 : 0;

    this.geometry.clear();
    this.glowGeometry.clear();
    for (const object of frame.objects) this.drawObject(object, frame.cameraX, palette);
    for (const prism of frame.prisms) this.drawPrism(prism, frame.cameraX, palette);

    if (frame.pulses) this.consumePulses(frame.pulses, frame.cameraX, palette);
    this.drawActors(frame.actors, frame.cameraX, palette, delta);
    this.drawParticles(frame.cameraX);
    this.drawOverlay(frame, palette);
    this.lastTick = frame.tick;
    this.lastAttempt = frame.attempt;
  }

  private resetTransientEffects(frame: GameRenderFrame) {
    this.trails.clear();
    this.particles.length = 0;
    this.rings.length = 0;
    this.seenPulses.clear();
    this.trail.clear();
    this.trailGlow.clear();
    this.particlesGraphic.clear();
    for (const ghost of this.afterimages) ghost.visible = false;
    for (const [id, visual] of this.actors) {
      visual.lastGrounded = frame.actors.find((actor) => actor.id === id)?.grounded ?? true;
      visual.launchAt = Number.NEGATIVE_INFINITY;
      visual.landAt = Number.NEGATIVE_INFINITY;
    }
    this.lastTick = -1;
    this.lastAttempt = frame.attempt;
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
    this.trailGlow.clear();
    for (const ghost of this.afterimages) ghost.visible = false;
    for (let index = 0; index < actors.length; index += 1) {
      const actor = actors[index]!;
      active.add(actor.id);
      let visual = this.actors.get(actor.id);
      if (!visual) visual = this.createActorVisual(actor);
      if (visual.lastGrounded && !actor.grounded) visual.launchAt = this.elapsed;
      if (!visual.lastGrounded && actor.grounded) visual.landAt = this.elapsed;
      visual.lastGrounded = actor.grounded;

      const frameIndex = this.courierFrameFor(actor, visual);
      const x = actor.x - cameraX;
      const shellTint = this.cosmetics.shellId === "bloom-shell"
        ? 0xff2bd6
        : this.cosmetics.shellId === "null-shell"
          ? 0xc8ff4a
          : palette.primary;
      const accent = actor.color ?? (index === 0 ? shellTint : index === 1 ? palette.secondary : palette.accent);
      const landingAge = this.elapsed - visual.landAt;
      const launchAge = this.elapsed - visual.launchAt;
      let scaleX = 1;
      let scaleY = 1;
      let bob = 0;
      if (this.reducedMotion) {
        if (landingAge >= 0 && landingAge < 0.1) {
          scaleX = 1.03;
          scaleY = 0.97;
        }
      } else {
        if (launchAge >= 0 && launchAge < 0.16) {
          const release = 1 - launchAge / 0.16;
          scaleX *= 1 - 0.08 * release;
          scaleY *= 1 + 0.12 * release;
        }
        if (landingAge >= 0 && landingAge < 0.34) {
          const impact = Math.exp(-11 * landingAge) * Math.cos(34 * landingAge);
          scaleX *= Math.max(0.84, Math.min(1.22, 1 + 0.2 * impact));
          scaleY *= Math.max(0.84, Math.min(1.22, 1 - 0.16 * impact));
        } else if (actor.grounded) {
          bob = Math.sin((this.frame?.beatPhase ?? 0) * Math.PI * 2) * 1.4;
        }
      }
      const roleScale = actor.role === "echo" ? 0.88 : 1;
      visual.root.position.set(x, actor.y + bob);
      visual.root.rotation = this.reducedMotion ? 0 : actor.rotation;
      visual.root.alpha = actor.dead ? 0.08 : (actor.alpha ?? (index === 0 ? 1 : 0.54));
      visual.root.scale.set(actor.dead ? 1.3 : 1);
      visual.spring.scale.set(scaleX * roleScale, scaleY * roleScale);
      visual.halo.tint = accent;
      visual.halo.alpha = actor.role === "courier" ? 0.9 : 0.45;
      visual.fallback.tint = accent;
      if (visual.sprite && this.courierFrames) {
        visual.sprite.texture = this.courierFrames[frameIndex] ?? this.courierFrames[0]!;
        visual.sprite.visible = true;
        visual.sprite.tint = 0xffffff;
        visual.fallback.visible = false;
      } else {
        visual.fallback.visible = true;
      }

      let history = this.trails.get(actor.id);
      if (!history) {
        history = [];
        this.trails.set(actor.id, history);
      }
      if (this.lastTick !== this.frame?.tick && !actor.dead) {
        history.push(trailSampleFor(actor, this.frame?.tick ?? 0, frameIndex));
        const maxAgeTicks = this.reducedMotion
          ? 18
          : this.quality === "low"
            ? 24
            : this.quality === "medium"
              ? 38
              : 52;
        const firstRetained = history.findIndex((sample) => sample.tick >= (this.frame?.tick ?? 0) - maxAgeTicks);
        if (firstRetained > 0) history.splice(0, firstRetained);
      }
      if (history.length > 1) {
        const color = index === 0
          ? this.cosmetics.trailId === "afterimage"
            ? 0xff2bd6
            : this.cosmetics.trailId === "event-horizon"
              ? 0xc8ff4a
              : actor.color ?? palette.primary
          : actor.color ?? palette.secondary;
        this.drawTrailRibbon(history, cameraX, color, index === 0);
        if (index === 0) this.drawAfterimages(history, cameraX, color, this.frame?.tick ?? 0);
      }
    }
    for (const [id, visual] of this.actors) {
      if (!active.has(id)) {
        visual.root.destroy({ children: true });
        this.actors.delete(id);
        this.trails.delete(id);
      }
    }
  }

  private createActorVisual(actor: RenderActor): ActorVisual {
    const root = new Container();
    const spring = new Container();
    const halo = new Graphics();
    halo
      .circle(0, 0, 26)
      .fill({ color: 0xffffff, alpha: 0.08 })
      .stroke({ width: 5, color: 0xffffff, alpha: 0.2 });
    halo.poly([0, -28, 24, 0, 0, 28, -24, 0], true).stroke({ width: 2, color: 0xffffff, alpha: 0.3 });
    halo.blendMode = "add";

    const fallback = new Graphics();
    fallback
      .poly([0, -17, 15, -3, 8, 16, -10, 13, -17, -5], true)
      .fill({ color: 0x07131a, alpha: 0.96 })
      .stroke({ width: 2.5, color: 0xffffff });
    fallback.poly([0, -10, 8, -2, 3, 9, -6, 7, -9, -3], true).fill({ color: 0xffffff, alpha: 0.48 });
    fallback.circle(0, 0, 2.4).fill({ color: 0xffffff, alpha: 0.96 });

    const sprite = this.courierFrames ? new Sprite(this.courierFrames[0]) : null;
    if (sprite) {
      sprite.anchor.set(0.5, COURIER_CONTACT_Y);
      sprite.position.set(0, 21);
      sprite.scale.set(COURIER_SCALE);
    }
    spring.addChild(halo);
    if (sprite) spring.addChild(sprite);
    spring.addChild(fallback);
    fallback.visible = sprite === null;
    root.addChild(spring);
    this.playerLayer.addChild(root);
    const visual: ActorVisual = {
      root,
      spring,
      sprite,
      fallback,
      halo,
      lastGrounded: actor.grounded,
      launchAt: Number.NEGATIVE_INFINITY,
      landAt: Number.NEGATIVE_INFINITY,
    };
    this.actors.set(actor.id, visual);
    return visual;
  }

  private courierFrameFor(actor: RenderActor, visual: ActorVisual): CourierFrameIndex {
    return selectCourierFrame(
      actor,
      this.frame?.tick ?? 0,
      this.elapsed - visual.landAt,
      this.reducedMotion,
    );
  }

  private drawTrailRibbon(
    history: readonly TrailSample[],
    cameraX: number,
    color: number,
    primary: boolean,
  ) {
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1]!;
      const current = history[index]!;
      const strength = index / Math.max(1, history.length - 1);
      const x0 = projectTrailX(previous, cameraX);
      const x1 = projectTrailX(current, cameraX);
      if (x1 < -100 || x0 > WIDTH + 100) continue;
      const alpha = (primary ? 0.12 : 0.055) + strength * (primary ? 0.56 : 0.24);
      this.trailGlow
        .moveTo(x0, previous.y)
        .lineTo(x1, current.y)
        .stroke({ width: (primary ? 8 : 5) + strength * (primary ? 7 : 4), color, alpha: alpha * 0.52 });
      this.trail
        .moveTo(x0, previous.y)
        .lineTo(x1, current.y)
        .stroke({ width: (primary ? 1.4 : 0.9) + strength * (primary ? 3.2 : 1.7), color, alpha });
      if (primary) {
        this.trail
          .moveTo(x0, previous.y)
          .lineTo(x1, current.y)
          .stroke({ width: 0.55 + strength * 1.05, color: 0xffffff, alpha: alpha * 0.82 });
      }
    }
  }

  private drawAfterimages(
    history: readonly TrailSample[],
    cameraX: number,
    color: number,
    currentTick: number,
  ) {
    if (!this.courierFrames || this.reducedMotion || this.photosensitive || history.length < 4) return;
    const qualityCap = this.quality === "high" ? 6 : this.quality === "medium" ? 4 : 2;
    const requested = this.cosmetics.trailId === "afterimage"
      ? qualityCap
      : this.cosmetics.trailId === "event-horizon"
        ? Math.max(1, qualityCap - 1)
        : Math.max(1, Math.ceil(qualityCap / 2));
    const targetAges = [4, 8, 12, 16, 22, 28].slice(0, Math.min(requested, this.afterimages.length));
    const samples = selectTrailSamplesByAge(history, currentTick, targetAges);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const ghost = this.afterimages[index];
      if (!sample || !ghost) continue;
      ghost.texture = this.courierFrames[sample.frameIndex] ?? this.courierFrames[0]!;
      const anchor = projectCourierAnchor(sample, cameraX, 21);
      ghost.position.set(anchor.x, anchor.y);
      ghost.rotation = sample.rotation;
      ghost.scale.set(COURIER_SCALE * (1 - index * 0.035));
      ghost.tint = color;
      ghost.alpha = (this.cosmetics.trailId === "afterimage" ? 0.24 : 0.14) *
        (1 - index / (samples.length + 1));
      ghost.visible = true;
    }
  }

  private consumePulses(
    pulses: readonly RenderPulse[],
    _cameraX: number,
    palette: { primary: number; secondary: number; accent: number },
  ) {
    for (const pulse of pulses) {
      if (this.seenPulses.has(pulse.id)) continue;
      this.seenPulses.add(pulse.id);
      if (this.seenPulses.size > 256) {
        const oldest = this.seenPulses.values().next().value as string | undefined;
        if (oldest) this.seenPulses.delete(oldest);
      }
      const x = pulse.x;
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
        this.postFx?.trigger(
          pulse.type === "death" ? 1.35 : 0.75,
          (pulse.x - (this.frame?.cameraX ?? 0)) / WIDTH,
          pulse.y / HEIGHT,
        );
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

  private drawParticles(cameraX: number) {
    this.particlesGraphic.clear();
    for (const particle of this.particles) {
      const alpha = Math.min(1, particle.life / particle.maxLife);
      this.particlesGraphic
        .rect(particle.x - cameraX, particle.y, particle.size, particle.size)
        .fill({ color: particle.color, alpha });
    }
    for (const ring of this.rings) {
      this.particlesGraphic
        .circle(ring.x - cameraX, ring.y, ring.radius)
        .stroke({ width: 2, color: ring.color, alpha: Math.min(1, ring.life * 1.5) });
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
