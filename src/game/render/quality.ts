export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';
export type RenderResolution = 'auto' | 'standard' | 'sharp' | 'native';
export type ShadowMode = 'auto' | 'off' | 'on';
export type ViewDistance = 'auto' | 'near' | 'far' | 'max';

export interface GraphicsOptions {
  quality: QualityLevel;
  renderResolution: RenderResolution;
  shadows: ShadowMode;
  viewDistance: ViewDistance;
}

export interface QualityPreset {
  level: QualityLevel;
  pixelRatio: number;
  traffic: number;
  pedestrians: number;
  shadows: boolean;
  shadowMapSize: number;
  drawDistance: number;
  detailDistance: number;
  treeLodDistance: number;
  trafficLodDistance: number;
  rainDrops: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: { level: 'low', pixelRatio: 1, traffic: 8, pedestrians: 6, shadows: false, shadowMapSize: 512, drawDistance: 210, detailDistance: 100, treeLodDistance: 70, trafficLodDistance: 35, rainDrops: 400 },
  medium: { level: 'medium', pixelRatio: 1.5, traffic: 14, pedestrians: 12, shadows: true, shadowMapSize: 1024, drawDistance: 320, detailDistance: 170, treeLodDistance: 90, trafficLodDistance: 45, rainDrops: 900 },
  high: { level: 'high', pixelRatio: 2, traffic: 22, pedestrians: 20, shadows: true, shadowMapSize: 2048, drawDistance: 420, detailDistance: 230, treeLodDistance: 140, trafficLodDistance: 65, rainDrops: 1600 },
  ultra: { level: 'ultra', pixelRatio: 3, traffic: 22, pedestrians: 20, shadows: true, shadowMapSize: 4096, drawDistance: 560, detailDistance: 300, treeLodDistance: 190, trafficLodDistance: 90, rainDrops: 1600 },
};

/** Mutable current preset read by render systems (not React state). */
export const quality = { current: QUALITY_PRESETS.medium };

export function defaultQuality(): QualityLevel {
  // Touch input and a mobile user agent say nothing about GPU capability.
  return 'medium';
}

/** Apply explicit controls without changing the preset table or a player's chosen quality. */
export function resolveQuality(settings: GraphicsOptions): QualityPreset {
  const preset = QUALITY_PRESETS[settings.quality];
  return {
    ...preset,
    shadows: settings.shadows === 'auto' ? preset.shadows : settings.shadows === 'on',
    shadowMapSize: settings.shadows === 'on' ? Math.max(1024, preset.shadowMapSize) : preset.shadowMapSize,
    drawDistance: settings.viewDistance === 'auto' ? preset.drawDistance : settings.viewDistance === 'near' ? 210 : settings.viewDistance === 'far' ? 420 : 560,
  };
}

/** Pixel density follows the setting directly; Native has no mobile-only cap. */
export function renderPixelRatio(preset: QualityPreset, resolution: RenderResolution, deviceRatio: number): number {
  const screen = Number.isFinite(deviceRatio) && deviceRatio > 0 ? Math.max(1, deviceRatio) : 1;
  if (resolution === 'native') return screen;
  if (resolution === 'standard') return 1;
  return Math.min(screen, resolution === 'sharp' ? 2 : preset.pixelRatio);
}
