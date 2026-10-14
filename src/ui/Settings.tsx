import { useState } from 'react';
import { useGame } from '../app/store';
import { CHARACTER_IDS, CHARACTER_NAMES, loadCharacter, useCharacter } from '../game/render/importedCharacters';
import { PASSENGER_CHARACTER_IDS, isPassengerCharacter } from '../game/data/characters';
import { persistence } from '../storage/persistence';
import { STEERING_SENSITIVITY_RANGE } from '../storage/schema';
import { Modal } from './Screens';
import { defaultQuality, type RenderResolution, type ShadowMode, type ViewDistance } from '../game/render/quality';
import { ControlIcon } from './ControlIcon';
import './panelsTheme.css';

function GraphicsSettings() {
  const t = useGame((s) => s.t);
  const settings = useGame((s) => s.save.settings);
  const update = useGame((s) => s.updateSettings);
  const description = settings.quality === 'low' ? t.graphicsLow : settings.quality === 'medium' ? t.graphicsMedium : settings.quality === 'high' ? t.graphicsHigh : t.graphicsUltra;
  return (
    <section className="graphics-settings options-section" data-testid="graphics-settings">
      <h3><ControlIcon name="camera" />{t.graphics}</h3>
      <div className="seg graphics-presets" role="group" aria-label={t.quality}>
        {(['low', 'medium', 'high', 'ultra'] as const).map((level) => (
          <button key={level} className={settings.quality === level ? 'on' : ''} aria-pressed={settings.quality === level} onClick={() => update({ quality: level })} data-testid={`quality-${level}`}>
            {t[level]}
          </button>
        ))}
      </div>
      <p className="graphics-description">{description}</p>
      <div className="graphics-options">
        <label className="graphics-field">
          <span>{t.imageSharpness}</span>
          <select value={settings.renderResolution} onChange={(e) => update({ renderResolution: e.target.value as RenderResolution })} data-testid="graphics-resolution">
            <option value="auto">{t.fromPreset}</option>
            <option value="standard">{t.resolutionStandard}</option>
            <option value="sharp">{t.resolutionSharp}</option>
            <option value="native">{t.resolutionNative}</option>
          </select>
        </label>
        <label className="graphics-field">
          <span>{t.graphicsShadows}</span>
          <select value={settings.shadows} onChange={(e) => update({ shadows: e.target.value as ShadowMode })} data-testid="graphics-shadows">
            <option value="auto">{t.fromPreset}</option>
            <option value="off">{t.shadowsOff}</option>
            <option value="on">{t.shadowsOn}</option>
          </select>
        </label>
        <label className="graphics-field">
          <span>{t.viewDistance}</span>
          <select value={settings.viewDistance} onChange={(e) => update({ viewDistance: e.target.value as ViewDistance })} data-testid="graphics-distance">
            <option value="auto">{t.fromPreset}</option>
            <option value="near">{t.distanceNear}</option>
            <option value="far">{t.distanceFar}</option>
            <option value="max">{t.distanceMax}</option>
          </select>
        </label>
      </div>
      <p className="graphics-hint">{t.graphicsHint}</p>
      <div className="graphics-footer">
        <small>{t.graphicsSaved}</small>
        <button className="link" onClick={() => update({ quality: defaultQuality(), renderResolution: 'auto', shadows: 'auto', viewDistance: 'auto' })} data-testid="reset-graphics">{t.resetGraphics}</button>
      </div>
    </section>
  );
}

export function SettingsOverlay() {
  const t = useGame((s) => s.t);
  const st = useGame((s) => s.save.settings);
  const character = useCharacter(st.driver);
  const passengerModel = useCharacter(isPassengerCharacter(st.passengerCharacter) ? st.passengerCharacter : null);
  const status = useGame((s) => s.saveStatus);
  const update = useGame((s) => s.updateSettings);
  const close = useGame((s) => s.closeOverlay);
  const [confirmReset, setConfirmReset] = useState(false);
  const slider = (label: string, key: 'masterVolume' | 'sfxVolume' | 'ambienceVolume' | 'musicVolume') => (
    <label className="set-row slider-row">
      <span>{label}</span>
      <span className="setting-slider">
        <input type="range" min={0} max={1} step={0.05} value={st[key]} onChange={(e) => update({ [key]: Number(e.target.value) })} aria-label={label} aria-valuetext={`${Math.round(st[key] * 100)}%`} />
        <span className="slider-value" aria-hidden="true">{Math.round(st[key] * 100)}%</span>
      </span>
    </label>
  );
  const toggle = (label: string, key: 'muted' | 'autoRecenter' | 'reducedMotion') => (
    <label className="set-row toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={st[key]} onChange={(e) => update({ [key]: e.target.checked })} aria-label={label} data-testid={`set-${key}`} />
    </label>
  );
  const statusText = status === 'unavailable' ? t.saveUnavailable : status === 'error' ? t.saveError : status === 'saving' ? t.saving : t.saved;
  return (
    <Modal label={t.settings} onClose={close} className="settings" testId="settings">
      <div className="modal-head">
        <h2><ControlIcon name="settings" /> {t.settings}</h2>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className="settings-body">
        <GraphicsSettings />
        <section className="options-section">
          <h3><ControlIcon name="sound" />{t.audio}</h3>
          {slider(t.master, 'masterVolume')}
          {slider(t.effects, 'sfxVolume')}
          {slider(t.ambience, 'ambienceVolume')}
          {slider(t.music, 'musicVolume')}
          {toggle(t.mute, 'muted')}
        </section>
        <section className="options-section">
          <h3><ControlIcon name="controller" />{t.controlPreset}</h3>
          <div className="seg" role="group" aria-label={t.controlPreset}>
            <button className={st.controls === 'joystick' ? 'on' : ''} aria-pressed={st.controls === 'joystick'} onClick={() => update({ controls: 'joystick' })} data-testid="preset-joystick">
              {t.presetJoystick}
            </button>
            <button className={st.controls === 'pedals' ? 'on' : ''} aria-pressed={st.controls === 'pedals'} onClick={() => update({ controls: 'pedals' })} data-testid="preset-pedals">
              {t.presetPedals}
            </button>
          </div>
          <label className="set-row slider-row">
            <span>{t.sensitivity}</span>
            <span className="setting-slider">
              <input type="range" {...STEERING_SENSITIVITY_RANGE} value={st.steerSensitivity} onChange={(e) => update({ steerSensitivity: Number(e.target.value) })} aria-label={t.sensitivity} aria-describedby="steering-sensitivity-hint" data-testid="steering-sensitivity" />
              <span className="slider-value" aria-hidden="true">{st.steerSensitivity.toFixed(2)}</span>
            </span>
          </label>
          <p className="graphics-hint" id="steering-sensitivity-hint">{t.steeringSensitivityHint}</p>
          {toggle(t.autoRecenter, 'autoRecenter')}
        </section>
        <section className="options-section">
          <h3><ControlIcon name="garage" />{t.driver}</h3>
          <div className="seg character-options" role="group" aria-label={t.driver}>
            {CHARACTER_IDS.map((g) => (
              <button key={g} className={st.driver === g ? 'on' : ''} aria-pressed={st.driver === g} onClick={() => update({ driver: g })} data-testid={`driver-${g}`}>
                {g === 'male' ? t.driverMale : g === 'female' ? t.driverFemale : CHARACTER_NAMES[g]}
              </button>
            ))}
          </div>
          {character.state?.status === 'loading' && <p className="graphics-hint">{t.characterLoading}</p>}
          {character.state?.status === 'error' && <button className="link" onClick={() => { void loadCharacter(st.driver, true).catch(() => {}); }}>{t.retry}</button>}
          <label className="graphics-field"><span>{st.language === 'ru' ? 'Пассажиры' : 'Passenger characters'}</span>
            <select value={st.passengerCharacter} onChange={(e) => update({ passengerCharacter: e.target.value as typeof st.passengerCharacter })} data-testid="passenger-character">
              <option value="mixed">{st.language === 'ru' ? 'Разные пассажиры' : 'Mixed passengers'}</option>
              {PASSENGER_CHARACTER_IDS.map((id) => <option key={id} value={id}>{CHARACTER_NAMES[id]}</option>)}
              <option value="original">{st.language === 'ru' ? 'Оригинальные' : 'Original characters'}</option>
            </select>
          </label>
          {passengerModel.state?.status === 'loading' && <p className="graphics-hint">{t.characterLoading}</p>}
          {passengerModel.state?.status === 'error' && <button className="link" onClick={() => { if (isPassengerCharacter(st.passengerCharacter)) void loadCharacter(st.passengerCharacter, true).catch(() => {}); }}>{t.retry}</button>}
        </section>
        <section className="options-section">
          <h3><ControlIcon name="map" />{t.language}</h3>
          <div className="seg" role="group" aria-label={t.language}>
            <button className={st.language === 'en' ? 'on' : ''} aria-pressed={st.language === 'en'} onClick={() => update({ language: 'en' })}>
              English
            </button>
            <button className={st.language === 'ru' ? 'on' : ''} aria-pressed={st.language === 'ru'} onClick={() => update({ language: 'ru' })} data-testid="lang-ru">
              Русский
            </button>
          </div>
          <h3 className="options-subheading">{t.uiScale}</h3>
          <div className="seg" role="group" aria-label={t.uiScale}>
            {[1, 1.15, 1.3].map((v) => (
              <button key={v} className={st.uiScale === v ? 'on' : ''} aria-pressed={st.uiScale === v} onClick={() => update({ uiScale: v })}>
                {Math.round(v * 100)}%
              </button>
            ))}
          </div>
          {toggle(t.reducedMotion, 'reducedMotion')}
        </section>
        <section className="options-section save-section">
          <div className="save-summary">
            <h3><ControlIcon name="tasks" />{t.saveStatus}</h3>
            <p className={status === 'error' || status === 'unavailable' ? 'bad' : 'save-state'} data-testid="save-status" role="status">
              {statusText}
            </p>
          </div>
          {!confirmReset ? (
            <button className="btn danger-outline" onClick={() => setConfirmReset(true)}>
              {t.resetProgress}
            </button>
          ) : (
            <div className="confirm">
              <p>{t.resetConfirm}</p>
              <div className="row">
                <button className="btn ghost" onClick={() => setConfirmReset(false)}>
                  {t.no}
                </button>
                <button
                  className="btn danger"
                  onClick={() => {
                    persistence.clearAll();
                    window.location.reload();
                  }}
                >
                  {t.yes}
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </Modal>
  );
}
