import { useState } from 'react';
import { useGame } from '../app/store';
import { CHARACTER_NAMES, loadCharacter, useCharacter } from '../game/render/importedCharacters';
import { persistence } from '../storage/persistence';
import { Modal } from './Screens';
import { defaultQuality, type RenderResolution, type ShadowMode, type ViewDistance } from '../game/render/quality';

function GraphicsSettings() {
  const t = useGame((s) => s.t);
  const settings = useGame((s) => s.save.settings);
  const update = useGame((s) => s.updateSettings);
  const description = settings.quality === 'low' ? t.graphicsLow : settings.quality === 'medium' ? t.graphicsMedium : settings.quality === 'high' ? t.graphicsHigh : t.graphicsUltra;
  return (
    <section className="graphics-settings" data-testid="graphics-settings">
      <h3>{t.graphics}</h3>
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
  const passengerModel = useCharacter(st.passengerCharacter === 'lynae' || st.passengerCharacter === 'cartethyia' ? st.passengerCharacter : null);
  const status = useGame((s) => s.saveStatus);
  const update = useGame((s) => s.updateSettings);
  const close = useGame((s) => s.closeOverlay);
  const [confirmReset, setConfirmReset] = useState(false);
  const slider = (label: string, key: 'masterVolume' | 'sfxVolume' | 'ambienceVolume' | 'musicVolume') => (
    <label className="set-row">
      <span>{label}</span>
      <input type="range" min={0} max={1} step={0.05} value={st[key]} onChange={(e) => update({ [key]: Number(e.target.value) })} aria-label={label} />
    </label>
  );
  const toggle = (label: string, key: 'muted' | 'autoRecenter' | 'reducedMotion') => (
    <label className="set-row">
      <span>{label}</span>
      <input type="checkbox" checked={st[key]} onChange={(e) => update({ [key]: e.target.checked })} aria-label={label} data-testid={`set-${key}`} />
    </label>
  );
  const statusText = status === 'unavailable' ? t.saveUnavailable : status === 'error' ? t.saveError : status === 'saving' ? t.saving : t.saved;
  return (
    <Modal label={t.settings} onClose={close} className="settings" testId="settings">
      <div className="modal-head">
        <h2>⚙️ {t.settings}</h2>
        <button className="icon-btn" onClick={close} aria-label={t.close}>
          ✕
        </button>
      </div>
      <div className="settings-body">
        <GraphicsSettings />
        <section>
          <h3>{t.audio}</h3>
          {slider(t.master, 'masterVolume')}
          {slider(t.effects, 'sfxVolume')}
          {slider(t.ambience, 'ambienceVolume')}
          {slider(t.music, 'musicVolume')}
          {toggle(t.mute, 'muted')}
        </section>
        <section>
          <h3>{t.controlPreset}</h3>
          <div className="seg">
            <button className={st.controls === 'joystick' ? 'on' : ''} onClick={() => update({ controls: 'joystick' })} data-testid="preset-joystick">
              {t.presetJoystick}
            </button>
            <button className={st.controls === 'pedals' ? 'on' : ''} onClick={() => update({ controls: 'pedals' })} data-testid="preset-pedals">
              {t.presetPedals}
            </button>
          </div>
          <label className="set-row">
            <span>{t.sensitivity}</span>
            <input type="range" min={0.5} max={1.6} step={0.05} value={st.steerSensitivity} onChange={(e) => update({ steerSensitivity: Number(e.target.value) })} aria-label={t.sensitivity} />
          </label>
          {toggle(t.autoRecenter, 'autoRecenter')}
        </section>
        <section>
          <h3>{t.driver}</h3>
          <div className="seg character-options">
            {(['male', 'female', 'lynae', 'cartethyia'] as const).map((g) => (
              <button key={g} className={st.driver === g ? 'on' : ''} onClick={() => update({ driver: g })} data-testid={`driver-${g}`}>
                {g === 'male' ? t.driverMale : g === 'female' ? t.driverFemale : CHARACTER_NAMES[g]}
              </button>
            ))}
          </div>
          {character.state?.status === 'loading' && <p className="graphics-hint">{t.characterLoading}</p>}
          {character.state?.status === 'error' && <button className="link" onClick={() => { void loadCharacter(st.driver, true).catch(() => {}); }}>{t.retry}</button>}
          <label className="graphics-field"><span>{st.language === 'ru' ? 'Пассажиры' : 'Passenger characters'}</span>
            <select value={st.passengerCharacter} onChange={(e) => update({ passengerCharacter: e.target.value as typeof st.passengerCharacter })} data-testid="passenger-character">
              <option value="mixed">Lynae / Cartethyia</option><option value="lynae">Lynae</option><option value="cartethyia">Cartethyia</option><option value="original">{st.language === 'ru' ? 'Оригинальные' : 'Original characters'}</option>
            </select>
          </label>
          {passengerModel.state?.status === 'loading' && <p className="graphics-hint">{t.characterLoading}</p>}
          {passengerModel.state?.status === 'error' && <button className="link" onClick={() => { if (st.passengerCharacter === 'lynae' || st.passengerCharacter === 'cartethyia') void loadCharacter(st.passengerCharacter, true).catch(() => {}); }}>{t.retry}</button>}
          <h3>{t.language}</h3>
          <div className="seg">
            <button className={st.language === 'en' ? 'on' : ''} onClick={() => update({ language: 'en' })}>
              English
            </button>
            <button className={st.language === 'ru' ? 'on' : ''} onClick={() => update({ language: 'ru' })} data-testid="lang-ru">
              Русский
            </button>
          </div>
          <h3>{t.uiScale}</h3>
          <div className="seg">
            {[1, 1.15, 1.3].map((v) => (
              <button key={v} className={st.uiScale === v ? 'on' : ''} onClick={() => update({ uiScale: v })}>
                {Math.round(v * 100)}%
              </button>
            ))}
          </div>
          {toggle(t.reducedMotion, 'reducedMotion')}
        </section>
        <section>
          <h3>{t.saveStatus}</h3>
          <p className={status === 'error' || status === 'unavailable' ? 'bad' : 'muted'} data-testid="save-status">
            {statusText}
          </p>
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
