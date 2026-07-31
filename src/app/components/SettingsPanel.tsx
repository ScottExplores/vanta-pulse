import type { CSSProperties } from "react";
import type { GameSettings, SettingsPanelProps } from "../ui-types";
import { Icon } from "./Icons";

interface ToggleRowProps {
  checked: boolean;
  description: string;
  label: string;
  onChange: (checked: boolean) => void;
}

function ToggleRow({ checked, description, label, onChange }: ToggleRowProps) {
  return (
    <div className="vp-setting-row">
      <div className="vp-setting-row__copy">
        <span className="vp-setting-row__label">{label}</span>
        <span className="vp-setting-row__description">{description}</span>
      </div>
      <button
        aria-checked={checked}
        aria-label={`${label}: ${checked ? "on" : "off"}`}
        className="vp-switch"
        onClick={() => onChange(!checked)}
        role="switch"
        type="button"
      >
        <span className="vp-switch__track" />
        <span className="vp-switch__thumb" />
        <span className="vp-sr-only">{checked ? "On" : "Off"}</span>
      </button>
    </div>
  );
}

interface VolumeControlProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

function VolumeControl({ label, value, onChange }: VolumeControlProps) {
  const normalized = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <label className="vp-volume-control">
      <span className="vp-volume-control__topline">
        <span>{label}</span>
        <output>{normalized}%</output>
      </span>
      <input
        aria-label={`${label} volume`}
        max="100"
        min="0"
        onChange={(event) => onChange(Number(event.target.value) / 100)}
        style={{ "--vp-range-value": `${normalized}%` } as CSSProperties}
        type="range"
        value={normalized}
      />
    </label>
  );
}

export function SettingsPanel({ settings, onChange, onReset }: SettingsPanelProps) {
  const update = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className="vp-settings-panel">
      <section aria-labelledby="vp-audio-settings" className="vp-settings-section">
        <header className="vp-settings-section__header">
          <Icon name="audio" size={18} />
          <h3 id="vp-audio-settings">Audio mix</h3>
        </header>
        <div className="vp-volume-grid">
          <VolumeControl label="Master" onChange={(value) => update("masterVolume", value)} value={settings.masterVolume} />
          <VolumeControl label="Music" onChange={(value) => update("musicVolume", value)} value={settings.musicVolume} />
          <VolumeControl label="Effects" onChange={(value) => update("sfxVolume", value)} value={settings.sfxVolume} />
        </div>
      </section>

      <section aria-labelledby="vp-visual-settings" className="vp-settings-section">
        <header className="vp-settings-section__header">
          <Icon name="settings" size={18} />
          <h3 id="vp-visual-settings">Visual response</h3>
        </header>
        <div className="vp-setting-list">
          <ToggleRow
            checked={settings.photosensitiveMode}
            description="Caps flashes and removes rapid luminance changes."
            label="Photosensitive mode"
            onChange={(value) => update("photosensitiveMode", value)}
          />
          <ToggleRow
            checked={settings.reducedMotion}
            description="Disables parallax and non-essential interface motion."
            label="Reduced motion"
            onChange={(value) => update("reducedMotion", value)}
          />
          <ToggleRow
            checked={settings.screenShake}
            description="Adds brief camera force on landings and collisions."
            label="Impact shake"
            onChange={(value) => update("screenShake", value)}
          />
          <ToggleRow
            checked={settings.highContrast}
            description="Strengthens hazard outlines and HUD contrast."
            label="High contrast"
            onChange={(value) => update("highContrast", value)}
          />
          <ToggleRow
            checked={settings.showFps}
            description="Shows a compact performance readout in-game."
            label="Performance meter"
            onChange={(value) => update("showFps", value)}
          />
        </div>
      </section>

      {onReset && (
        <div className="vp-panel-actions">
          <button className="vp-text-button" onClick={onReset} type="button">
            <Icon name="refresh" size={16} />
            Restore defaults
          </button>
        </div>
      )}
    </div>
  );
}
