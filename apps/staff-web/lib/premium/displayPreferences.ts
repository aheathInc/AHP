export type ThemePreference = "light" | "dark" | "system";
export type MotionPreference = "system" | "reduce";
export type VisionPreference =
  "standard" | "red-green" | "blue-yellow" | "high-contrast";
export type DensityPreference = "comfortable" | "compact";
export const displayStorage = {
  theme: "ahp.staff.theme",
  density: "ahp.staff.density",
  motion: "ahp.staff.motion",
  vision: "ahp.staff.vision",
  solid: "ahp.staff.solid",
} as const;
/** Apply saved accessibility settings before first paint; no clinical state is stored. */
export const displayBootstrap = `(function(){var r=document.documentElement;function read(k){try{return localStorage.getItem('ahp.staff.'+k)}catch(e){return null}}var t=read('theme'),v=read('vision');r.dataset.theme=t==='dark'||t==='light'?t:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');r.dataset.density=read('density')==='compact'?'compact':'comfortable';r.dataset.motion=read('motion')==='reduce'||matchMedia('(prefers-reduced-motion: reduce)').matches?'reduce':'full';r.dataset.vision=['red-green','blue-yellow','high-contrast'].indexOf(v)>=0?v:'standard';r.dataset.surfaces=read('solid')==='true'||v==='high-contrast'||matchMedia('(prefers-reduced-transparency: reduce)').matches?'solid':'glass';})();`;
