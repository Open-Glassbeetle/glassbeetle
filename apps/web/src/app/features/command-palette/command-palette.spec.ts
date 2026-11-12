import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialogRef } from '@angular/material/dialog';
import { provideRouter, Router } from '@angular/router';
import { Subject } from 'rxjs';
import { vi } from 'vitest';

import { CommandPalette } from './command-palette';

describe('Command palette active result', () => {
  let fixture: ComponentFixture<CommandPalette>;
  let http: HttpTestingController;
  let root: HTMLElement;
  let input: HTMLInputElement;
  let closing: Subject<void>;
  let close: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let scroll: ReturnType<typeof vi.fn>;
  let originalScroll: PropertyDescriptor | undefined;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    scroll = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scroll,
    });
    closing = new Subject<void>();
    close = vi.fn(() => closing.next());

    await TestBed.configureTestingModule({
      imports: [CommandPalette],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: MatDialogRef, useValue: { close, beforeClosed: () => closing } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(CommandPalette);
    root = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
    input = root.querySelector('input')!;
    input.focus();
  });

  afterEach(() => {
    fixture.destroy();
    http.verify();
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalScroll) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    }
  });

  function options(): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('[role="option"]'));
  }

  function option(label: string): HTMLElement {
    const result = options().find(
      (element) => element.querySelector('.palette__item-label')?.textContent?.trim() === label,
    );
    expect(result, `visible option: ${label}`).toBeDefined();
    return result!;
  }

  function expectActive(element: HTMLElement): void {
    expect(element.id).not.toBe('');
    expect(input.getAttribute('aria-activedescendant')).toBe(element.id);
    expect(element.getAttribute('aria-selected')).toBe('true');
    expect(element.classList.contains('palette__item--active')).toBe(true);
    expect(options().filter((item) => item.getAttribute('aria-selected') === 'true')).toEqual([
      element,
    ]);
  }

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function type(term: string): Promise<void> {
    input.value = term;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await render();
  }

  async function key(value: string): Promise<KeyboardEvent> {
    const event = new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    await render();
    return event;
  }

  async function startSearch(): Promise<void> {
    vi.advanceTimersByTime(180);
    await render();
  }

  function answerSearch(
    agents: object[] = [],
    prompts: object[] = [],
    memories: object[] = [],
    chats: object[] = [],
  ): void {
    for (const [path, items] of [
      ['/chats', chats],
      ['/agents', agents],
      ['/system-prompts', prompts],
      ['/memories', memories],
    ] as const) {
      http
        .expectOne((request) => request.url.endsWith(path))
        .flush({
          items,
          total: items.length,
          limit: 5,
          offset: 0,
        });
    }
  }

  it('names the first visible option on opening, with unique nonempty option ids', () => {
    expectActive(option('New chat'));
    const ids = options().map((element) => element.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keeps the active descendant and input focus in sync with arrow navigation and wrapping', async () => {
    expect((await key('ArrowDown')).defaultPrevented).toBe(true);
    expectActive(option('Chats'));
    await key('ArrowUp');
    expectActive(option('New chat'));
    await key('ArrowUp');
    expectActive(option('Overview'));
    await key('ArrowDown');
    expectActive(option('New chat'));
    expect(document.activeElement).toBe(input);
  });

  it('keeps an option id stable when filtering changes its flat index', async () => {
    const id = option('Shared memory').id;
    expect(id).not.toBe('');
    await key('ArrowDown');
    await key('ArrowDown');
    await type('memory');
    expect(options()).toHaveLength(1);
    expect(option('Shared memory').id).toBe(id);
    expectActive(option('Shared memory'));
    await type('');
    expect(option('Shared memory').id).toBe(id);
    expectActive(option('New chat'));
  });

  it('uses named option groups and keeps headings and options out of the tab order', () => {
    for (const group of root.querySelectorAll<HTMLElement>('.palette__group')) {
      expect(group.getAttribute('role')).toBe('group');
      expect(group.getAttribute('aria-label')).toBe(
        group.querySelector('.palette__group-name')?.textContent?.trim(),
      );
      expect(group.querySelector('.palette__group-name')?.getAttribute('role')).not.toBe('option');
    }
    for (const element of options()) {
      expect(element.tabIndex).toBeLessThan(0);
    }
  });

  it('updates the active descendant on hover and still opens the clicked result', async () => {
    const target = option('Shared memory');
    target.dispatchEvent(new MouseEvent('mouseenter'));
    await render();
    expectActive(target);
    expect(document.activeElement).toBe(input);
    target.click();
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/memory']);
  });

  it('still opens the active result with Enter', async () => {
    await key('ArrowDown');
    expect((await key('Enter')).defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(['/chats']);
  });

  it('omits the active descendant for empty results, including arrow and Enter input', async () => {
    await type('no matching navigation');
    expect(options()).toHaveLength(0);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    await key('ArrowUp');
    await key('ArrowDown');
    await key('Enter');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    await type('');
    expectActive(option('New chat'));
  });

  it('omits the active descendant while loading hides otherwise matching navigation', async () => {
    await type('agents');
    expectActive(option('Agents'));
    await startSearch();
    expect(root.querySelector('.palette__loading')).not.toBeNull();
    expect(options()).toHaveLength(0);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    answerSearch();
    await render();
    expectActive(option('Agents'));
  });

  it('names unique options across collections even when their underlying ids match', async () => {
    await type('needle');
    await startSearch();
    answerSearch(
      [{ id: 'same', name: 'Needle agent', personality: null }],
      [{ id: 'same', name: 'Needle prompt', content: 'Instructions' }],
      [{ id: 'same', content: 'Needle memory', tags: [] }],
    );
    await render();
    const ids = options().map((element) => element.id);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    expectActive(option('Needle agent'));
    await key('ArrowDown');
    expectActive(option('Needle prompt'));
    await key('ArrowDown');
    expectActive(option('Needle memory'));
  });

  it('keeps the reference valid while refreshing and resets it when results are replaced', async () => {
    await type('needle');
    await startSearch();
    answerSearch([
      { id: 'a', name: 'Needle A', personality: null },
      { id: 'b', name: 'Needle B', personality: null },
    ]);
    await render();
    const stableId = option('Needle A').id;
    await key('ArrowDown');
    expectActive(option('Needle B'));
    await type('needle updated');
    await key('ArrowDown');
    await startSearch();
    expectActive(option('Needle B'));
    answerSearch([{ id: 'a', name: 'Needle A updated', personality: null }]);
    await render();
    expect(options()).toHaveLength(1);
    expect(option('Needle A updated').id).toBe(stableId);
    expectActive(option('Needle A updated'));
  });

  it('removes the reference when the dialog starts closing, while its input still exists', async () => {
    expectActive(option('New chat'));
    closing.next();
    await render();
    expect(root.contains(input)).toBe(true);
    expect(input.getAttribute('aria-expanded')).toBe('false');
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
  });

  it('scrolls the rendered active option into view after keyboard navigation', async () => {
    scroll.mockClear();
    await key('ArrowUp');
    expect(scroll).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scroll.mock.contexts.at(-1)).toBe(option('Overview'));
    expect(document.activeElement).toBe(input);
  });

  it('finds conversations by title and opens the one chosen', async () => {
    await type('needle');
    await startSearch();
    answerSearch(
      [],
      [],
      [],
      [
        { id: 'c1', title: 'Needle in the lexer' },
        { id: 'c2', title: null },
      ],
    );
    await render();
    // An untitled chat is still a result, named the way the rest of the app names it.
    expect(options().map((element) => element.id)).toHaveLength(2);
    expectActive(option('Needle in the lexer'));
    await key('Enter');
    expect(navigate).toHaveBeenCalledWith(['/chats', 'c1']);
  });

  it('leaves Escape handling to the dialog', async () => {
    expect((await key('Escape')).defaultPrevented).toBe(false);
    expect(close).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
