import { useState, useRef, useEffect, useCallback } from 'react';
import * as cornerstone from '@cornerstonejs/core';

interface Preset {
  name: string;
  window: number;
  level: number;
  description: string;
}

// Standard radiology CT W/L presets. Values follow Radiopaedia /
// Horos / OsiriX defaults so radiologists see familiar windows out of
// the box. Soft Tissue is the universal default (W400 L40).
//
// Refs:
//   https://radiopaedia.org/articles/windowing-ct
//   Horos default preset bundle (CT-Abdomen, CT-Bone, CT-Lung, …)
const CT_PRESETS: Preset[] = [
  { name: 'Soft Tissue', window: 400, level: 40, description: 'Default soft-tissue window' },
  { name: 'Bone', window: 1800, level: 400, description: 'Bone / spine' },
  { name: 'Lung', window: 1500, level: -600, description: 'Lung parenchyma' },
  { name: 'Brain', window: 80, level: 40, description: 'Brain parenchyma' },
  { name: 'Abdomen', window: 350, level: 40, description: 'Abdominal soft tissue' },
  { name: 'Mediastinum', window: 350, level: 50, description: 'Mediastinum' },
  { name: 'Liver', window: 150, level: 30, description: 'Liver / narrow soft tissue' },
  { name: 'CT Angio', window: 600, level: 100, description: 'Vascular contrast' },
  { name: 'Stroke', window: 40, level: 40, description: 'Narrow stroke window' },
];

// MR presets. MR signal is dimensionless and sequence-dependent, so
// fixed W/L numbers never transfer between scanners. Anchors here are
// expressed as fractions of the volume's actual data range (window =
// fraction of range, level = fraction of range from min). applyPreset
// reads the loaded volume's min/max and produces absolute W/L per study.
//
// "Default" is special: it triggers viewport.resetProperties() to fall
// back to the WindowCenter/WindowWidth the scanner baked into the DICOM
// header — the most reliable starting point for any sequence.
//
// Tuned fractions are based on:
//   https://radiopaedia.org/articles/window-and-level
//   Horos MR presets (T1, T2, STIR, PD)
//   OHIF default MR hanging protocols
interface MRPreset {
  name: string;
  windowFrac: number;  // fraction of (max - min) used as window width
  levelFrac: number;   // 0..1, where in the range to center
  description: string;
  reset?: boolean;     // ignore frac fields; fall back to DICOM-baked W/L
}
const MR_PRESETS_TUNED: MRPreset[] = [
  { name: 'Default',   reset: true,                                 windowFrac: 0, levelFrac: 0, description: 'DICOM WindowCenter / WindowWidth' },
  { name: 'Auto',      windowFrac: 1.10, levelFrac: 0.45, description: 'Auto-fit to tissue percentile' },
  { name: 'T1',        windowFrac: 0.45, levelFrac: 0.25, description: 'T1 weighted — anatomy' },
  { name: 'T2',        windowFrac: 0.70, levelFrac: 0.30, description: 'T2 weighted — fluid bright' },
  { name: 'STIR/TIRM', windowFrac: 0.85, levelFrac: 0.35, description: 'Fat-suppressed / fluid' },
  { name: 'PD',        windowFrac: 0.55, levelFrac: 0.30, description: 'Proton density' },
  { name: 'Dark',      windowFrac: 0.35, levelFrac: 0.18, description: 'Tighter window, darker tissue' },
];
// Surface the same shape as CT presets to the rest of the component
// (the dropdown UI iterates over name/window/level/description). The
// fractional intent is consumed by applyPreset below.
const MR_PRESETS: Preset[] = MR_PRESETS_TUNED.map((p) => ({
  name: p.name,
  window: Math.round(p.windowFrac * 2000),
  level: Math.round(p.levelFrac * 2000),
  description: p.description,
}));

// Colormaps — VTK.js preset names
const COLORMAPS = [
  'Grayscale',
  'hsv', 'jet', 'rainbow', 'Warm to Cool', 'Cool to Warm',
  'Inferno (matplotlib)', 'Viridis (matplotlib)', 'Plasma (matplotlib)',
  'Black-Body Radiation', 'X Ray', 'bone_Matlab',
];

interface Props {
  renderingEngineId: string;
  viewportIds: string[];
  modality?: string;
  /**
   * Name of a preset to auto-apply once each time `volumeKey` changes.
   * Used to land the user on a sensible default window (e.g. "Bone" for
   * spine CT) instead of whatever WindowCenter/WindowWidth the scanner
   * baked into the DICOM header.
   */
  defaultPreset?: string;
  /**
   * Identifier of the currently active volume (e.g. SeriesInstanceUID).
   * When this changes, the default preset is re-applied — once the
   * viewport has had a tick to mount.
   */
  volumeKey?: string;
}

export function WindowLevelPresets({ renderingEngineId, viewportIds, modality, defaultPreset, volumeKey }: Props) {
  const mod = modality?.trim().toUpperCase() || '';
  const PRESETS = (mod === 'MR' || mod === 'MRI') ? MR_PRESETS : CT_PRESETS;
  // Start with no preset highlighted — the initial W/L comes from the
  // DICOM WindowCenter/WindowWidth tags baked into the study, not from a
  // named preset. "W/L" label until the user picks a window.
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showColormap, setShowColormap] = useState(false);
  const [activeColormap, setActiveColormap] = useState('Grayscale');
  const [invertColors, setInvertColors] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const colormapRef = useRef<HTMLDivElement>(null);

  // Get all target viewport IDs including stack2d if it exists
  const getAllTargetVpIds = useCallback(() => {
    const ids = [...viewportIds];
    const engine = cornerstone.getRenderingEngine(renderingEngineId);
    if (engine) {
      try { if (engine.getViewport('stack2d')) ids.push('stack2d'); } catch {}
    }
    return ids;
  }, [renderingEngineId, viewportIds]);

  const applyPreset = useCallback((preset: Preset) => {
    const engine = cornerstone.getRenderingEngine(renderingEngineId);
    if (!engine) return;

    const isMR = (mod === 'MR' || mod === 'MRI');

    // MR "Default" → reset to the DICOM-baked WindowCenter/WindowWidth.
    // Most reliable starting point because MR signal scales are
    // sequence- and scanner-dependent and no fixed W/L generalises.
    const tuned = isMR ? MR_PRESETS_TUNED.find((p) => p.name === preset.name) : undefined;
    if (tuned?.reset) {
      for (const vpId of getAllTargetVpIds()) {
        const viewport = engine.getViewport(vpId) as any;
        if (!viewport || viewport.type === cornerstone.Enums.ViewportType.VOLUME_3D) continue;
        try { viewport.resetProperties?.(); } catch { /* ignore */ }
        viewport.render();
      }
      setActivePreset(preset.name);
      setIsOpen(false);
      return;
    }

    // MR fractional anchor → resolve against the volume's real data
    // distribution. Plain min/max windowing washes out because outliers
    // dominate; sample the loaded scalar data and use 2nd / 98th
    // percentiles so tissue lands in mid-gray regardless of sequence.
    // Falls back to a [0, 2000] assumption if voxel data isn't ready yet.
    let rangeMin = 0;
    let rangeMax = 2000;
    if (isMR) {
      try {
        const volume = cornerstone.cache.getVolume('cornerstoneStreamingImageVolume:myVolume') as any;
        const sd = volume?.scalarData as ArrayLike<number> | undefined;
        if (sd && sd.length > 0) {
          const N = Math.min(sd.length, 20000);
          const stride = Math.max(1, Math.floor(sd.length / N));
          const samples: number[] = [];
          for (let i = 0; i < sd.length; i += stride) {
            const v = (sd as any)[i];
            if (Number.isFinite(v) && v > 0) samples.push(v); // drop background zeros
          }
          if (samples.length > 100) {
            samples.sort((a, b) => a - b);
            const p = (q: number) => samples[Math.min(samples.length - 1, Math.max(0, Math.floor(samples.length * q)))];
            rangeMin = p(0.02);
            rangeMax = p(0.98);
          } else if (volume?.voxelManager) {
            const range = volume.voxelManager.getRange();
            if (range) { rangeMin = range[0]; rangeMax = range[1]; }
          }
        } else if (volume?.voxelManager) {
          const range = volume.voxelManager.getRange();
          if (range) { rangeMin = range[0]; rangeMax = range[1]; }
        }
      } catch { /* ignore */ }
    }

    for (const vpId of getAllTargetVpIds()) {
      const viewport = engine.getViewport(vpId);
      if (!viewport || viewport.type === cornerstone.Enums.ViewportType.VOLUME_3D) continue;

      let lower: number;
      let upper: number;
      if (isMR && tuned) {
        const span = rangeMax - rangeMin;
        const w = tuned.windowFrac * span;
        const l = rangeMin + tuned.levelFrac * span;
        lower = l - w / 2;
        upper = l + w / 2;
      } else {
        const w = preset.window;
        const l = preset.level;
        lower = l - w / 2;
        upper = l + w / 2;
      }

      (viewport as any).setProperties({ voiRange: { lower, upper } });
      viewport.render();
    }
    setActivePreset(preset.name);
    setIsOpen(false);
  }, [renderingEngineId, mod, getAllTargetVpIds]);

  const applyColormap = useCallback((name: string) => {
    const engine = cornerstone.getRenderingEngine(renderingEngineId);
    if (!engine) return;
    for (const vpId of getAllTargetVpIds()) {
      const viewport = engine.getViewport(vpId);
      if (!viewport || viewport.type === cornerstone.Enums.ViewportType.VOLUME_3D) continue;
      try {
        if (name === 'Grayscale') {
          // Remove colormap — try multiple approaches
          const vp = viewport as any;
          if (vp.setColormap) {
            vp.setColormap(undefined);
          }
          // Also reset via the actor's color transfer function
          try {
            const actor = vp.getDefaultActor?.()?.actor;
            if (actor) {
              const property = actor.getProperty?.();
              if (property) {
                const cfun = property.getRGBTransferFunction?.(0);
                if (cfun) {
                  cfun.removeAllPoints();
                  cfun.addRGBPoint(0, 0, 0, 0);
                  cfun.addRGBPoint(1, 1, 1, 1);
                  property.modified();
                }
              }
            }
          } catch {}
          vp.setProperties({ invert: invertColors });
        } else {
          (viewport as any).setProperties({ colormap: { name } as any });
        }
        viewport.render();
      } catch { /* ignore */ }
    }
    setActiveColormap(name);
    setShowColormap(false);
  }, [renderingEngineId, invertColors, getAllTargetVpIds]);

  const toggleInvert = useCallback(() => {
    const next = !invertColors;
    setInvertColors(next);
    const engine = cornerstone.getRenderingEngine(renderingEngineId);
    if (!engine) return;
    for (const vpId of getAllTargetVpIds()) {
      const viewport = engine.getViewport(vpId);
      if (!viewport || viewport.type === cornerstone.Enums.ViewportType.VOLUME_3D) continue;
      (viewport as any).setProperties({ invert: next });
      viewport.render();
    }
  }, [invertColors, renderingEngineId, viewportIds]);

  // Auto-apply the configured default preset once per volume. Waits for
  // both the viewport to mount AND the volume's scalar data to start
  // populating — otherwise the MR "Auto" preset resolves against a
  // stale or empty range and produces a near-black window. 30s ceiling
  // covers slow networks loading a 300-slice 3D MR volume.
  useEffect(() => {
    if (!defaultPreset || !volumeKey) return;
    const preset = PRESETS.find((p) => p.name === defaultPreset);
    if (!preset) return;
    const isMR = (mod === 'MR' || mod === 'MRI');
    let cancelled = false;
    let attempts = 0;
    const tick = () => {
      if (cancelled) return;
      const engine = cornerstone.getRenderingEngine(renderingEngineId);
      const viewportReady = engine && getAllTargetVpIds().some((id) => {
        try { return !!engine.getViewport(id); } catch { return false; }
      });
      let volumeReady = true;
      if (isMR && viewportReady) {
        try {
          const volume = cornerstone.cache.getVolume('cornerstoneStreamingImageVolume:myVolume') as any;
          const sd = volume?.scalarData as ArrayLike<number> | undefined;
          volumeReady = !!sd && sd.length > 1000;
        } catch { volumeReady = false; }
      }
      if (viewportReady && volumeReady) {
        applyPreset(preset);
      } else if (attempts < 150) {
        attempts += 1;
        setTimeout(tick, 200);
      }
    };
    const start = setTimeout(tick, 200);
    return () => { cancelled = true; clearTimeout(start); };
  }, [volumeKey, defaultPreset, PRESETS, renderingEngineId, getAllTargetVpIds, applyPreset, mod]);

  // Number key shortcuts (1-9) for presets
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= PRESETS.length) {
        e.preventDefault();
        applyPreset(PRESETS[num - 1]);
      }
      if (e.key === 'i' || e.key === 'I') {
        toggleInvert();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [PRESETS, applyPreset, toggleInvert]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen && !showColormap) return;
    const handler = (e: MouseEvent) => {
      if (isOpen && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false);
      if (showColormap && colormapRef.current && !colormapRef.current.contains(e.target as Node)) setShowColormap(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, showColormap]);

  const itemStyle = (active: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', padding: '7px 12px', background: 'none', border: 'none',
    color: active ? 'var(--accent)' : 'var(--text-primary)', cursor: 'pointer',
    fontSize: '13px', textAlign: 'left',
  });

  return (
    <>
      {/* W/L Presets */}
      <div className="wl-dropdown" ref={dropdownRef} style={{ position: 'relative' }}>
        <button
          className={`toolbar-btn ${isOpen ? 'active' : ''}`}
          onClick={() => { setIsOpen(!isOpen); setShowColormap(false); }}
          title="Window/Level Presets (1-9)"
        >
          <span className="tool-icon">◐</span>
          <span className="tool-label">{activePreset || 'W/L'}</span>
          <span style={{ fontSize: '8px', marginLeft: 2 }}>{isOpen ? '▲' : '▼'}</span>
        </button>
        {isOpen && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 100, minWidth: 200,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '4px 0',
            color: 'var(--text-primary)',
          }}>
            {PRESETS.map((preset, idx) => (
              <button
                key={preset.name}
                style={itemStyle(activePreset === preset.name)}
                onClick={() => applyPreset(preset)}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in oklch, var(--nd-ink) 6%, transparent)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <span>
                  {activePreset === preset.name && <span style={{ marginRight: 6 }}>&#10003;</span>}
                  {preset.name}
                </span>
                <span style={{ color: 'var(--text-muted)', fontSize: '12px', fontWeight: 600 }}>{idx + 1}</span>
              </button>
            ))}
            <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
            <button
              style={itemStyle(invertColors)}
              onClick={toggleInvert}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in oklch, var(--nd-ink) 6%, transparent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
            >
              <span>{invertColors && <span style={{ marginRight: 6 }}>&#10003;</span>}Negative</span>
              <span style={{ color: 'var(--text-muted)', fontSize: '12px' }}>I</span>
            </button>
          </div>
        )}
      </div>

      {/* Colormap */}
      <div ref={colormapRef} style={{ position: 'relative' }}>
        <button
          className={`toolbar-btn ${showColormap ? 'active' : ''}`}
          onClick={() => { setShowColormap(!showColormap); setIsOpen(false); }}
          title="Pseudo Color Map"
        >
          <span className="tool-icon" style={{ background: 'linear-gradient(90deg, #000, #f00, #ff0, #fff)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', fontWeight: 900 }}>C</span>
          <span className="tool-label">Color</span>
          <span style={{ fontSize: '8px', marginLeft: 2 }}>{showColormap ? '▲' : '▼'}</span>
        </button>
        {showColormap && (
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 100, minWidth: 180,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: '4px 0',
            color: 'var(--text-primary)',
          }}>
            {COLORMAPS.map(cm => (
              <button
                key={cm}
                style={itemStyle(activeColormap === cm)}
                onClick={() => applyColormap(cm)}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in oklch, var(--nd-ink) 6%, transparent)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                <span>{activeColormap === cm && <span style={{ marginRight: 6 }}>&#10003;</span>}{cm}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
