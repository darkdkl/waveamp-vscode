import { applyEq } from "./audioGraph";
import { persist } from "./bridge";
import { $, eqPanel, eqPresetSelect, eqResetBtn, eqToggle, eqToggleBtn, setPanelOpen, t } from "./dom";
import { BANDS, PRESETS, RANGE_DB, clampDb, findPreset, formatBand, formatDb, presetPreampDb } from "./eqPresets";
import { eq } from "./state";

function bandControl(label: string, onChange: (db: number) => void): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "eq__band";
  const value = document.createElement("span");
  value.className = "eq__value";
  value.textContent = formatDb(0);
  const sliderWrap = document.createElement("div");
  sliderWrap.className = "eq__slider-wrap";
  const slider = document.createElement("input");
  slider.type = "range";
  slider.className = "eq__slider";
  slider.min = String(-RANGE_DB);
  slider.max = String(RANGE_DB);
  slider.step = "1";
  slider.value = "0";
  slider.title = label;
  slider.addEventListener("input", () => {
    const db = Number(slider.value);
    value.textContent = formatDb(db);
    onChange(db);
  });
  sliderWrap.appendChild(slider);
  const labelEl = document.createElement("span");
  labelEl.className = "eq__label";
  labelEl.textContent = label;
  wrap.append(value, sliderWrap, labelEl);
  return wrap;
}

function buildEq(): void {
  $("eqPreamp").appendChild(
    bandControl("PRE", (db) => {
      eq.preampDb = db;
      markEqCustom();
    })
  );
  BANDS.forEach((freq, i) => {
    $("eqBands").appendChild(
      bandControl(formatBand(freq), (db) => {
        eq.bandGains[i] = db;
        markEqCustom();
      })
    );
  });
  const options = [{ id: "custom", nameKey: "eqPresetCustom" }, ...PRESETS].map(({ id, nameKey }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = t[nameKey as keyof typeof t];
    return option;
  });
  eqPresetSelect.append(...options);
}

function syncEqControls(): void {
  const sliders = eqPanel.querySelectorAll<HTMLInputElement>(".eq__slider");
  const values = eqPanel.querySelectorAll(".eq__value");
  [eq.preampDb, ...eq.bandGains].forEach((db, i) => {
    sliders[i].value = String(db);
    values[i].textContent = formatDb(db);
  });
  eqPresetSelect.value = eq.preset;
  eqToggleBtn.classList.toggle("is-active", eq.enabled);
  eqToggleBtn.setAttribute("aria-checked", String(eq.enabled));
  eqPanel.classList.toggle("is-off", !eq.enabled);
  sliders.forEach((slider) => (slider.disabled = !eq.enabled));
  eqPresetSelect.disabled = !eq.enabled;
  eqResetBtn.disabled = !eq.enabled;
}

function markEqCustom(): void {
  eq.preset = "custom";
  eq.custom = { bandGains: [...eq.bandGains], preampDb: eq.preampDb };
  eqPresetSelect.value = "custom";
  applyEq();
  persist();
}

function selectEqPreset(id: string): void {
  const preset = findPreset(id);
  eq.bandGains = [...(preset ? preset.bands : eq.custom.bandGains)];
  eq.preampDb = preset ? presetPreampDb(preset.bands) : eq.custom.preampDb;
  eq.preset = preset ? preset.id : "custom";
  syncEqControls();
  applyEq();
  persist();
}

export function restoreEq(saved: unknown): void {
  if (!saved || typeof saved !== "object") return;
  const s = saved as Record<string, unknown> & { custom?: Record<string, unknown> };
  const gains = (list: unknown) => BANDS.map((_, i) => clampDb(Array.isArray(list) ? list[i] : 0));
  eq.enabled = s.enabled !== false;
  eq.bandGains = gains(s.bandGains);
  eq.preampDb = clampDb(s.preampDb);
  eq.custom = s.custom
    ? { bandGains: gains(s.custom.bandGains), preampDb: clampDb(s.custom.preampDb) }
    : { bandGains: [...eq.bandGains], preampDb: eq.preampDb };
  eq.preset = s.preset === "custom" || (typeof s.preset === "string" && findPreset(s.preset)) ? (s.preset as string) : "custom";
  syncEqControls();
  applyEq();
}

export function initEqPanel(): void {
  buildEq();
  syncEqControls();
  eqToggle.addEventListener("click", () => {
    setPanelOpen(eqPanel, eqToggle, eqPanel.hidden);
    persist();
  });
  eqPresetSelect.addEventListener("change", () => selectEqPreset(eqPresetSelect.value));
  eqToggleBtn.addEventListener("click", () => {
    eq.enabled = !eq.enabled;
    syncEqControls();
    applyEq();
    persist();
  });
  eqResetBtn.addEventListener("click", () => selectEqPreset("flat"));
}
