import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly storageKey = 'theme';
  current = signal<Theme>(this.load());

  constructor() {
    this.apply(this.current());
  }

  toggle() {
    this.set(this.current() === 'light' ? 'dark' : 'light');
  }

  set(theme: Theme) {
    this.current.set(theme);
    this.apply(theme);
    localStorage.setItem(this.storageKey, theme);
  }

  private load(): Theme {
    const stored = localStorage.getItem(this.storageKey);
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  private apply(theme: Theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
  }
}
