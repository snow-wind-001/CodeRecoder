import type { ProjectId } from '../shared/contracts.js';
import type { RegistryWindowScope } from './projectSessionRegistry.js';

export function assertMainWindow(scope: RegistryWindowScope): void {
  if (scope.kind !== 'main') {
    throw new Error('This operation is only available in the main window');
  }
}

export function assertProjectAccess(
  scope: RegistryWindowScope,
  projectId: unknown
): ProjectId {
  if (typeof projectId !== 'string') throw new Error('projectId is invalid');
  if (scope.kind === 'project' && scope.projectId !== projectId) {
    throw new Error('Project window cannot access a different project session');
  }
  return projectId;
}

export function resolveProjectForScope(
  scope: RegistryWindowScope,
  requestedProjectId: unknown,
  selectedProjectId: ProjectId | null
): ProjectId | undefined {
  if (scope.kind === 'project') {
    if (!scope.projectId) throw new Error('Project window is not bound to a session');
    if (requestedProjectId !== undefined && requestedProjectId !== scope.projectId) {
      throw new Error('Project window cannot access a different project session');
    }
    return scope.projectId;
  }
  if (requestedProjectId === undefined) return selectedProjectId ?? undefined;
  if (typeof requestedProjectId !== 'string') throw new Error('projectId is invalid');
  return requestedProjectId;
}
