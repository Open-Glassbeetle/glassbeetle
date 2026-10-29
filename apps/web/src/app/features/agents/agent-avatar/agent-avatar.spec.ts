import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AgentsService } from '../../../core/api/agents.service';
import { AgentAvatar } from './agent-avatar';

describe('AgentAvatar', () => {
  let fixture: ComponentFixture<AgentAvatar>;
  let element: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AgentAvatar],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();

    fixture = TestBed.createComponent(AgentAvatar);
    element = fixture.nativeElement as HTMLElement;
  });

  it('passes the picture URL through when the agent has one', () => {
    const agents = TestBed.inject(AgentsService);
    const agent = {
      id: '018f3a9e-0000-7000-8000-000000000001',
      hasPicture: true,
      updatedAt: '2026-10-29T01:00:00.000Z',
    };

    fixture.componentRef.setInput('name', 'Fox Mulder');
    fixture.componentRef.setInput('agent', agent);
    fixture.detectChanges();

    expect(element.querySelector('img')?.getAttribute('src')).toBe(
      agents.pictureUrl(agent),
    );
    expect(element.querySelector('.badge')).toBeNull();
  });

  it('falls back to initials when no picture is stored', () => {
    fixture.componentRef.setInput('name', 'Dana Scully');
    fixture.componentRef.setInput('agent', {
      id: '018f3a9e-0000-7000-8000-000000000002',
      hasPicture: false,
      updatedAt: '2026-10-29T01:00:00.000Z',
    });
    fixture.detectChanges();

    expect(element.querySelector('img')).toBeNull();
    expect(element.textContent).toContain('DS');
  });
});
