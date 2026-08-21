import { Component } from '@angular/core';
import {
  COLORFFY_SEED_KEYS,
  COLORFFY_SEED_LABELS,
  ColorffyPreset,
  ColorffySeedKey,
} from '../../services/colorffy-palette';
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
            with 200-tonal primaries on #121212 surfaces. Colorffy uses the
            <a href="https://colorffy.com/dark-theme-generator" target="_blank" rel="noopener">
              Colorffy dark theme generator
            </a>
            palettes and applies them to buttons, statuses, and urgent cards.
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
                      @for (swatch of swatchesFor(option); track swatch) {
                        <span class="theme-swatch" [style.background]="swatch"></span>
                      }
                    </span>
                  </span>
                  <span class="theme-option-description">{{ option.description }}</span>
                </span>
              </label>
            }
          </div>

          @if (theme.isColorffy()) {
            <div class="colorffy-controls">
              <div class="colorffy-controls-header">
                <h3 class="colorffy-title">Colorffy palettes</h3>
                <button type="button" class="btn btn-outline-secondary btn-sm" (click)="theme.resetColorffyPalette()">
                  Reset to Teal
                </button>
              </div>
              <p class="text-muted mb-3">
                Pick a Colorffy preset or edit the seed colors. Changes apply immediately to
                surfaces, statuses, priorities, and urgent task groups.
              </p>

              <div class="preset-grid">
                @for (preset of theme.colorffyPresets; track preset.id) {
                  <button
                    type="button"
                    class="preset-card"
                    [class.selected]="theme.colorffyPreset()?.id === preset.id"
                    [title]="'Apply ' + preset.name"
                    (click)="selectPreset(preset)"
                  >
                    <span class="preset-preview" [style.background]="preset.surface">
                      <span [style.background]="preset.primary"></span>
                      <span [style.background]="preset.success"></span>
                      <span [style.background]="preset.warning"></span>
                      <span [style.background]="preset.danger"></span>
                    </span>
                    <span class="preset-name">{{ preset.name }}</span>
                  </button>
                }
              </div>

              @if (!theme.colorffyPreset()) {
                <p class="custom-palette-note">Custom palette — colors no longer match a named preset.</p>
              }

              <div class="color-fields">
                @for (key of seedKeys; track key) {
                  <label class="color-field">
                    <span class="color-field-label">{{ seedLabels[key] }}</span>
                    <span class="color-field-controls">
                      <input
                        type="color"
                        class="color-picker"
                        [value]="theme.colorffyPalette()[key]"
                        (input)="onColorInput(key, $event)"
                      />
                      <input
                        type="text"
                        class="form-control form-control-sm color-hex"
                        [value]="theme.colorffyPalette()[key]"
                        (change)="onHexChange(key, $event)"
                        maxlength="7"
                        spellcheck="false"
                      />
                    </span>
                  </label>
                }
              </div>
            </div>
          }
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

    .colorffy-controls {
      margin-top: 1.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--app-border-subtle);
    }

    .colorffy-controls-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 0.5rem;
    }

    .colorffy-title {
      font-size: 1rem;
      font-weight: 600;
      margin: 0;
      color: var(--app-text);
    }

    .preset-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(7.5rem, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }

    .preset-card {
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
      padding: 0.45rem;
      border: 1.5px solid var(--app-border-subtle);
      border-radius: 10px;
      background: var(--app-surface);
      color: var(--app-text);
      cursor: pointer;
      text-align: left;

      &:hover {
        border-color: var(--app-border);
        background: var(--app-surface-hover);
      }

      &.selected {
        border-color: var(--app-primary);
        box-shadow: 0 0 0 1px var(--app-primary);
      }
    }

    .preset-preview {
      display: flex;
      gap: 0.2rem;
      padding: 0.35rem;
      border-radius: 6px;
      min-height: 2.1rem;

      span {
        flex: 1;
        border-radius: 3px;
      }
    }

    .preset-name {
      font-size: 0.8rem;
      font-weight: 600;
    }

    .custom-palette-note {
      font-size: 0.85rem;
      color: var(--app-text-muted);
      margin-bottom: 1rem;
    }

    .color-fields {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
      gap: 0.85rem;
    }

    .color-field {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }

    .color-field-label {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--app-text);
    }

    .color-field-controls {
      display: flex;
      align-items: center;
      gap: 0.45rem;
    }

    .color-picker {
      width: 2.25rem;
      height: 2.25rem;
      padding: 0;
      border: 1px solid var(--app-border);
      border-radius: 8px;
      background: transparent;
      cursor: pointer;
    }

    .color-hex {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      text-transform: lowercase;
    }
  `,
})
export class SettingsComponent {
  readonly themeOptions = THEME_OPTIONS;
  readonly seedKeys = COLORFFY_SEED_KEYS;
  readonly seedLabels = COLORFFY_SEED_LABELS;

  constructor(public theme: ThemeService) {}

  swatchesFor(option: (typeof THEME_OPTIONS)[number]): [string, string, string] {
    if (option.id !== 'dark-colorffy') return option.swatches;
    const palette = this.theme.colorffyPalette();
    return [palette.surface, palette.primary, palette.danger];
  }

  selectTheme(theme: Theme) {
    this.theme.set(theme);
  }

  selectPreset(preset: ColorffyPreset) {
    this.theme.setColorffyPreset(preset);
  }

  onColorInput(key: ColorffySeedKey, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.theme.setColorffyColor(key, value);
  }

  onHexChange(key: ColorffySeedKey, event: Event) {
    const input = event.target as HTMLInputElement;
    this.theme.setColorffyColor(key, input.value);
    input.value = this.theme.colorffyPalette()[key];
  }
}
