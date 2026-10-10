import { Component, ElementRef, Input, ViewChild, forwardRef } from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';
import { AssignableMember } from '../../models';
import { AuthService } from '../../services/auth.service';

const MAX_SUGGESTIONS = 8;
const MENTION_QUERY = /(^|[^\w@])@([a-zA-Z0-9_-]*)$/;

interface ActiveMention {
  start: number;
  end: number;
  query: string;
}

@Component({
  selector: 'app-mention-textarea',
  standalone: true,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => MentionTextareaComponent), multi: true },
  ],
  styles: [`
    :host {
      display: block;
      position: relative;
    }
    .mention-suggestions {
      position: absolute;
      left: 0;
      top: 100%;
      z-index: 1060;
      min-width: 16rem;
      max-width: 100%;
      margin-top: 0.25rem;
      padding: 0.25rem 0;
      list-style: none;
      background: var(--app-surface);
      border: 1px solid var(--app-border);
      border-radius: 8px;
      box-shadow: var(--app-shadow-lg);
    }
    .mention-suggestions button {
      display: flex;
      width: 100%;
      gap: 0.5rem;
      align-items: baseline;
      padding: 0.35rem 0.75rem;
      border: 0;
      background: transparent;
      color: var(--app-text);
      text-align: left;
    }
    .mention-suggestions button.active,
    .mention-suggestions button:hover {
      background: color-mix(in srgb, var(--app-primary) 12%, transparent);
    }
  `],
  template: `
    <textarea
      #textarea
      class="form-control"
      [rows]="rows"
      [placeholder]="placeholder"
      [value]="value"
      [disabled]="disabled"
      [attr.aria-expanded]="suggestions.length > 0"
      aria-autocomplete="list"
      (input)="onInput()"
      (keydown)="onKeydown($event)"
      (click)="updateMention()"
      (blur)="onBlur()"
    ></textarea>
    @if (suggestions.length) {
      <ul class="mention-suggestions" role="listbox">
        @for (member of suggestions; track member.id; let i = $index) {
          <li role="option" [attr.aria-selected]="i === activeIndex">
            <button
              type="button"
              [class.active]="i === activeIndex"
              (mousedown)="$event.preventDefault(); select(member)"
            >
              <strong>&#64;{{ member.name }}</strong>
              <small class="text-muted text-truncate">{{ member.email }}</small>
            </button>
          </li>
        }
      </ul>
    }
  `,
})
export class MentionTextareaComponent implements ControlValueAccessor {
  @Input() rows = 3;
  @Input() placeholder = '';
  @Input() members: AssignableMember[] = [];
  @ViewChild('textarea', { static: true }) textarea!: ElementRef<HTMLTextAreaElement>;

  value = '';
  disabled = false;
  suggestions: AssignableMember[] = [];
  activeIndex = 0;
  private mention: ActiveMention | null = null;
  private onChange: (value: string) => void = () => {};
  private onTouched: () => void = () => {};

  constructor(private auth: AuthService) {}

  writeValue(value: string | null): void {
    this.value = value ?? '';
  }

  registerOnChange(fn: (value: string) => void): void {
    this.onChange = fn;
  }

  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  setDisabledState(disabled: boolean): void {
    this.disabled = disabled;
  }

  focus() {
    this.textarea.nativeElement.focus();
  }

  onInput() {
    this.value = this.textarea.nativeElement.value;
    this.onChange(this.value);
    this.updateMention();
  }

  onKeydown(event: KeyboardEvent) {
    if (!this.suggestions.length) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.activeIndex = (this.activeIndex + 1) % this.suggestions.length;
        break;
      case 'ArrowUp':
        event.preventDefault();
        this.activeIndex = (this.activeIndex - 1 + this.suggestions.length) % this.suggestions.length;
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        this.select(this.suggestions[this.activeIndex]);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.close();
        break;
    }
  }

  onBlur() {
    this.close();
    this.onTouched();
  }

  updateMention() {
    const el = this.textarea.nativeElement;
    const caret = el.selectionStart ?? el.value.length;
    if (caret !== el.selectionEnd) return this.close();

    const match = MENTION_QUERY.exec(el.value.slice(0, caret));
    if (!match) return this.close();

    const query = match[2];
    this.mention = { start: caret - query.length - 1, end: caret, query };
    this.suggestions = this.filterMembers(query);
    this.activeIndex = 0;
  }

  select(member: AssignableMember) {
    if (!this.mention) return;
    const el = this.textarea.nativeElement;
    const insert = `@${member.name} `;
    const next = el.value.slice(0, this.mention.start) + insert + el.value.slice(this.mention.end);
    const caret = this.mention.start + insert.length;
    this.value = next;
    el.value = next;
    el.setSelectionRange(caret, caret);
    this.onChange(next);
    this.close();
  }

  private filterMembers(query: string): AssignableMember[] {
    const selfId = this.auth.currentUser()?.id;
    const q = query.toLowerCase();
    const candidates = this.members.filter((m) => m.id !== selfId);
    const prefix = candidates.filter((m) => m.name.toLowerCase().startsWith(q));
    const contains = candidates.filter(
      (m) => !m.name.toLowerCase().startsWith(q) && m.name.toLowerCase().includes(q),
    );
    return [...prefix, ...contains].slice(0, MAX_SUGGESTIONS);
  }

  private close() {
    this.mention = null;
    this.suggestions = [];
    this.activeIndex = 0;
  }
}
