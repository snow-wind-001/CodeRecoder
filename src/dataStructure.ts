/**
 * CodeRecoder 数据结构定义
 * 
 * 每个项目的 .CodeRecoder 文件夹结构：
 * 
 * .CodeRecoder/
 * ├── config/
 * │   ├── project.json          # 项目配置
 * │   ├── settings.json         # 用户设置
 * │   └── cache.json           # 缓存配置
 * ├── snapshots/
 * │   ├── files/               # 文件快照
 * │   │   ├── [sessionId]/
 * │   │   │   ├── [snapshotId]/
 * │   │   │   │   ├── content  # 文件内容
 * │   │   │   │   └── metadata.json
 * │   │   └── sessions.json    # 文件快照会话索引
 * │   ├── projects/            # 项目快照
 * │   │   ├── [snapshotId]/    # 完整项目副本
 * │   │   └── index.json       # 项目快照索引
 * │   └── snapshots.json       # 文件快照数据
 * ├── history/
 * │   ├── edits.json           # 编辑历史
 * │   └── sessions.json        # 会话历史
 * ├── analysis/
 * │   ├── ai_summaries.json    # AI分析缓存
 * │   └── code_metrics.json    # 代码指标
 * └── logs/
 *     ├── debug.log            # 调试日志
 *     └── error.log            # 错误日志
 */

export interface StructuredProjectConfig {
  projectName: string;
  projectRoot: string;
  language: string;
  activated: boolean;
  version: string;
  createdAt: number;
  lastActivated: number;
  features: {
    fileSnapshots: boolean;
    projectSnapshots: boolean;
    aiAnalysis: boolean;
    autoBackup: boolean;
  };
}

export interface ProjectSettings {
  maxFileSnapshots: number;
  maxProjectSnapshots: number;
  autoCleanup: boolean;
  autoCleanupDays: number;
  compressionEnabled: boolean;
  aiAnalysisEnabled: boolean;
  excludePatterns: string[];
}

export interface CacheConfig {
  totalSize: number;
  lastCleanup: number;
  compressionRatio: number;
  indexVersion: string;
}

export interface FileSnapshotIndex {
  sessionId: string;
  sessionName: string;
  createdAt: number;
  lastModified: number;
  snapshotCount: number;
  totalSize: number;
}

export interface ProjectSnapshotIndex {
  id: string;
  timestamp: number;
  saveNumber: number;
  type: 'full' | 'incremental';
  prompt: string;
  fileCount: number;
  totalSize: number;
  basedOn?: string; // 增量快照的基础快照ID
  serenaAnalysis?: any;
}

import fs from 'fs-extra';
import path from 'path';

export class DataStructureManager {
  private cacheDirectory: string;
  
  constructor(cacheDirectory: string) {
    this.cacheDirectory = cacheDirectory;
  }
  
  /**
   * 初始化项目数据结构
   */
  async initializeProjectStructure(projectConfig: StructuredProjectConfig): Promise<void> {
    const dirs = [
      'config',
      'snapshots/files',
      'snapshots/projects', 
      'history',
      'analysis',
      'logs'
    ];
    
    for (const dir of dirs) {
      await this.ensureDirectory(dir);
    }
    
    // 创建初始配置文件
    await this.saveProjectConfig(projectConfig);
    await this.saveProjectSettings(this.getDefaultSettings());
    await this.saveCacheConfig(this.getDefaultCacheConfig());
  }
  
  /**
   * 获取配置文件路径
   */
  getConfigPaths() {
    return {
      project: this.getPath('config/project.json'),
      settings: this.getPath('config/settings.json'),
      cache: this.getPath('config/cache.json'),
      fileSnapshots: this.getPath('snapshots/snapshots.json'),
      fileSessions: this.getPath('snapshots/files/sessions.json'),
      projectSnapshots: this.getPath('snapshots/projects/index.json'),
      history: this.getPath('history/edits.json'),
      sessions: this.getPath('history/sessions.json'),
      aiSummaries: this.getPath('analysis/ai_summaries.json'),
      codeMetrics: this.getPath('analysis/code_metrics.json')
    };
  }
  
  /**
   * 获取快照目录路径
   */
  getSnapshotPaths() {
    return {
      filesRoot: this.getPath('snapshots/files'),
      projectsRoot: this.getPath('snapshots/projects'),
      getFileSession: (sessionId: string) => this.getPath(`snapshots/files/${sessionId}`),
      getFileSnapshot: (sessionId: string, snapshotId: string) => 
        this.getPath(`snapshots/files/${sessionId}/${snapshotId}`),
      getProjectSnapshot: (snapshotId: string) => 
        this.getPath(`snapshots/projects/${snapshotId}`)
    };
  }
  
  private async ensureDirectory(relativePath: string): Promise<void> {
    const fullPath = this.getPath(relativePath);
    await fs.ensureDir(fullPath);
  }
  
  private getPath(relativePath: string): string {
    return path.join(this.cacheDirectory, relativePath);
  }
  
  private async saveProjectConfig(config: StructuredProjectConfig): Promise<void> {
    await fs.writeFile(this.getConfigPaths().project, JSON.stringify(config, null, 2));
  }
  
  private async saveProjectSettings(settings: ProjectSettings): Promise<void> {
    await fs.writeFile(this.getConfigPaths().settings, JSON.stringify(settings, null, 2));
  }
  
  private async saveCacheConfig(cache: CacheConfig): Promise<void> {
    await fs.writeFile(this.getConfigPaths().cache, JSON.stringify(cache, null, 2));
  }
  
  private getDefaultSettings(): ProjectSettings {
    return {
      maxFileSnapshots: 100,
      maxProjectSnapshots: 20,
      autoCleanup: true,
      autoCleanupDays: 30,
      compressionEnabled: true,
      aiAnalysisEnabled: true,
      excludePatterns: [
        '.git',
        'node_modules',
        '__pycache__',
        '*.pyc',
        '*.log',
        '.DS_Store',
        'dist',
        'build',
        '.vscode',
        '.idea'
      ]
    };
  }
  
  private getDefaultCacheConfig(): CacheConfig {
    return {
      totalSize: 0,
      lastCleanup: Date.now(),
      compressionRatio: 1.0,
      indexVersion: '1.0.0'
    };
  }
}
