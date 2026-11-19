"use client";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type KeyboardEvent,
} from "react";
import { Icon } from "./Icon";
import {
  displayStorage,
  type ThemePreference,
  type MotionPreference,
  type VisionPreference,
  type DensityPreference,
} from "@/lib/premium/displayPreferences";
interface Preferences {
  theme: ThemePreference;
  density: DensityPreference;
  motion: MotionPreference;
  vision: VisionPreference;
  solid: boolean;
  reducedMotion: boolean;
  storageAvailable: boolean;
  setTheme: (value: ThemePreference) => void;
  setDensity: (value: DensityPreference) => void;
  setMotion: (value: MotionPreference) => void;
  setVision: (value: VisionPreference) => void;
  setSolid: (value: boolean) => void;
}
const Context = createContext<Preferences>({
  theme: "system",
  density: "comfortable",
  motion: "system",
  vision: "standard",
  solid: false,
  reducedMotion: false,
  storageAvailable: true,
  setTheme: () => {},
  setDensity: () => {},
  setMotion: () => {},
  setVision: () => {},
  setSolid: () => {},
});
export const useDisplayPreferences = () => useContext(Context);
export function DisplayProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>("system"),
    [density, setDensity] = useState<DensityPreference>("comfortable");
  const [motion, setMotion] = useState<MotionPreference>("system"),
    [vision, setVision] = useState<VisionPreference>("standard"),
    [solid, setSolid] = useState(false);
  const [ready, setReady] = useState(false),
    [systemReduced, setSystemReduced] = useState(false),
    [storageAvailable, setStorageAvailable] = useState(true);
  useEffect(() => {
    try {
      const get = (key: keyof typeof displayStorage) =>
        localStorage.getItem(displayStorage[key]);
      const t = get("theme"),
        v = get("vision");
      if (t === "dark" || t === "light" || t === "system") setTheme(t);
      if (get("density") === "compact") setDensity("compact");
      if (get("motion") === "reduce") setMotion("reduce");
      if (v === "red-green" || v === "blue-yellow" || v === "high-contrast")
        setVision(v);
      setSolid(get("solid") === "true");
    } catch {
      setStorageAvailable(false);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    const dark = matchMedia("(prefers-color-scheme: dark)"),
      reduce = matchMedia("(prefers-reduced-motion: reduce)"),
      transparency = matchMedia("(prefers-reduced-transparency: reduce)");
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme =
        theme === "system" ? (dark.matches ? "dark" : "light") : theme;
      root.dataset.density = density;
      root.dataset.motion =
        motion === "reduce" || reduce.matches ? "reduce" : "full";
      root.dataset.vision = vision;
      root.dataset.surfaces =
        solid || vision === "high-contrast" || transparency.matches
          ? "solid"
          : "glass";
      setSystemReduced(reduce.matches);
    };
    apply();
    for (const media of [dark, reduce, transparency])
      media.addEventListener("change", apply);
    try {
      for (const [key, value] of Object.entries({
        theme,
        density,
        motion,
        vision,
        solid: String(solid),
      }))
        localStorage.setItem(
          displayStorage[key as keyof typeof displayStorage],
          value,
        );
      setStorageAvailable(true);
    } catch {
      setStorageAvailable(false);
    }
    return () => {
      for (const media of [dark, reduce, transparency])
        media.removeEventListener("change", apply);
    };
  }, [theme, density, motion, vision, solid, ready]);
  return (
    <Context.Provider
      value={{
        theme,
        density,
        motion,
        vision,
        solid,
        reducedMotion: motion === "reduce" || systemReduced,
        storageAvailable,
        setTheme,
        setDensity,
        setMotion,
        setVision,
        setSolid,
      }}
    >
      {children}
    </Context.Provider>
  );
}
function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== "Tab") return;
  const elements = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      "button,select,input,a[href]",
    ),
  ).filter(
    (element) =>
      !element.hasAttribute("disabled") && element.getClientRects().length,
  );
  const first = elements[0],
    last = elements[elements.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
export function DisplayPreferences() {
  const preferences = useDisplayPreferences();
  const { theme, density, setTheme, setDensity } = preferences;
  const dialog = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    id = useId();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const close = () => {
    dialog.current?.close();
    trigger.current?.focus();
  };
  return (
    <div className="ahp-preferences">
      <label className="ahp-pref-control">
        <Icon
          name={
            theme === "dark" ? "moon" : theme === "light" ? "sun" : "monitor"
          }
          size={16}
        />
        <span className="sr-only">Color theme</span>
        <select
          aria-label="Color theme"
          value={theme}
          onChange={(event) => setTheme(event.target.value as ThemePreference)}
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <button
        type="button"
        className="ahp-icon-button ahp-density-button"
        aria-label={
          density === "compact"
            ? "Use comfortable density"
            : "Use compact density"
        }
        aria-pressed={density === "compact"}
        title={
          density === "compact" ? "Comfortable density" : "Compact density"
        }
        onClick={() =>
          setDensity(density === "compact" ? "comfortable" : "compact")
        }
      >
        <Icon name="rows" size={18} />
      </button>
      <button
        type="button"
        ref={trigger}
        className="ahp-icon-button ahp-accessibility-trigger"
        aria-label="Display & accessibility"
        title="Display & accessibility"
        aria-haspopup="dialog"
        aria-controls={id}
        disabled={!hydrated}
        onClick={() => {
          dialog.current?.showModal();
          dialog.current?.querySelector<HTMLSelectElement>("select")?.focus();
        }}
      >
        <Icon name="settings" size={19} />
      </button>
      <dialog
        id={id}
        ref={dialog}
        className="ahp-display-dialog"
        aria-labelledby={id + "-title"}
        aria-describedby={id + "-description"}
        onKeyDown={trapFocus}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => trigger.current?.focus()}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            )
              close();
          }
        }}
      >
        <header>
          <div>
            <h2 id={id + "-title"}>Display & accessibility</h2>
            <p id={id + "-description"}>
              Make this workspace comfortable for you. Changes apply immediately
              on this browser.
            </p>
          </div>
          <button
            type="button"
            className="ahp-icon-button"
            onClick={close}
            aria-label="Close display settings"
          >
            <Icon name="close" size={20} />
          </button>
        </header>
        <div className="ahp-display-fields">
          <label htmlFor={id + "-appearance"}>Appearance</label>
          <select
            id={id + "-appearance"}
            value={theme}
            onChange={(event) =>
              setTheme(event.target.value as ThemePreference)
            }
          >
            <option value="system">Follow device setting</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
          <label htmlFor={id + "-density"}>Workspace density</label>
          <select
            id={id + "-density"}
            value={density}
            onChange={(event) =>
              setDensity(event.target.value as DensityPreference)
            }
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </select>
          <label htmlFor={id + "-motion"}>Animation preference</label>
          <select
            id={id + "-motion"}
            value={preferences.motion}
            onChange={(event) =>
              preferences.setMotion(event.target.value as MotionPreference)
            }
            aria-describedby={id + "-motion-help"}
          >
            <option value="system">Follow device setting</option>
            <option value="reduce">Reduce motion</option>
          </select>
          <p id={id + "-motion-help"}>
            Device reduced-motion settings always take priority. Loading and
            status messages stay visible.
          </p>
          <label htmlFor={id + "-vision"}>Colour accessibility</label>
          <select
            id={id + "-vision"}
            value={preferences.vision}
            onChange={(event) =>
              preferences.setVision(event.target.value as VisionPreference)
            }
            aria-describedby={id + "-vision-help"}
          >
            <option value="standard">Human Care standard</option>
            <option value="red-green">Red–green friendly</option>
            <option value="blue-yellow">Blue–yellow friendly</option>
            <option value="high-contrast">High contrast</option>
          </select>
          <p id={id + "-vision-help"}>
            Adjust interface status colours. Labels and icons retain their
            meaning; images and clinical documents are unchanged.
          </p>
          <label className="ahp-display-check">
            <input
              type="checkbox"
              checked={preferences.solid}
              onChange={(event) => preferences.setSolid(event.target.checked)}
            />
            <span>
              Use solid surfaces
              <span>
                Reduce transparency and background blur. High contrast and
                device transparency settings also use solid surfaces.
              </span>
            </span>
          </label>
        </div>
        <footer>
          <p role="status">
            {preferences.storageAvailable
              ? "Preferences saved on this browser."
              : "Preferences apply now, but browser storage is unavailable; changes may reset after closing this page."}
          </p>
          <button
            type="button"
            className="ahp-button ahp-button--primary"
            onClick={close}
          >
            Done
          </button>
        </footer>
      </dialog>
    </div>
  );
}
