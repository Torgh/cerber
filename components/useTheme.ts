"use client";
import { useCallback, useEffect, useState } from "react";

export type Theme = "system" | "light" | "dark";

const KEY = "cerber-theme";

function apply(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
}

/** System / light / dark, remembered in this browser (layout.tsx applies it before the first paint). */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    let saved: Theme = "system";
    try {
      const v = localStorage.getItem(KEY);
      if (v === "light" || v === "dark") saved = v;
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after hydration
    setTheme(saved);
  }, []);
  const cycle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === "system" ? "light" : t === "light" ? "dark" : "system";
      apply(next);
      try {
        if (next === "system") localStorage.removeItem(KEY);
        else localStorage.setItem(KEY, next);
      } catch {}
      return next;
    });
  }, []);
  return [theme, cycle];
}
