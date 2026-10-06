import {
  DestroyRef,
  Signal,
  WritableSignal,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toObservable, toSignal } from '@angular/core/rxjs-interop';
import { PageEvent } from '@angular/material/paginator';
import { Sort } from '@angular/material/sort';
import {
  Observable,
  Subject,
  catchError,
  debounceTime,
  distinctUntilChanged,
  map,
  of,
  switchMap,
} from 'rxjs';

import { ApiError, toApiError } from '../../core/api/api-error';
import { DEFAULT_PAGE_SIZE, PaginatedResponse, SortOrder } from '../../core/api/pagination';

/** The base query a collection endpoint receives, resolved from the signals below. */
export interface ListPageQuery {
  readonly limit: number;
  readonly offset: number;
  readonly sort: string;
  readonly order: SortOrder;
  readonly search?: string;
}

export interface ListStateConfig<T, E extends object> {
  /**
   * Fetches one page. Called with the resolved base query merged with
   * `extraParams`, and re-called whenever any of those change.
   */
  readonly load: (query: ListPageQuery & E) => Observable<PaginatedResponse<T>>;

  /**
   * Feature-specific filters. Read reactively, so a filter signal changing
   * reloads the list without the component wiring that up itself.
   */
  readonly extraParams?: () => E;

  readonly initialSort?: string;
  readonly initialOrder?: SortOrder;
  readonly pageSize?: number;
}

/** How long to wait after the last keystroke before searching. */
const SEARCH_DEBOUNCE_MS = 250;

interface LoadResult<T> {
  readonly page: PaginatedResponse<T> | null;
  readonly error: ApiError | null;
}

/**
 * Paging, sorting, searching and request state for one collection endpoint.
 *
 * Must be constructed in an injection context — as a component field, which is
 * how every list page uses it.
 *
 * Requests go through `switchMap`, so a slow page-1 response cannot land after
 * a fast page-2 response and leave the table showing the wrong page.
 */
export class ListState<T, E extends object = Record<string, never>> {
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new Subject<ListPageQuery & E>();

  private readonly _items = signal<readonly T[]>([]);
  private readonly _total = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<ApiError | null>(null);
  private readonly _loadedOnce = signal(false);

  /** Bound directly to the search box; debounced before it reaches the API. */
  readonly searchTerm = signal('');
  readonly sort: WritableSignal<string>;
  readonly order: WritableSignal<SortOrder>;
  readonly pageIndex = signal(0);
  readonly pageSize: WritableSignal<number>;

  readonly items = this._items.asReadonly();
  readonly total = this._total.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** True once a response or a failure has arrived. */
  readonly loadedOnce = this._loadedOnce.asReadonly();

  /** The debounced term actually sent to the API. */
  readonly search: Signal<string>;

  readonly offset = computed(() => this.pageIndex() * this.pageSize());

  /** True when the request succeeded and returned nothing. */
  readonly isEmpty = computed(
    () => this.loadedOnce() && !this.error() && this._items().length === 0,
  );

  constructor(private readonly config: ListStateConfig<T, E>) {
    this.sort = signal(config.initialSort ?? 'createdAt');
    this.order = signal<SortOrder>(config.initialOrder ?? 'desc');
    this.pageSize = signal(config.pageSize ?? DEFAULT_PAGE_SIZE);

    this.search = toSignal(
      toObservable(this.searchTerm).pipe(
        map((term) => term.trim()),
        debounceTime(SEARCH_DEBOUNCE_MS),
        distinctUntilChanged(),
      ),
      { initialValue: '' },
    );

    this.requests
      .pipe(
        switchMap((query) => {
          this._loading.set(true);
          this._error.set(null);

          // `catchError` sits inside the projection so it only ends this
          // request. On the outer stream an error would complete it and the
          // list would never load again.
          return this.config.load(query).pipe(
            map((page): LoadResult<T> => ({ page, error: null })),
            catchError((error: unknown) =>
              of<LoadResult<T>>({ page: null, error: toApiError(error) }),
            ),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ page, error }) => {
        this._loading.set(false);
        this._loadedOnce.set(true);
        this._error.set(error);
        this._items.set(page?.items ?? []);
        this._total.set(page?.total ?? 0);
      });

    // Reading every query signal here is what makes the list reload when any
    // of them changes, including the first run on construction.
    effect(() => this.requests.next(this.currentQuery()));
  }

  /** Re-runs the current query, e.g. after a create or an edit. */
  reload(): void {
    this.requests.next(this.currentQuery());
  }

  /**
   * Reloads after a row was removed, stepping back a page when that row was
   * the only one on the current page. Without this, deleting the last item on
   * page 3 leaves the user looking at an empty page 3.
   */
  reloadAfterRemoval(): void {
    if (this._items().length === 1 && this.pageIndex() > 0) {
      // Changing the page triggers the effect, which issues the request.
      this.pageIndex.update((index) => index - 1);
      return;
    }

    this.reload();
  }

  /** Updates the search box and returns to the first page. */
  setSearch(term: string): void {
    this.searchTerm.set(term);
    this.pageIndex.set(0);
  }

  clearSearch(): void {
    this.setSearch('');
  }

  onPage(event: PageEvent): void {
    this.pageSize.set(event.pageSize);
    this.pageIndex.set(event.pageIndex);
  }

  /**
   * Applies a `mat-sort-header` change. Clearing the direction falls back to
   * the configured default instead of sending no sort at all, so rows never
   * come back in an unspecified order.
   */
  onSort(event: Sort): void {
    if (event.direction) {
      this.sort.set(event.active);
      this.order.set(event.direction);
    } else {
      this.sort.set(this.config.initialSort ?? 'createdAt');
      this.order.set(this.config.initialOrder ?? 'desc');
    }

    this.pageIndex.set(0);
  }

  /** Jumps back to the first page; any filter change invalidates the offset. */
  resetPage(): void {
    this.pageIndex.set(0);
  }

  private currentQuery(): ListPageQuery & E {
    const search = this.search();

    return {
      limit: this.pageSize(),
      offset: this.offset(),
      sort: this.sort(),
      order: this.order(),
      ...(search ? { search } : {}),
      ...(this.config.extraParams?.() ?? {}),
    } as ListPageQuery & E;
  }
}
