import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import type { Project } from '../../../core/api/projects.models';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { ProjectList } from './project-list';

const PROJECTS_URL = `${environment.apiBaseUrl}/projects`;

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'p1',
    name: 'Compiler rewrite',
    description: 'IR passes and the new backend.',
    hasImage: false,
    chatCount: 3,
    artifactCount: 1,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
    ...overrides,
  };
}

function setup(items: Project[] = [project()]) {
  const conversations = { refresh: vi.fn(), refreshProjects: vi.fn() };

  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ProjectList],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ConversationsService, useValue: conversations },
      { provide: MatDialog, useValue: { open: () => ({ afterClosed: () => of(true) }) } },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ProjectList);
  fixture.detectChanges();

  const request = httpMock.expectOne((candidate) => candidate.url === PROJECTS_URL);
  request.flush({ items, total: items.length, limit: 25, offset: 0 });
  fixture.detectChanges();

  return {
    fixture,
    httpMock,
    request,
    conversations,
    element: fixture.nativeElement as HTMLElement,
    component: fixture.componentInstance as unknown as { remove(p: Project): Promise<void> },
  };
}

describe('ProjectList', () => {
  it('reads the projects by name', () => {
    const { request } = setup();

    expect(request.request.params.get('sort')).toBe('name');
    expect(request.request.params.get('order')).toBe('asc');
  });

  it('shows each project with how much is in it, and links to it', () => {
    const { element } = setup([project(), project({ id: 'p2', name: 'Docs', chatCount: 1 })]);
    const rows = Array.from(element.querySelectorAll('.row'));

    expect(rows[0]?.textContent).toContain('Compiler rewrite');
    expect(rows[0]?.querySelector('.row__counts')?.textContent).toContain('3 chats');
    expect(rows[1]?.querySelector('.row__counts')?.textContent).toContain('1 chat ');
    expect(rows[0]?.querySelector('a')?.getAttribute('href')).toBe('/projects/p1');
  });

  it('explains what a project is for when there are none', () => {
    const { element } = setup([]);

    expect(element.textContent).toContain('No projects yet');
  });

  it('deletes a project and has the rail re-read, since its chats became unfiled', async () => {
    const { component, httpMock, conversations, fixture } = setup();

    const removing = component.remove(project());
    await new Promise((resolve) => setTimeout(resolve, 0));
    const request = httpMock.expectOne(`${PROJECTS_URL}/p1`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);
    await removing;
    fixture.detectChanges();

    expect(conversations.refresh).toHaveBeenCalledOnce();
    httpMock
      .match((candidate) => candidate.url === PROJECTS_URL)
      .forEach((reload) => reload.flush({ items: [], total: 0, limit: 25, offset: 0 }));
  });
});
