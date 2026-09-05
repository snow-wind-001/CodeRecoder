import { randomUUID } from 'node:crypto';
import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import * as z from 'zod/v4';
import type {
  DesktopDashboard,
  DesktopResult,
  DesktopStateEvent,
  DesktopWindowKind,
  ProjectId,
  ProjectRegistrationInput,
  RestoreOutcome,
  RestorePreview,
  SerenaStatus,
  VerificationOutcome
} from '../shared/contracts.js';
import { OperationScheduler } from './operationScheduler.js';
import {
  PreferenceStore,
  type DesktopPreferences,
  type ProjectPreference
} from './preferenceStore.js';
import { ProjectSession } from './projectSession.js';

const registrationSchema = z.object({
  projectPath: z.string().trim().min(1).max(4096),
  storageRoot: z.string().trim().min(1).max(4096).optional(),
  autoCheckpoint: z.boolean(),
  maxBackups: z.number().int().min(2).max(10_000),
  startOnLaunch: z.boolean(),
  serenaEnabled: z.boolean(),
  serenaAutoConfigure: z.boolean()
}).strict();
const projectIdSchema = z.string().uuid();

export interface RegistryWindowScope {
  kind: DesktopWindowKind;
  projectId: ProjectId | null;
}

export interface ProjectSessionRegistryOptions {
  appVersion: string;
  defaultStorageRoot: string;
  preferencePath: string;
  schedulerConcurrency?: number;
  serenaCommandPath?: string | null;
  serenaStartupTimeoutMs?: number;
  onStateChange?: (event: DesktopStateEvent) => void;
}

export class ProjectSessionRegistry {
  private readonly appVersion: string;
  private readonly defaultStorageRoot: string;
  private readonly preferenceStore: PreferenceStore;
  private readonly scheduler: OperationScheduler;
  private readonly serenaCommandPath: string | null | undefined;
  private readonly serenaStartupTimeoutMs: number | undefined;
  private readonly onStateChange?: ProjectSessionRegistryOptions['onStateChange'];
  private readonly sessions = new Map<ProjectId, ProjectSession>();
  private selectedProjectId: ProjectId | null = null;
  private mutationTail: Promise<void> = Promise.resolve();

  constructor(options: ProjectSessionRegistryOptions) {
    this.appVersion = options.appVersion;
    this.defaultStorageRoot = path.resolve(options.defaultStorageRoot);
    this.preferenceStore = new PreferenceStore(options.preferencePath);
    this.scheduler = new OperationScheduler(options.schedulerConcurrency ?? 2);
    this.serenaCommandPath = options.serenaCommandPath;
    this.serenaStartupTimeoutMs = options.serenaStartupTimeoutMs;
    this.onStateChange = options.onStateChange;
  }

  async initialize(): Promise<void> {
    const loaded = await this.preferenceStore.load();
    this.selectedProjectId = loaded.preferences.selectedProjectId;
    for (const preference of loaded.preferences.projects) {
      const config: ProjectRegistrationInput = {
        ...preference,
        projectPath: path.resolve(preference.projectPath),
        storageRoot: path.resolve(preference.storageRoot ?? this.defaultStorageRoot)
      };
      this.sessions.set(preference.id, this.createSession(preference.id, preference.registeredAt, config));
    }
    if (this.selectedProjectId && !this.sessions.has(this.selectedProjectId)) {
      this.selectedProjectId = this.sessions.keys().next().value ?? null;
    }

  }

  async startConfiguredProjects(): Promise<void> {
    const startups = [...this.sessions.values()]
      .filter(session => session.getRegistration().startOnLaunch)
      .map(async session => {
        this.emit(session.id, 'project-started');
        const result = await session.start();
        if (!result.success) {
          console.error(`[${session.id}] startup protection failed:`, result.error ?? result.message);
        }
        this.emit(session.id, 'project-started');
      });
    await Promise.all(startups);
  }

  async registerProject(rawInput: unknown): Promise<DesktopResult<{ projectId: ProjectId }>> {
    return await this.serializeMutation(async () => {
      try {
        const input = registrationSchema.parse(rawInput);
        const config = await this.normalizeAndValidateRegistration(input);
        const id = randomUUID();
        const registeredAt = Date.now();
        const session = this.createSession(id, registeredAt, config);
        this.sessions.set(id, session);
        this.selectedProjectId = id;
        try {
          await this.savePreferences();
        } catch (error) {
          this.sessions.delete(id);
          this.selectedProjectId = this.sessions.keys().next().value ?? null;
          throw error;
        }
        this.emit(id, 'project-registered');

        const started = await session.start();
        this.emit(id, 'project-started');
        return {
          success: started.success,
          message: started.message,
          error: started.error,
          data: { projectId: id }
        };
      } catch (error) {
        return this.failure('注册工程失败', error);
      }
    });
  }

  async selectProject(rawProjectId: unknown): Promise<DesktopResult<DesktopDashboard>> {
    return await this.serializeMutation(async () => {
      try {
        const projectId = this.parseProjectId(rawProjectId);
        this.requireSession(projectId);
        this.selectedProjectId = projectId;
        await this.savePreferences();
        this.emit(projectId, 'selection');
        return await this.dashboard({ kind: 'main', projectId: null }, projectId, true);
      } catch (error) {
        return this.failure('选择工程失败', error);
      }
    });
  }

  async startProject(rawProjectId: unknown): Promise<DesktopResult> {
    const projectId = this.parseProjectId(rawProjectId);
    const session = this.requireSession(projectId);
    const response = await session.start();
    if (response.success) {
      session.setStartOnLaunch(true);
      await this.savePreferences();
    }
    this.emit(projectId, 'project-started');
    return response;
  }

  async stopProject(rawProjectId: unknown, createFinalCheckpoint: boolean): Promise<DesktopResult> {
    const projectId = this.parseProjectId(rawProjectId);
    const session = this.requireSession(projectId);
    const response = await session.stop(createFinalCheckpoint);
    if (response.success) {
      session.setStartOnLaunch(false);
      await this.savePreferences();
    }
    this.emit(projectId, 'project-stopped');
    return response;
  }

  async removeProject(rawProjectId: unknown, createFinalCheckpoint: boolean): Promise<DesktopResult> {
    return await this.serializeMutation(async () => {
      try {
        const projectId = this.parseProjectId(rawProjectId);
        const session = this.requireSession(projectId);
        const stopped = await session.stop(createFinalCheckpoint);
        if (!stopped.success) return stopped;
        this.sessions.delete(projectId);
        if (this.selectedProjectId === projectId) {
          this.selectedProjectId = this.sessions.keys().next().value ?? null;
        }
        await this.savePreferences();
        this.emit(projectId, 'project-removed');
        return { success: true, message: '工程已从控制台移除；备份文件仍然保留' };
      } catch (error) {
        return this.failure('移除工程失败', error);
      }
    });
  }

  async dashboard(
    scope: RegistryWindowScope,
    requestedProjectId?: unknown,
    refreshSelected = true
  ): Promise<DesktopResult<DesktopDashboard>> {
    try {
      let selectedId: ProjectId | null;
      if (scope.kind === 'project') {
        selectedId = scope.projectId;
      } else if (requestedProjectId !== undefined) {
        selectedId = this.parseProjectId(requestedProjectId);
      } else {
        selectedId = this.selectedProjectId;
      }
      if (selectedId && !this.sessions.has(selectedId)) selectedId = null;
      const selectedProject = selectedId
        ? await this.requireSession(selectedId).dashboard(refreshSelected)
        : null;
      return {
        success: true,
        message: '桌面工程状态已刷新',
        data: {
          schemaVersion: 2,
          appVersion: this.appVersion,
          defaultStorageRoot: this.defaultStorageRoot,
          window: { ...scope },
          selectedProjectId: selectedId,
          projects: [...this.sessions.values()].map(session => session.getSummary()),
          selectedProject
        }
      };
    } catch (error) {
      return this.failure('刷新桌面工程状态失败', error);
    }
  }

  async createSnapshot(projectId: unknown, input: unknown): Promise<DesktopResult> {
    return await this.requireSession(this.parseProjectId(projectId)).createSnapshot(input);
  }

  async verifySnapshot(projectId: unknown, snapshotId: unknown): Promise<DesktopResult<VerificationOutcome>> {
    return await this.requireSession(this.parseProjectId(projectId)).verifySnapshot(snapshotId);
  }

  async previewRestore(projectId: unknown, input: unknown): Promise<DesktopResult<RestorePreview>> {
    return await this.requireSession(this.parseProjectId(projectId)).previewRestore(input);
  }

  async restoreSnapshot(projectId: unknown, input: unknown): Promise<DesktopResult<RestoreOutcome>> {
    return await this.requireSession(this.parseProjectId(projectId)).restoreSnapshot(input);
  }

  async restartSerena(projectId: unknown): Promise<DesktopResult<SerenaStatus>> {
    return await this.requireSession(this.parseProjectId(projectId)).restartSerena() as DesktopResult<SerenaStatus>;
  }

  getProject(projectId: unknown): ProjectSession {
    return this.requireSession(this.parseProjectId(projectId));
  }

  hasProject(projectId: string): boolean {
    return this.sessions.has(projectId);
  }

  getSelectedProjectId(): ProjectId | null {
    return this.selectedProjectId;
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.sessions.values()].map(async session => await session.shutdown()));
  }

  private createSession(id: string, registeredAt: number, config: ProjectRegistrationInput): ProjectSession {
    return new ProjectSession({
      id,
      registeredAt,
      config,
      scheduler: this.scheduler,
      serenaCommandPath: this.serenaCommandPath,
      serenaStartupTimeoutMs: this.serenaStartupTimeoutMs,
      onChange: reason => this.emit(id, reason)
    });
  }

  private async normalizeAndValidateRegistration(
    input: ProjectRegistrationInput
  ): Promise<ProjectRegistrationInput> {
    const resolvedProject = path.resolve(input.projectPath);
    const projectStat = await nodeFs.stat(resolvedProject);
    if (!projectStat.isDirectory()) throw new Error('工程路径必须是目录');
    const projectRoot = await nodeFs.realpath(resolvedProject);
    if (projectRoot === path.parse(projectRoot).root) throw new Error('拒绝将文件系统根目录注册为工程');

    const resolvedStorage = path.resolve(input.storageRoot ?? this.defaultStorageRoot);
    const storageRoot = await this.realpathIfPresent(resolvedStorage);
    const allProjectRoots = [projectRoot, ...[...this.sessions.values()].map(session => session.root)];
    for (const existing of this.sessions.values()) {
      if (this.pathsOverlap(projectRoot, existing.root)) {
        if (projectRoot === existing.root) {
          throw new Error(`该工程已经注册：${existing.name}`);
        }
        throw new Error(`拒绝注册父子嵌套工程：${existing.root}`);
      }
      const existingStorage = path.resolve(existing.getRegistration().storageRoot ?? this.defaultStorageRoot);
      if (this.pathsOverlap(projectRoot, existingStorage)) {
        throw new Error(`工程目录与已注册工程的备份根目录重叠：${existingStorage}`);
      }
    }
    for (const protectedRoot of allProjectRoots) {
      if (this.pathsOverlap(storageRoot, protectedRoot)) {
        throw new Error(`备份根目录不能位于受保护工程内或包含受保护工程：${protectedRoot}`);
      }
    }

    return {
      ...input,
      projectPath: projectRoot,
      storageRoot
    };
  }

  private pathsOverlap(first: string, second: string): boolean {
    const a = path.resolve(first);
    const b = path.resolve(second);
    if (a === b) return true;
    const aToB = path.relative(a, b);
    const bToA = path.relative(b, a);
    return (!aToB.startsWith('..') && !path.isAbsolute(aToB))
      || (!bToA.startsWith('..') && !path.isAbsolute(bToA));
  }

  private async realpathIfPresent(value: string): Promise<string> {
    const resolved = path.resolve(value);
    try {
      return await nodeFs.realpath(resolved);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const missingSegments: string[] = [];
      let cursor = resolved;
      while (cursor !== path.parse(cursor).root) {
        try {
          const existingRoot = await nodeFs.realpath(cursor);
          return path.join(existingRoot, ...missingSegments.reverse());
        } catch (candidateError) {
          if ((candidateError as NodeJS.ErrnoException).code !== 'ENOENT') throw candidateError;
          missingSegments.push(path.basename(cursor));
          cursor = path.dirname(cursor);
        }
      }
      return path.join(cursor, ...missingSegments.reverse());
    }
  }

  private requireSession(projectId: ProjectId): ProjectSession {
    const session = this.sessions.get(projectId);
    if (!session) throw new Error('工程不存在或已被移除');
    return session;
  }

  private parseProjectId(value: unknown): ProjectId {
    return projectIdSchema.parse(value);
  }

  private async savePreferences(): Promise<void> {
    const projects: ProjectPreference[] = [...this.sessions.values()].map(session => ({
      id: session.id,
      registeredAt: session.registeredAt,
      ...session.getRegistration()
    }));
    const preferences: DesktopPreferences = {
      schemaVersion: 2,
      selectedProjectId: this.selectedProjectId,
      projects
    };
    await this.preferenceStore.save(preferences);
  }

  private emit(projectId: ProjectId | null, reason: DesktopStateEvent['reason']): void {
    this.onStateChange?.({ projectId, reason, occurredAt: Date.now() });
  }

  private async serializeMutation<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.mutationTail.then(operation, operation);
    this.mutationTail = scheduled.then(() => undefined, () => undefined);
    return await scheduled;
  }

  private failure<T = never>(message: string, error: unknown): DesktopResult<T> {
    return {
      success: false,
      message,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
