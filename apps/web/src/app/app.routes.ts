import { Routes } from '@angular/router';

/**
 * Every feature is lazily loaded: the Tauri window shows the dashboard first,
 * and there is no reason for the agent editor's forms to be in that bundle.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'dashboard',
  },
  {
    path: 'dashboard',
    title: 'Dashboard · Glassbeetle',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
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
    path: 'memories',
    title: 'Shared memory · Glassbeetle',
    loadComponent: () =>
      import('./features/shared-memories/shared-memory-list').then((m) => m.SharedMemoryList),
  },
  {
    path: 'system-prompts',
    title: 'System prompts · Glassbeetle',
    loadComponent: () =>
      import('./features/system-prompts/system-prompt-list').then((m) => m.SystemPromptList),
  },
  {
    path: '**',
    loadComponent: () => import('./features/not-found/not-found').then((m) => m.NotFound),
  },
];
