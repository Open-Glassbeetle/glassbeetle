import { Routes } from '@angular/router';

/**
 * Every surface is lazily loaded. The shell and the overview are what the
 * window opens on; there is no reason for the agent editor's forms to be in
 * that bundle.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'overview',
  },
  {
    path: 'overview',
    title: 'Overview · Glassbeetle',
    loadComponent: () => import('./features/overview/overview').then((m) => m.Overview),
  },
  {
    path: 'agents',
    title: 'Agents · Glassbeetle',
    loadComponent: () => import('./features/agents/agent-list/agent-list').then((m) => m.AgentList),
  },
  {
    path: 'agents/:agentId',
    title: 'Agent · Glassbeetle',
    loadComponent: () =>
      import('./features/agents/agent-detail/agent-detail').then((m) => m.AgentDetail),
  },
  {
    path: 'budget',
    title: 'Spending · Glassbeetle',
    loadComponent: () => import('./features/budget/budget').then((m) => m.Budget),
  },
  {
    path: 'profile',
    title: 'Profile · Glassbeetle',
    loadComponent: () => import('./features/profile/profile').then((m) => m.Profile),
  },
  {
    path: 'teams',
    title: 'Teams · Glassbeetle',
    loadComponent: () => import('./features/teams/team-list/team-list').then((m) => m.TeamList),
  },
  {
    path: 'teams/:teamId',
    title: 'Team · Glassbeetle',
    loadComponent: () =>
      import('./features/teams/team-detail/team-detail').then((m) => m.TeamDetail),
  },
  {
    path: 'memory',
    title: 'Shared memory · Glassbeetle',
    loadComponent: () =>
      import('./features/shared-memories/shared-memory-list').then((m) => m.SharedMemoryList),
  },
  {
    path: 'prompts',
    title: 'System prompts · Glassbeetle',
    loadComponent: () =>
      import('./features/system-prompts/system-prompt-list').then((m) => m.SystemPromptList),
  },
  // The previous paths, kept so links and bookmarks from the earlier UI resolve.
  { path: 'dashboard', pathMatch: 'full', redirectTo: 'overview' },
  { path: 'memories', pathMatch: 'full', redirectTo: 'memory' },
  { path: 'system-prompts', pathMatch: 'full', redirectTo: 'prompts' },
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found').then((m) => m.NotFound),
  },
];
