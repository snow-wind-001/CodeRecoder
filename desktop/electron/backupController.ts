/**
 * Compatibility export for early desktop integrations. New code should use
 * ProjectSessionRegistry directly; it owns all project-scoped controllers.
 */
export {
  ProjectSessionRegistry as DesktopBackupController,
  type ProjectSessionRegistryOptions as DesktopControllerOptions
} from './projectSessionRegistry.js';
