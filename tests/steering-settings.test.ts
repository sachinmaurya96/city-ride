import { expect, it } from 'vitest';
import { createDefaultSave, defaultSettings, SettingsSchema, validateSave } from '../src/storage/schema';

it('retains gentle steering through save serialization and reload', () => {
  const save = createDefaultSave(1, '2026-10-12', { ...defaultSettings('high', 'en'), steerSensitivity: .25 });
  save.wallet = 123;
  const loaded = validateSave(JSON.parse(JSON.stringify(save)));
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.data.settings).toMatchObject({ steerSensitivity: .25, quality: 'high' });
  expect(loaded.data.wallet).toBe(123);
});

it.each([.5, 1, 1.6])('preserves an existing saved sensitivity of %s', (steerSensitivity) => {
  const settings = SettingsSchema.parse({ ...defaultSettings('medium', 'ru'), steerSensitivity });
  expect(settings.steerSensitivity).toBe(steerSensitivity);
});

it('defaults older saves without steering sensitivity to the unchanged normal turning range', () => {
  const older = JSON.parse(JSON.stringify(createDefaultSave(1, '2026-10-12', defaultSettings('low', 'ru'))));
  delete older.settings.steerSensitivity;
  const loaded = validateSave(older);
  expect(loaded.ok).toBe(true);
  if (!loaded.ok) return;
  expect(loaded.data.settings).toMatchObject({ steerSensitivity: 1, quality: 'low', language: 'ru' });
});

it.each([[-1, .25], [3, 1.6]])('bounds an out-of-range saved sensitivity of %s to %s', (saved, expected) => {
  const settings = SettingsSchema.parse({ ...defaultSettings('medium', 'en'), steerSensitivity: saved });
  expect(settings.steerSensitivity).toBe(expected);
});
