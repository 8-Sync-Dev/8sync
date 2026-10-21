import { useSyncExternalStore } from "react";

/** Below Tailwind `sm`: a phone. The header row is full, the Máy chip moves to the tab row, the composers fold into a floating button. */
const NARROW_QUERY = "(max-width: 639px)";
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(NARROW_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};
const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;

export function useNarrow() {
  return useSyncExternalStore(subscribe, isNarrow, () => false);
}
