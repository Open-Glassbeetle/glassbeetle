import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Composer } from './composer';

@Component({
  imports: [Composer],
  template: `
    <gb-composer
      [(text)]="text"
      [busy]="busy()"
      [blocked]="blocked()"
      (submitted)="sent.push($event)"
      (stopped)="stops = stops + 1"
    />
  `,
})
class Host {
  readonly text = signal('');
  readonly busy = signal(false);
  readonly blocked = signal(false);
  readonly sent: string[] = [];
  stops = 0;
}

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [Host] });

  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();

  const element = fixture.nativeElement as HTMLElement;
  const field = element.querySelector('textarea')!;

  return {
    fixture,
    host: fixture.componentInstance,
    element,
    field,
    type(value: string) {
      field.value = value;
      field.dispatchEvent(new Event('input'));
    },
    press(init: KeyboardEventInit) {
      const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
      field.dispatchEvent(event);
      fixture.detectChanges();
      return event;
    },
  };
}

describe('Composer', () => {
  it('sends the trimmed turn on Enter and empties the field', () => {
    const { host, field, type, press } = setup();

    type('  Find the source.  ');
    const event = press({ key: 'Enter' });

    expect(host.sent).toEqual(['Find the source.']);
    expect(event.defaultPrevented).toBe(true);
    expect(host.text()).toBe('');
    expect(field.value).toBe('');
  });

  it('empties the field even when typing and Enter land in the same render', () => {
    const { host, field, type } = setup();

    // No change detection between the two: a `[value]` binding would see the
    // text go from empty to empty and leave the sent turn in the field.
    type('Quick.');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    TestBed.tick();

    expect(host.sent).toEqual(['Quick.']);
    expect(field.value).toBe('');
  });

  it('leaves Shift+Enter to break the line', () => {
    const { host, type, press } = setup();

    type('First line');
    const event = press({ key: 'Enter', shiftKey: true });

    expect(host.sent).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not send while an input method is still composing', () => {
    const { host, type, press } = setup();

    type('にほ');
    press({ key: 'Enter', isComposing: true });

    expect(host.sent).toEqual([]);
  });

  it('sends nothing when there is only whitespace', () => {
    const { host, element, type, press, fixture } = setup();

    type('   ');
    fixture.detectChanges();
    press({ key: 'Enter' });

    expect(host.sent).toEqual([]);
    expect(element.querySelector<HTMLButtonElement>('.composer__send')?.disabled).toBe(true);
  });

  it('keeps what is typed, unsent, while sending is blocked', () => {
    const { host, field, type, press, fixture } = setup();

    host.blocked.set(true);
    fixture.detectChanges();
    type('Typed ahead');
    press({ key: 'Enter' });

    expect(host.sent).toEqual([]);
    expect(field.value).toBe('Typed ahead');
  });

  it('offers stop in place of send while a run is in flight', () => {
    const { host, element, fixture } = setup();

    host.busy.set(true);
    fixture.detectChanges();

    const stop = element.querySelector<HTMLButtonElement>('.composer__send--stop');
    expect(stop?.getAttribute('aria-label')).toBe('Stop');

    stop?.click();
    expect(host.stops).toBe(1);
  });

  it('shows a turn the owner put back', () => {
    const { host, field, fixture } = setup();

    host.text.set('Restored after a failed send');
    fixture.detectChanges();

    expect(field.value).toBe('Restored after a failed send');
  });
});
