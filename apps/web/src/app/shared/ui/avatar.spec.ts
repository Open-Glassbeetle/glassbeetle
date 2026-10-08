import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { Avatar } from './avatar';

@Component({
  imports: [Avatar],
  template: `<gb-avatar [name]="name()" [imageUrl]="imageUrl()" />`,
})
class Host {
  readonly name = signal('Ada Lovelace');
  readonly imageUrl = signal<string | null>(null);
}

function render(name?: string, imageUrl?: string | null) {
  // Reset explicitly: a couple of these tests render twice to compare two
  // instances, which a configured module would otherwise refuse.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [Host] });
  const fixture = TestBed.createComponent(Host);

  if (name !== undefined) {
    fixture.componentInstance.name.set(name);
  }
  if (imageUrl !== undefined) {
    fixture.componentInstance.imageUrl.set(imageUrl);
  }

  fixture.detectChanges();
  return fixture;
}

function text(fixture: { nativeElement: unknown }): string {
  return ((fixture.nativeElement as HTMLElement).textContent ?? '').trim();
}

describe('Avatar', () => {
  it('takes initials from the first and last word', () => {
    expect(text(render('Ada Lovelace'))).toBe('AL');
  });

  it('takes one initial from a single word', () => {
    expect(text(render('Ada'))).toBe('A');
  });

  it('ignores the words in between', () => {
    expect(text(render('Ada King Lovelace'))).toBe('AL');
  });

  it('falls back to a question mark for an empty name', () => {
    expect(text(render('   '))).toBe('?');
  });

  it('gives the same name the same colour every time', () => {
    const first = render('Ada Lovelace');
    const second = render('Ada Lovelace');

    const hueOf = (fixture: { nativeElement: unknown }) =>
      (fixture.nativeElement as HTMLElement)
        .querySelector<HTMLElement>('.avatar')
        ?.style.getPropertyValue('--avatar-hue');

    expect(hueOf(first)).toBe(hueOf(second));
    expect(hueOf(first)).not.toBe('');
  });

  it('draws the picture instead of the initials when there is one', () => {
    const fixture = render('Ada Lovelace', '/api/v1/user/picture?v=1');
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('img')?.getAttribute('src')).toBe('/api/v1/user/picture?v=1');
    expect(text(fixture)).toBe('');
  });

  it('falls back to initials when the picture cannot be loaded', () => {
    // The API legitimately answers 404 for a profile whose file did not
    // survive a restore, and a broken-image glyph is a worse answer.
    const fixture = render('Ada Lovelace', '/api/v1/user/picture?v=1');
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(element.querySelector('img')).toBeNull();
    expect(text(fixture)).toBe('AL');
  });

  it('tries again once a replacement picture arrives at a new URL', () => {
    const fixture = render('Ada Lovelace', '/api/v1/user/picture?v=1');
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector('img')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    fixture.componentInstance.imageUrl.set('/api/v1/user/picture?v=2');
    fixture.detectChanges();

    expect(element.querySelector('img')?.getAttribute('src')).toBe('/api/v1/user/picture?v=2');
  });
});
