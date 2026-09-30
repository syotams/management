import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AlertMode } from '../../utils/alert';

@Component({
  selector: 'app-alert-picker',
  standalone: true,
  imports: [FormsModule],
  template: `
    <label class="form-label d-block">Alert</label>
    <div class="form-check">
      <input type="radio" class="form-check-input" [id]="idPrefix() + '-same'" [name]="idPrefix() + '-mode'"
             value="same" [(ngModel)]="mode">
      <label class="form-check-label" [for]="idPrefix() + '-same'">Same time as due date</label>
    </div>
    <div class="form-check">
      <input type="radio" class="form-check-input" [id]="idPrefix() + '-none'" [name]="idPrefix() + '-mode'"
             value="none" [(ngModel)]="mode">
      <label class="form-check-label" [for]="idPrefix() + '-none'">No alert</label>
    </div>
    <div class="form-check">
      <input type="radio" class="form-check-input" [id]="idPrefix() + '-custom'" [name]="idPrefix() + '-mode'"
             value="custom" [(ngModel)]="mode">
      <label class="form-check-label" [for]="idPrefix() + '-custom'">Custom time</label>
    </div>
    @if (mode() === 'custom') {
      <input type="datetime-local" class="form-control mt-2" [attr.aria-label]="'Alert at'" [(ngModel)]="alertAt">
    }
  `,
})
export class AlertPickerComponent {
  /** Keeps radio ids/names unique when several pickers exist on a page. */
  idPrefix = input('alert');
  mode = model.required<AlertMode>();
  /** `datetime-local` value used only for the custom option. */
  alertAt = model.required<string>();
}
