import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultQuality, QUALITY_PRESETS, renderPixelRatio, resolveQuality } from '../src/game/render/quality';
import { createDefaultSave, defaultSettings, validateSave } from '../src/storage/schema';

afterEach(() => vi.unstubAllGlobals());

describe('graphics controls', () => {
  it.each(['Android Mobile', 'iPhone', 'iPad', 'Desktop'])('does not force Low for %s', (userAgent) => {
    vi.stubGlobal('navigator', { userAgent });
    expect(defaultQuality()).toBe('medium');
  });

  it('loads an older save without discarding its chosen preset or progress', () => {
    const old = JSON.parse(JSON.stringify(createDefaultSave(1, '2026-10-09', defaultSettings('low', 'en'))));
    old.wallet = 1234;
    delete old.settings.renderResolution;
    delete old.settings.shadows;
    delete old.settings.viewDistance;
    const result = validateSave(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.wallet).toBe(1234);
    expect(result.data.settings).toMatchObject({ quality: 'low', renderResolution: 'auto', shadows: 'auto', viewDistance: 'auto' });
  });

  it('keeps Native sharpness independent of the scene preset on high-density screens', () => {
    expect(renderPixelRatio(QUALITY_PRESETS.low, 'auto', 3)).toBe(1);
    expect(renderPixelRatio(QUALITY_PRESETS.high, 'auto', 3)).toBe(2);
    expect(renderPixelRatio(QUALITY_PRESETS.low, 'native', 3)).toBe(3);
    expect(renderPixelRatio(QUALITY_PRESETS.ultra, 'native', 4)).toBe(4);
    expect(renderPixelRatio(QUALITY_PRESETS.ultra, 'standard', 3)).toBe(1);
    expect(renderPixelRatio(QUALITY_PRESETS.ultra, 'sharp', 3)).toBe(2);
    expect(renderPixelRatio(QUALITY_PRESETS.high, 'auto', 1)).toBe(1);
    expect(renderPixelRatio(QUALITY_PRESETS.high, 'native', NaN)).toBe(1);
  });

  it('applies shadow and distance overrides without mutating other profiles', () => {
    const controls = { ...defaultSettings('high', 'en'), shadows: 'off' as const, viewDistance: 'near' as const };
    expect(resolveQuality(controls)).toMatchObject({ level: 'high', shadows: false, drawDistance: 210, shadowMapSize: 2048 });
    expect(QUALITY_PRESETS.high).toMatchObject({ shadows: true, drawDistance: 420 });
    expect(resolveQuality({ ...controls, quality: 'low', shadows: 'on', viewDistance: 'max' })).toMatchObject({ shadows: true, shadowMapSize: 1024, drawDistance: 560 });
  });

  it('persists Ultra and individual controls with the existing save version', () => {
    const save = createDefaultSave(1, '2026-10-09', { ...defaultSettings('ultra', 'en'), renderResolution: 'native', shadows: 'off', viewDistance: 'far' });
    const result = validateSave(JSON.parse(JSON.stringify(save)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.settings).toMatchObject({ quality: 'ultra', renderResolution: 'native', shadows: 'off', viewDistance: 'far' });
  });
});
