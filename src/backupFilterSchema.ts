import * as z from 'zod/v4';
import { normalizeBackupFilter } from './backupFilter.js';

export const backupFilterShape = {
  backupScope: z.enum(['all', 'code-and-docs']).optional()
    .describe('Defaults to all. code-and-docs includes known source, configuration and document file names/extensions.'),
  excludePaths: z.array(z.string().trim().min(1).max(4096).refine(value => {
    try { normalizeBackupFilter({ excludePaths: [value] }); return true; } catch { return false; }
  }, 'Expected a literal project-relative path')).max(100).optional()
    .describe('Literal project-relative files or directories to exclude, including their descendants; no globs.'),
  includeExtensions: z.array(z.string().trim().min(1).max(32).refine(value => {
    try { normalizeBackupFilter({ includeExtensions: [value] }); return true; } catch { return false; }
  }, 'Invalid file extension')).max(100).optional()
    .describe('Additional file extensions to include in code-and-docs mode, e.g. svg or csv.')
};

export const backupFilterSchema = z.object(backupFilterShape).strict().transform(normalizeBackupFilter);
