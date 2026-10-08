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
    path: 'profile',
    title: 'Profile · Glassbeetle',
    loadComponent: () => import('./features/profile/profile').then((m) => m.Profile),
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
