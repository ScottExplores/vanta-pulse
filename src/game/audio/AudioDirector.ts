export type AudioThemeId = "glass-horizon" | "phase-bloom" | "null-circuit" | "daily" | "endless";

export type GameAudioEvent =
  | "jump"
  | "land"
  | "perfect"
  | "great"
  | "good"
  | "prism"
  | "portal"
  | "death"
  | "complete";

type Theme = {
  root: number;
  scale: readonly number[];
  bass: readonly number[];
  arp: readonly number[];
  wave: OscillatorType;
  accentWave: OscillatorType;
  filterHz: number;
};

const THEMES: Record<AudioThemeId, Theme> = {
  "glass-horizon": {
    root: 45,
    scale: [0, 2, 7, 9, 12],
    bass: [0, 0, 7, 2, 9, 7, 2, 4],
    arp: [0, 7, 12, 9, 2, 9, 14, 7],
    wave: "triangle",
    accentWave: "sine",
    filterHz: 2100,
  },
  "phase-bloom": {
    root: 41,
    scale: [0, 3, 7, 10, 14],
    bass: [0, 0, 10, 7, 3, 10, 7, 14],
    arp: [0, 7, 10, 15, 3, 10, 14, 19],
    wave: "sawtooth",
    accentWave: "triangle",
    filterHz: 1650,
  },
  "null-circuit": {
    root: 38,
    scale: [0, 1, 6, 7, 10],
    bass: [0, 0, 6, 1, 10, 6, 7, 1],
    arp: [0, 6, 12, 7, 1, 13, 10, 18],
    wave: "square",
    accentWave: "sawtooth",
    filterHz: 1250,
  },
  daily: {
    root: 43,
    scale: [0, 2, 5, 7, 10],
    bass: [0, 5, 10, 7, 2, 10, 5, 7],
    arp: [0, 7, 12, 10, 5, 14, 17, 7],
    wave: "triangle",
    accentWave: "sawtooth",
    filterHz: 1800,
  },
  endless: {
    root: 40,
    scale: [0, 3, 5, 7, 10],
    bass: [0, 0, 7, 10, 3, 5, 10, 7],
    arp: [0, 7, 12, 15, 5, 10, 17, 19],
    wave: "sawtooth",
    accentWave: "square",
    filterHz: 1500,
  },
};

const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/**
 * A compact, original procedural score. Audio is presentation-only: callers pass
 * the authoritative simulation tick when starting or resuming a track.
 */
export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private music: GainNode | null = null;
  private sfx: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private scheduler: number | null = null;
  private nextStepTime = 0;
  private nextStep = 0;
  private bpm = 120;
  private tickRate = 120;
  private theme: Theme = THEMES["glass-horizon"];
  private activeSources = new Set<AudioScheduledSourceNode>();
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.72;
  private musicVolume = 0.66;
  private sfxVolume = 0.82;

  get isUnlocked() {
    return this.context !== null && this.context.state !== "closed";
  }

  async unlock(): Promise<boolean> {
    if (!this.context) {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) return false;
      const context = new AudioContextClass({ latencyHint: "interactive" });
      const master = context.createGain();
      const music = context.createGain();
      const sfx = context.createGain();
      const filter = context.createBiquadFilter();
      const compressor = context.createDynamicsCompressor();

      filter.type = "lowpass";
      filter.frequency.value = 2100;
      filter.Q.value = 0.8;
      compressor.threshold.value = -14;
      compressor.knee.value = 15;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.006;
      compressor.release.value = 0.18;
      music.gain.value = this.musicGain;
      sfx.gain.value = this.sfxGain;
      master.gain.value = this.muted ? 0 : this.volume;

      music.connect(filter);
      filter.connect(compressor);
      sfx.connect(compressor);
      compressor.connect(master);
      master.connect(context.destination);

      this.context = context;
      this.master = master;
      this.music = music;
      this.sfx = sfx;
      this.musicFilter = filter;
      this.compressor = compressor;
    }

    if (this.context.state === "suspended") await this.context.resume();
    return this.context.state === "running";
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.rampMaster();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.rampMaster();
  }

  setMix(masterVolume: number, musicVolume: number, sfxVolume: number) {
    this.volume = Math.max(0, Math.min(1, masterVolume));
    this.musicVolume = Math.max(0, Math.min(1, musicVolume));
    this.sfxVolume = Math.max(0, Math.min(1, sfxVolume));
    this.rampMaster();
    if (!this.context) return;
    this.music?.gain.setTargetAtTime(this.musicGain, this.context.currentTime, 0.035);
    this.sfx?.gain.setTargetAtTime(this.sfxGain, this.context.currentTime, 0.035);
  }

  start(themeId: AudioThemeId, bpm: number, simulationTick = 0, tickRate = 120) {
    if (!this.context || !this.musicFilter) return;
    this.stopScheduler();
    this.theme = THEMES[themeId];
    this.bpm = bpm;
    this.tickRate = tickRate;
    this.nextStep = Math.floor((simulationTick / tickRate) * (bpm / 60) * 4);
    this.nextStepTime = this.context.currentTime + 0.06;
    this.musicFilter.frequency.cancelScheduledValues(this.context.currentTime);
    this.musicFilter.frequency.setTargetAtTime(this.theme.filterHz, this.context.currentTime, 0.08);
    this.scheduleWindow();
    this.scheduler = window.setInterval(() => this.scheduleWindow(), 70);
  }

  pause() {
    this.stopScheduler();
    if (this.context && this.music) {
      this.music.gain.cancelScheduledValues(this.context.currentTime);
      this.music.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.025);
    }
  }

  resume(themeId: AudioThemeId, bpm: number, simulationTick: number, tickRate = 120) {
    if (this.context && this.music) {
      this.music.gain.cancelScheduledValues(this.context.currentTime);
      this.music.gain.setTargetAtTime(this.musicGain, this.context.currentTime, 0.06);
    }
    this.start(themeId, bpm, simulationTick, tickRate);
  }

  stop() {
    this.stopScheduler();
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // A source may already have reached its scheduled stop time.
      }
    }
    this.activeSources.clear();
  }

  trigger(event: GameAudioEvent, flow = 0) {
    const context = this.context;
    if (!context || !this.sfx || context.state !== "running") return;
    const now = context.currentTime;
    const root = this.theme.root + 24;
    switch (event) {
      case "jump":
        this.tone(root + 7, now, 0.08, 0.035, "sine", this.sfx);
        break;
      case "land":
        this.noise(now, 0.045, 0.025, 3200, this.sfx);
        break;
      case "perfect":
        this.chord([root, root + 7, root + 12 + Math.min(7, Math.floor(flow / 10))], now, 0.16, 0.075);
        break;
      case "great":
        this.chord([root, root + 7], now, 0.12, 0.055);
        break;
      case "good":
        this.tone(root, now, 0.09, 0.04, "triangle", this.sfx);
        break;
      case "prism":
        this.chord([root + 12, root + 16, root + 19], now, 0.42, 0.09);
        break;
      case "portal":
        this.sweep(now, 0.32, 160, 1080, 0.08);
        break;
      case "death":
        this.sweep(now, 0.36, 110, 34, 0.16);
        this.noise(now, 0.2, 0.07, 850, this.sfx);
        break;
      case "complete":
        this.chord([root, root + 7, root + 12, root + 19], now, 0.9, 0.1);
        break;
    }
  }

  async destroy() {
    this.stop();
    const context = this.context;
    this.context = null;
    this.master = null;
    this.music = null;
    this.sfx = null;
    this.musicFilter = null;
    this.compressor = null;
    this.noiseBuffer = null;
    if (context && context.state !== "closed") await context.close();
  }

  private scheduleWindow() {
    const context = this.context;
    if (!context || !this.music || context.state !== "running") return;
    const stepSeconds = 60 / this.bpm / 4;
    while (this.nextStepTime < context.currentTime + 0.22) {
      this.scheduleStep(this.nextStep, this.nextStepTime, stepSeconds);
      this.nextStep += 1;
      this.nextStepTime += stepSeconds;
    }
  }

  private scheduleStep(step: number, at: number, stepSeconds: number) {
    if (!this.music) return;
    const local = step % 16;
    const phrase = Math.floor(step / 16);
    if (local === 0 || local === 7 || local === 10) this.kick(at, local === 0 ? 0.12 : 0.075);
    if (local === 4 || local === 12) this.snare(at, local === 12 ? 0.055 : 0.045);
    if (local % 2 === 0 || (phrase % 4 >= 2 && local % 2 === 1)) {
      this.noise(at, 0.025, local % 4 === 2 ? 0.014 : 0.009, 7200, this.music);
    }
    if (local % 4 === 0) {
      const bassIndex = (phrase * 4 + local / 4) % this.theme.bass.length;
      const note = this.theme.root + (this.theme.bass[bassIndex] ?? 0) - 12;
      this.tone(note, at, stepSeconds * 3.2, 0.07, this.theme.wave, this.music);
    }
    if (local % 2 === 1) {
      const arpIndex = (step + phrase) % this.theme.arp.length;
      const note = this.theme.root + (this.theme.arp[arpIndex] ?? 0) + 12;
      this.tone(note, at, stepSeconds * 0.9, 0.022, this.theme.accentWave, this.music);
    }
  }

  private tone(
    midi: number,
    at: number,
    duration: number,
    gainValue: number,
    wave: OscillatorType,
    destination: AudioNode,
  ) {
    const context = this.context;
    if (!context || this.activeSources.size >= 48) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.setValueAtTime(midiToHz(midi), at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainValue), at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(destination);
    this.trackSource(oscillator);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  private chord(notes: readonly number[], at: number, duration: number, gain: number) {
    if (!this.sfx) return;
    notes.forEach((note, index) =>
      this.tone(note, at + index * 0.012, duration, gain / Math.sqrt(notes.length), "sine", this.sfx!),
    );
  }

  private kick(at: number, gainValue: number) {
    const context = this.context;
    if (!context || !this.music || this.activeSources.size >= 48) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(145, at);
    oscillator.frequency.exponentialRampToValueAtTime(42, at + 0.11);
    gain.gain.setValueAtTime(gainValue, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.13);
    oscillator.connect(gain);
    gain.connect(this.music);
    this.trackSource(oscillator);
    oscillator.start(at);
    oscillator.stop(at + 0.14);
  }

  private snare(at: number, gainValue: number) {
    if (!this.music) return;
    this.noise(at, 0.1, gainValue, 2300, this.music);
    this.tone(this.theme.root - 5, at, 0.075, gainValue * 0.4, "triangle", this.music);
  }

  private noise(at: number, duration: number, gainValue: number, cutoff: number, destination: AudioNode) {
    const context = this.context;
    if (!context || this.activeSources.size >= 48) return;
    if (!this.noiseBuffer) {
      const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const channel = buffer.getChannelData(0);
      let state = 0x9e3779b9;
      for (let i = 0; i < channel.length; i += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        channel[i] = ((state >>> 0) / 0xffffffff) * 2 - 1;
      }
      this.noiseBuffer = buffer;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = "highpass";
    filter.frequency.value = cutoff;
    gain.gain.setValueAtTime(Math.max(0.0001, gainValue), at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    this.trackSource(source);
    source.start(at);
    source.stop(at + duration + 0.02);
  }

  private sweep(at: number, duration: number, from: number, to: number, gainValue: number) {
    const context = this.context;
    if (!context || !this.sfx || this.activeSources.size >= 48) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + duration);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(gainValue, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    oscillator.connect(gain);
    gain.connect(this.sfx);
    this.trackSource(oscillator);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
  }

  private trackSource(source: AudioScheduledSourceNode) {
    this.activeSources.add(source);
    source.addEventListener("ended", () => this.activeSources.delete(source), { once: true });
  }

  private rampMaster() {
    if (!this.context || !this.master) return;
    const target = this.muted ? 0.0001 : Math.max(0.0001, this.volume);
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.025);
  }

  private stopScheduler() {
    if (this.scheduler !== null) {
      window.clearInterval(this.scheduler);
      this.scheduler = null;
    }
  }

  private get musicGain() {
    return 0.52 * this.musicVolume;
  }

  private get sfxGain() {
    return 0.64 * this.sfxVolume;
  }
}
