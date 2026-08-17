import { Component } from '@angular/core';
import { Theme, ThemeService, THEME_OPTIONS } from '../../services/theme.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  template: `
    <div class="py-2">
      <h2 class="page-title mb-4">Settings</h2>

      <div class="card">
        <div class="card-header">Appearance</div>
        <div class="card-body">
          <p class="text-muted mb-4">
            Choose how Task Manager looks on this device. Material themes follow the
            <a href="https://m2.material.io/design/color/the-color-system.html" target="_blank" rel="noopener">
              MD2 color system
            </a>
            with 200-tonal primaries on #121212 surfaces.
          </p>

          <div class="theme-options">
            @for (option of themeOptions; track option.id) {
              <label class="theme-option" [class.selected]="theme.current() === option.id">
                <input
                  type="radio"
                  name="theme"
                  class="form-check-input"
                  [value]="option.id"
                  [checked]="theme.current() === option.id"
                  (change)="selectTheme(option.id)"
                />
                <span class="theme-option-content">
                  <span class="theme-option-header">
                    <span class="theme-option-name">{{ option.name }}</span>
                    <span class="theme-swatches" aria-hidden="true">
                      @for (swatch of option.swatches; track swatch) {
                        <span class="theme-swatch" [style.background]="swatch"></span>
                      }
                    </span>
                  </span>
                  <span class="theme-option-description">{{ option.description }}</span>
                </span>
              </label>
            }
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .theme-options {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }

    .theme-option {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 1rem;
      border: 1.5px solid var(--app-border-subtle);
      border-radius: 10px;
      cursor: pointer;
      transition: border-color 0.15s ease, background-color 0.15s ease;

      &:hover {
        background: var(--app-surface-hover);
        border-color: var(--app-border);
      }

      &.selected {
        border-color: var(--app-primary);
        background: rgba(var(--app-primary-rgb), 0.06);
      }

      .form-check-input {
        margin-top: 0.2rem;
        flex-shrink: 0;
      }
    }

    .theme-option-content {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      min-width: 0;
    }

    .theme-option-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }

    .theme-option-name {
      font-weight: 600;
      color: var(--app-text);
    }

    .theme-option-description {
      font-size: 0.875rem;
      color: var(--app-text-muted);
    }

    .theme-swatches {
      display: flex;
      gap: 0.35rem;
      flex-shrink: 0;
    }

    .theme-swatch {
      width: 1.1rem;
      height: 1.1rem;
      border-radius: 50%;
      border: 1px solid rgba(0, 0, 0, 0.12);
    }
  `,
})
export class SettingsComponent {
  readonly themeOptions = THEME_OPTIONS;

  constructor(public theme: ThemeService) {}

  selectTheme(theme: Theme) {
    this.theme.set(theme);
  }
}
