import { create } from 'zustand';
import { getNightPref, setNightPref } from '../persistence/prefs';

// Day/night view choice — a UI preference (localStorage, §3), not document
// state. The DOM side effect (CSS variables + the `.dark` class) is applied
// by main.tsx via theme.applyTheme, keeping this store free of UI imports.

export interface ThemeState {
  night: boolean;
  setNight(night: boolean): void;
  toggleNight(): void;
}

export const useThemeStore = create<ThemeState>()((set, get) => ({
  night: getNightPref(),
  setNight(night) {
    setNightPref(night);
    set({ night });
  },
  toggleNight() {
    get().setNight(!get().night);
  },
}));
