import { randomUUID } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import * as z from 'zod/v4';
import type { ProjectId, ProjectRegistrationInput } from '../shared/contracts.js';

const projectInputShape = {
  projectPath: z.string().trim().min(1).max(4096),
  storageRoot: z.string().trim().min(1).max(4096).optional(),
  autoCheckpoint: z.boolean(),
  maxBackups: z.number().int().min(2).max(10_000),
  startOnLaunch: z.boolean(),
  serenaEnabled: z.boolean(),
  serenaAutoConfigure: z.boolean()
};

const projectPreferenceSchema = z.object({
  id: z.string().uuid(),
  registeredAt: z.number().int().nonnegative(),
  ...projectInputShape
}).strict();

const preferencesSchema = z.object({
  schemaVersion: z.literal(2),
  selectedProjectId: z.string().uuid().nullable(),
  projects: z.array(projectPreferenceSchema)
}).strict();

const legacyPreferencesSchema = z.object({
  projectPath: z.string().trim().min(1).max(4096),
  storageRoot: z.string().trim().min(1).max(4096).optional(),
  autoCheckpoint: z.boolean(),
  maxBackups: z.number().int().min(2).max(10_000)
}).strict();

export interface ProjectPreference extends ProjectRegistrationInput {
  id: ProjectId;
  registeredAt: number;
}

export interface DesktopPreferences {
  schemaVersion: 2;
  selectedProjectId: ProjectId | null;
  projects: ProjectPreference[];
}

export interface PreferenceLoadResult {
  preferences: DesktopPreferences;
  migratedLegacy: boolean;
}

export class PreferenceStore {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
  }

  async load(): Promise<PreferenceLoadResult> {
    try {
      const content = await nodeFs.readFile(this.filePath, 'utf8');
      const raw: unknown = JSON.parse(content);
      const current = preferencesSchema.safeParse(raw);
      if (current.success) {
        const knownIds = new Set(current.data.projects.map(project => project.id));
        return {
          preferences: {
            ...current.data,
            selectedProjectId: current.data.selectedProjectId && knownIds.has(current.data.selectedProjectId)
              ? current.data.selectedProjectId
              : current.data.projects[0]?.id ?? null
          },
          migratedLegacy: false
        };
      }

      const legacy = legacyPreferencesSchema.safeParse(raw);
      if (!legacy.success) {
        console.error('Desktop preferences are invalid; starting with an empty registry');
        return { preferences: this.empty(), migratedLegacy: false };
      }

      const project: ProjectPreference = {
        id: randomUUID(),
        registeredAt: Date.now(),
        ...legacy.data,
        startOnLaunch: false,
        serenaEnabled: true,
        serenaAutoConfigure: true
      };
      const preferences: DesktopPreferences = {
        schemaVersion: 2,
        selectedProjectId: project.id,
        projects: [project]
      };
      await this.save(preferences);
      return { preferences, migratedLegacy: true };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.error('Failed to read desktop preferences:', this.errorMessage(error));
      }
      return { preferences: this.empty(), migratedLegacy: false };
    }
  }

  async save(preferences: DesktopPreferences): Promise<void> {
    const validated = preferencesSchema.parse(preferences);
    await nodeFs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await nodeFs.writeFile(temporaryPath, `${JSON.stringify(validated, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600
      });
      await nodeFs.rename(temporaryPath, this.filePath);
      await nodeFs.chmod(this.filePath, 0o600);
    } catch (error) {
      await nodeFs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private empty(): DesktopPreferences {
    return {
      schemaVersion: 2,
      selectedProjectId: null,
      projects: []
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
