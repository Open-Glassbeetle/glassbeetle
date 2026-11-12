import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { environment } from '../../../../environments/environment';
import type { Artifact } from '../../../core/api/artifacts.models';
import { AgentRosterService } from '../../../core/workspace/agent-roster.service';
import { ConversationsService } from '../../../core/workspace/conversations.service';
import { ArtifactDetail } from './artifact-detail';

const ARTIFACT_URL = `${environment.apiBaseUrl}/artifacts/x1`;

function artifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: 'x1',
    projectId: 'p1',
    chatId: 'c1',
    agentId: 'a1',
    title: 'clamp.ts',
    type: 'code',
    mimeType: 'text/typescript',
    content: 'export const clamp = 1;\n',
    hasFile: false,
    version: 2,
    createdAt: '2026-10-01T08:00:00.000Z',
    updatedAt: '2026-10-02T08:00:00.000Z',
    ...overrides,
  };
}

function setup(current: Artifact | null = artifact()) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [ArtifactDetail],
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: AgentRosterService,
        useValue: { agents: signal([{ id: 'a1', name: 'Code Reviewer' }]) },
      },
      {
        provide: ConversationsService,
        useValue: { projectName: (id: string) => (id === 'p1' ? 'Compiler rewrite' : null) },
      },
    ],
  });

  const httpMock = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ArtifactDetail);
  fixture.componentRef.setInput('artifactId', 'x1');
  fixture.detectChanges();

  const request = httpMock.expectOne(ARTIFACT_URL);
  if (current) {
    request.flush(current);
  } else {
    request.flush(
      { statusCode: 404, error: 'Not Found', code: 'ARTIFACT_NOT_FOUND', message: 'Gone.' },
      { status: 404, statusText: 'Not Found' },
    );
  }
  fixture.detectChanges();

  return fixture.nativeElement as HTMLElement;
}

describe('ArtifactDetail', () => {
  it('shows the content as text and where the artifact came from', () => {
    const element = setup();

    expect(element.querySelector('.content')?.textContent).toBe('export const clamp = 1;\n');

    const links = Array.from(element.querySelectorAll('.origin__link'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/chats/c1',
      '/agents/a1',
      '/projects/p1',
    ]);
    expect(links[1]?.textContent).toContain('Code Reviewer');
    expect(links[2]?.textContent).toContain('Compiler rewrite');
  });

  it('says so, rather than linking nowhere, once its chat, agent and project are gone', () => {
    const element = setup(artifact({ chatId: null, agentId: null, projectId: null }));

    expect(element.querySelectorAll('.origin__link')).toHaveLength(0);
    expect(element.querySelector('.origin')?.textContent).toContain('No longer linked');
    expect(element.querySelector('.origin')?.textContent).toContain('Unfiled');
  });

  it('links to a stored file instead of trying to draw it', () => {
    const element = setup(artifact({ content: null, hasFile: true }));

    expect(element.querySelector('.content')).toBeNull();
    expect(element.textContent).toContain('Stored as a file');
    expect(element.querySelector('a[target="_blank"]')?.getAttribute('href')).toBe(
      `${ARTIFACT_URL}/content`,
    );
  });

  it('reports an artifact that is not there as missing', () => {
    const element = setup(null);

    expect(element.textContent).toContain('Artifact not found');
    expect(element.textContent).not.toContain('Try again');
  });
});
