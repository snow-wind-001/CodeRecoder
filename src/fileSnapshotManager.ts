/**
 * FileSnapshotManager - High-performance file backup and restore system
 * Uses direct file copying instead of content analysis for maximum speed
 */

import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { AIAnalysisService } from './aiAnalysisService.js';

export interface FileSnapshot {
  id: string;
  timestamp: number;
  originalPath: string;
  snapshotPath: string;
  fileSize: number;
  fileHash: string;
  prompt: string;
  sessionId: string;
  parentSnapshotId?: string;
  // Enhanced with AI analysis
  aiSummary?: string;
  changeAnalysis?: {
    added: number;
    deleted: number;
    modified: number;
    complexity: 'low' | 'medium' | 'high';
    intent: string;
    impact: string;
  };
  metadata?: {
    model?: string;
    temperature?: number;
    tokens?: number;
    analysisTime?: string;
    serenaUsed?: boolean;
    llmUsed?: boolean;
    asyncAnalysis?: boolean; // P2: 标记分析是否异步进行
  };
}

export interface SnapshotSession {
  id: string;
  name?: string;
  created: number;
  lastModified: number;
  snapshots: FileSnapshot[];
  currentSnapshotId?: string;
  description?: string;
}

export interface SnapshotData {
  sessions: SnapshotSession[];
  currentSessionId?: string;
  version: string;
}

export interface SnapshotResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export class FileSnapshotManager {
  private cacheDirectory: string;
  private snapshotsDirectory: string;
  private data: SnapshotData;
  private isProjectBased: boolean = false;
  private aiAnalysisService: AIAnalysisService;
  
  // P0修复: 并发锁机制，防止数据竞争
  private operationLocks: Map<string, Promise<any>> = new Map();
  private globalLock: Promise<any> = Promise.resolve();

  constructor(cacheDirectory?: string) {
    if (cacheDirectory) {
      this.cacheDirectory = cacheDirectory;
      this.snapshotsDirectory = path.join(cacheDirectory, 'snapshots', 'files');
      this.isProjectBased = true;
    } else {
      // Fallback to current directory
      this.cacheDirectory = path.join(process.cwd(), '.CodeRecoder');
      this.snapshotsDirectory = path.join(this.cacheDirectory, 'snapshots', 'files');
      this.isProjectBased = false;
    }
    
    this.data = {
      sessions: [],
      version: '2.0.0'
    };
    
    // Initialize AI analysis service
    this.aiAnalysisService = new AIAnalysisService();
    
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await fs.ensureDir(this.cacheDirectory);
      await fs.ensureDir(this.snapshotsDirectory);
      
      const dataPath = path.join(this.cacheDirectory, 'snapshots', 'snapshots.json');
      
      if (await fs.pathExists(dataPath)) {
        const content = await fs.readFile(dataPath, 'utf-8');
        this.data = JSON.parse(content);
        const totalSnapshots = this.data.sessions.reduce((sum, s) => sum + s.snapshots.length, 0);
        console.error(`📊 加载文件快照: ${totalSnapshots}个快照`);
      } else {
        console.error(`📊 文件快照管理器: 快照文件不存在，创建新文件 ${dataPath}`);
        await this.saveData();
      }
    } catch (error) {
      console.error('Failed to initialize FileSnapshotManager:', error);
      // Continue with empty data if initialization fails
    }
  }

  /**
   * P1修复: 路径遍历安全验证
   * 确保路径在允许的范围内，防止路径遍历攻击
   */
  private validatePath(targetPath: string, allowedRoot?: string): { valid: boolean; error?: string } {
    try {
      const resolvedPath = path.resolve(targetPath);
      
      // 检查基本路径格式
      if (resolvedPath.includes('..')) {
        return { valid: false, error: '路径包含非法的父目录引用' };
      }
      
      // 检查是否是系统敏感路径
      const sensitivePatterns = ['/etc/', '/usr/', '/bin/', '/sbin/', '/boot/', '/root/', '/sys/', '/proc/'];
      for (const pattern of sensitivePatterns) {
        if (resolvedPath.startsWith(pattern)) {
          return { valid: false, error: `安全错误: 禁止访问系统路径 ${pattern}` };
        }
      }
      
      // 如果指定了允许的根目录，验证路径是否在其下
      if (allowedRoot) {
        const resolvedRoot = path.resolve(allowedRoot);
        if (!resolvedPath.startsWith(resolvedRoot)) {
          return { valid: false, error: `安全错误: 路径 "${targetPath}" 超出允许范围 "${allowedRoot}"` };
        }
      }
      
      return { valid: true };
    } catch (error) {
      return { valid: false, error: `路径验证失败: ${error}` };
    }
  }

  /**
   * P0修复: 使用锁保护异步操作，防止并发数据竞争
   */
  private async withLock<T>(lockKey: string, operation: () => Promise<T>): Promise<T> {
    const existingLock = this.operationLocks.get(lockKey) || Promise.resolve();
    
    const newLock = existingLock.then(async () => {
      return operation();
    }).catch(error => {
      throw error;
    });
    
    this.operationLocks.set(lockKey, newLock.catch(() => {})); // Store lock even on error
    return newLock;
  }

  private async saveData(): Promise<void> {
    // P0修复: 使用全局锁保护数据保存操作
    return this.withLock('save_data', async () => {
      try {
        const dataPath = path.join(this.cacheDirectory, 'snapshots', 'snapshots.json');
        console.error(`💾 准备保存数据到: ${dataPath}`);
        console.error(`📊 当前数据: 会话数=${this.data.sessions.length}, 总快照数=${this.data.sessions.reduce((sum, s) => sum + s.snapshots.length, 0)}`);
        await fs.writeFile(dataPath, JSON.stringify(this.data, null, 2));
        console.error(`✅ 数据保存成功`);
      } catch (error) {
        console.error('Failed to save snapshot data:', error);
        throw error;
      }
    });
  }

  /**
   * Create a new session for organizing related snapshots
   */
  async createSession(name?: string, description?: string): Promise<SnapshotResponse> {
    try {
      const session: SnapshotSession = {
        id: uuidv4(),
        name: name || `Session ${this.data.sessions.length + 1}`,
        created: Date.now(),
        lastModified: Date.now(),
        snapshots: [],
        description
      };

      this.data.sessions.push(session);
      this.data.currentSessionId = session.id;
      await this.saveData();

      return {
        success: true,
        message: 'Session created successfully',
        data: { sessionId: session.id, sessionName: session.name }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create session',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Create a file snapshot with AI analysis - ENHANCED VERSION
   */
  async createSnapshot(
    filePath: string,
    prompt: string,
    sessionId?: string,
    parentSnapshotId?: string,
    metadata?: FileSnapshot['metadata']
  ): Promise<SnapshotResponse> {
    const startTime = Date.now();
    
    try {
      // 验证缓存目录是否正确
      if (!this.cacheDirectory || this.cacheDirectory.includes('CodeRecoder/.CodeRecoder')) {
        // 尝试从文件路径推断正确的项目根目录
        const projectRoot = await this.inferProjectRoot(filePath);
        if (projectRoot) {
          await this.updateCacheDirectory(path.join(projectRoot, '.CodeRecoder'));
        }
      }

      // Ensure session exists
      if (!sessionId) {
        if (!this.data.currentSessionId) {
          const createResult = await this.createSession();
          if (!createResult.success) return createResult;
          sessionId = this.data.currentSessionId!;
        } else {
          sessionId = this.data.currentSessionId;
        }
      }

      let session = this.data.sessions.find(s => s.id === sessionId);
      if (!session) {
        return {
          success: false,
          message: 'Session not found',
          error: `Session ${sessionId} does not exist`
        };
      }

      // 确保使用this.data中的会话引用
      const sessionIndex = this.data.sessions.findIndex(s => s.id === sessionId);
      if (sessionIndex === -1) {
        return {
          success: false,
          message: 'Session index not found',
          error: `Session ${sessionId} index not found`
        };
      }
      session = this.data.sessions[sessionIndex];

      // Check if file exists
      if (!(await fs.pathExists(filePath))) {
        return {
          success: false,
          message: 'File not found',
          error: `File ${filePath} does not exist`
        };
      }

      // P2优化: 先快速创建快照，然后异步进行AI分析
      // Step 1: Create file snapshot FIRST (fast file operations)
      const snapshotId = uuidv4();
      const snapshotDir = path.join(this.snapshotsDirectory, snapshotId);
      const fileName = path.basename(filePath);
      const snapshotFilePath = path.join(snapshotDir, fileName);

      // Get file stats for quick comparison
      const stats = await fs.stat(filePath);
      const fileContent = await fs.readFile(filePath);
      const fileHash = createHash('sha256').update(fileContent).digest('hex');

      // Create snapshot directory and copy file IMMEDIATELY
      await fs.ensureDir(snapshotDir);
      await fs.copy(filePath, snapshotFilePath);

      // 初始化基本元数据（稍后由异步分析更新）
      let aiSummary = prompt;
      let changeAnalysis = undefined;
      let enhancedMetadata = { ...metadata, asyncAnalysis: true };

      // Create initial metadata file
      const metadataPath = path.join(snapshotDir, 'metadata.json');
      const snapshotMetadata = {
        originalPath: filePath,
        snapshotPath: snapshotFilePath,
        timestamp: Date.now(),
        fileSize: stats.size,
        fileHash,
        prompt,
        aiSummary,
        changeAnalysis,
        sessionId,
        parentSnapshotId,
        metadata: enhancedMetadata
      };
      await fs.writeFile(metadataPath, JSON.stringify(snapshotMetadata, null, 2));

      // Create initial snapshot record
      const snapshot: FileSnapshot = {
        id: snapshotId,
        timestamp: Date.now(),
        originalPath: filePath,
        snapshotPath: snapshotFilePath,
        fileSize: stats.size,
        fileHash,
        prompt,
        aiSummary,
        changeAnalysis,
        sessionId,
        parentSnapshotId,
        metadata: enhancedMetadata
      };

      // Legacy local diff summary runs asynchronously; no AI provider is implied.
      this.runAsyncAnalysis(snapshotId, filePath, prompt, snapshotDir, sessionIndex).catch(err => {
        console.warn(`⚠️ 异步本地差异分析失败: ${err.message}`);
      });

      // Add snapshot to session - 直接修改this.data中的对象
      this.data.sessions[sessionIndex].snapshots.push(snapshot);
      this.data.sessions[sessionIndex].lastModified = Date.now();
      this.data.sessions[sessionIndex].currentSnapshotId = snapshot.id;

      console.error(`💾 保存快照数据: 会话 ${sessionId}, 快照数量: ${this.data.sessions[sessionIndex].snapshots.length}`);
      console.error(`🔍 验证数据结构: sessions=${this.data.sessions.length}, 当前会话快照=${this.data.sessions[sessionIndex].snapshots.length}`);

      // Save immediately to ensure data consistency
      await this.saveData();
      
      // 验证保存
      console.error(`✅ 快照数据已保存到: ${path.join(this.cacheDirectory, 'snapshots', 'snapshots.json')}`);

      const processingTime = Date.now() - startTime;

      console.error(`📸 快照创建完成: ${processingTime}ms`);

      return {
        success: true,
        message: 'Legacy file snapshot created successfully',
        data: { 
          snapshotId: snapshot.id, 
          sessionId,
          fileName: path.basename(filePath),
          fileSize: stats.size,
          processingTime: `${processingTime}ms`,
          aiSummary,
          changeAnalysis,
          originalPrompt: prompt,
          aiAnalysisAvailable: false,
          analysisMode: 'local-diff-only',
          asyncAnalysisPending: true
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to create legacy file snapshot',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * P2优化: 异步后台AI分析
   * 快照创建后在后台运行，不阻塞主流程
   */
  private async runAsyncAnalysis(
    snapshotId: string,
    filePath: string,
    prompt: string,
    snapshotDir: string,
    sessionIndex: number
  ): Promise<void> {
    try {
      console.error(`🔍 开始异步本地差异分析: ${path.basename(filePath)}...`);
      
      const analysisResult = await this.aiAnalysisService.analyzeCodeChanges(
        filePath,
        undefined,
        prompt,
        { useSerena: false, useLLM: false }
      );

      if (analysisResult.success) {
        // 更新快照记录
        const snapshot = this.data.sessions[sessionIndex]?.snapshots.find(s => s.id === snapshotId);
        if (snapshot) {
          snapshot.aiSummary = analysisResult.summary;
          snapshot.changeAnalysis = {
            added: analysisResult.changes.added,
            deleted: analysisResult.changes.deleted,
            modified: analysisResult.changes.modified,
            complexity: analysisResult.aiAnalysis?.complexity || 'medium',
            intent: analysisResult.aiAnalysis?.intent || '代码修改',
            impact: analysisResult.aiAnalysis?.impact || '局部影响'
          };
          snapshot.metadata = {
            ...snapshot.metadata,
            analysisTime: (analysisResult as any).metadata?.processingTime,
            serenaUsed: (analysisResult as any).metadata?.serenaUsed || false,
            llmUsed: (analysisResult as any).metadata?.llmUsed || false,
            asyncAnalysis: false // Analysis completed
          };

          // 更新元数据文件
          const metadataPath = path.join(snapshotDir, 'metadata.json');
          await fs.writeFile(metadataPath, JSON.stringify({
            ...snapshot,
            originalPath: snapshot.originalPath,
            snapshotPath: snapshot.snapshotPath
          }, null, 2));

          // 保存diff
          if (analysisResult.diffText) {
            const diffPath = path.join(snapshotDir, 'diff.txt');
            await fs.writeFile(diffPath, analysisResult.diffText);
          }

          await this.saveData();
          console.error(`✅ 异步本地差异分析完成: ${analysisResult.summary}`);
        }
      } else {
        console.error(`⚠️ 异步本地差异分析失败: ${analysisResult.error}`);
      }
    } catch (error) {
      console.warn(`⚠️ 异步本地差异分析异常: ${error}`);
    }
  }

  /**
   * Restore file from snapshot - HIGH PERFORMANCE VERSION
   */
  async restoreSnapshot(snapshotId: string): Promise<SnapshotResponse> {
    const startTime = Date.now();
    
    try {
      // Find snapshot
      let targetSnapshot: FileSnapshot | undefined;
      let targetSession: SnapshotSession | undefined;

      for (const session of this.data.sessions) {
        const snapshot = session.snapshots.find(s => s.id === snapshotId);
        if (snapshot) {
          targetSnapshot = snapshot;
          targetSession = session;
          break;
        }
      }

      if (!targetSnapshot || !targetSession) {
        return {
          success: false,
          message: 'Snapshot not found',
          error: `Snapshot ${snapshotId} does not exist`
        };
      }

      // Check if snapshot file exists
      if (!(await fs.pathExists(targetSnapshot.snapshotPath))) {
        return {
          success: false,
          message: 'Snapshot file not found',
          error: `Snapshot file ${targetSnapshot.snapshotPath} is missing`
        };
      }

      // Quick validation - compare file size and hash
      const snapshotStats = await fs.stat(targetSnapshot.snapshotPath);
      if (snapshotStats.size !== targetSnapshot.fileSize) {
        return {
          success: false,
          message: 'Snapshot file corrupted',
          error: 'File size mismatch'
        };
      }

      // P1修复: 路径安全验证
      const pathValidation = this.validatePath(targetSnapshot.originalPath);
      if (!pathValidation.valid) {
        return {
          success: false,
          message: '路径安全验证失败',
          error: pathValidation.error
        };
      }

      // Create backup of current file if it exists
      const backupPath = `${targetSnapshot.originalPath}.backup.${Date.now()}`;
      if (await fs.pathExists(targetSnapshot.originalPath)) {
        await fs.copy(targetSnapshot.originalPath, backupPath);
      }

      // Ensure target directory exists
      await fs.ensureDir(path.dirname(targetSnapshot.originalPath));

      // Restore file - simple copy operation
      await fs.copy(targetSnapshot.snapshotPath, targetSnapshot.originalPath);

      // Update session state
      targetSession.currentSnapshotId = snapshotId;
      await this.saveData();

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        message: 'File restored successfully',
        data: {
          snapshotId,
          filePath: targetSnapshot.originalPath,
          fileSize: targetSnapshot.fileSize,
          processingTime: `${processingTime}ms`,
          backupCreated: await fs.pathExists(backupPath) ? backupPath : null,
          restoredFrom: targetSnapshot.snapshotPath
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to restore snapshot',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * List snapshots with quick summary
   */
  async listSnapshots(
    sessionId?: string,
    filePath?: string,
    limit?: number
  ): Promise<SnapshotResponse> {
    try {
      let sessions = this.data.sessions;
      
      if (sessionId) {
        sessions = sessions.filter(s => s.id === sessionId);
      }

      const snapshotList = [];
      
      for (const session of sessions) {
        let snapshots = session.snapshots;
        
        if (filePath) {
          snapshots = snapshots.filter(s => s.originalPath === filePath);
        }
        
        if (limit) {
          snapshots = snapshots.slice(-limit);
        }

        for (const snapshot of snapshots) {
          // Quick file existence check
          const exists = await fs.pathExists(snapshot.snapshotPath);
          
          snapshotList.push({
            id: snapshot.id,
            timestamp: snapshot.timestamp,
            filePath: snapshot.originalPath,
            fileName: path.basename(snapshot.originalPath),
            prompt: snapshot.prompt,
            aiSummary: snapshot.aiSummary || snapshot.prompt,
            fileSize: snapshot.fileSize,
            sessionName: session.name,
            sessionId: session.id,
            snapshotExists: exists,
            hasParent: !!snapshot.parentSnapshotId,
            // Enhanced AI analysis data
            changeAnalysis: snapshot.changeAnalysis,
            complexity: snapshot.changeAnalysis?.complexity || 'medium',
            intent: snapshot.changeAnalysis?.intent || '代码修改',
            impact: snapshot.changeAnalysis?.impact || '局部影响',
            aiEnhanced: !!(snapshot.aiSummary || snapshot.changeAnalysis),
            serenaUsed: snapshot.metadata?.serenaUsed || false,
            llmUsed: snapshot.metadata?.llmUsed || false
          });
        }
      }

      // Sort by timestamp (newest first)
      snapshotList.sort((a, b) => b.timestamp - a.timestamp);

      return {
        success: true,
        message: 'Snapshots retrieved successfully',
        data: { 
          snapshots: snapshotList,
          totalSessions: this.data.sessions.length,
          totalSnapshots: snapshotList.length
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to retrieve snapshots',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Delete a specific snapshot
   */
  async deleteSnapshot(snapshotId: string): Promise<SnapshotResponse> {
    try {
      // Find the snapshot
      let targetSnapshot: FileSnapshot | undefined;
      let targetSession: SnapshotSession | undefined;
      let snapshotIndex = -1;

      for (const session of this.data.sessions) {
        snapshotIndex = session.snapshots.findIndex(s => s.id === snapshotId);
        if (snapshotIndex !== -1) {
          targetSnapshot = session.snapshots[snapshotIndex];
          targetSession = session;
          break;
        }
      }

      if (!targetSnapshot || !targetSession) {
        return {
          success: false,
          message: 'Snapshot not found',
          error: `Snapshot ${snapshotId} does not exist`
        };
      }

      // Delete snapshot files
      const snapshotDir = path.join(this.cacheDirectory, 'snapshots', snapshotId);
      if (await fs.pathExists(snapshotDir)) {
        await fs.remove(snapshotDir);
        console.error(`🗑️ 已删除快照文件夹: ${snapshotDir}`);
      }

      // Remove from session
      targetSession.snapshots.splice(snapshotIndex, 1);
      targetSession.lastModified = Date.now();

      // Update current snapshot ID if necessary
      if (targetSession.currentSnapshotId === snapshotId) {
        targetSession.currentSnapshotId = targetSession.snapshots.length > 0 
          ? targetSession.snapshots[targetSession.snapshots.length - 1].id 
          : undefined;
      }

      // Save data
      await this.saveData();

      return {
        success: true,
        message: 'Snapshot deleted successfully',
        data: {
          deletedSnapshotId: snapshotId,
          fileName: path.basename(targetSnapshot.originalPath),
          sessionId: targetSession.id,
          remainingSnapshots: targetSession.snapshots.length
        }
      };

    } catch (error) {
      console.error('Failed to delete snapshot:', error);
      return {
        success: false,
        message: 'Failed to delete snapshot',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get current session information
   */
  async getCurrentSession(): Promise<SnapshotResponse> {
    try {
      if (!this.data.currentSessionId) {
        return {
          success: true,
          message: 'No active session',
          data: { currentSession: null }
        };
      }

      const session = this.data.sessions.find(s => s.id === this.data.currentSessionId);
      if (!session) {
        return {
          success: false,
          message: 'Current session not found',
          error: 'Current session ID is invalid'
        };
      }

      return {
        success: true,
        message: 'Current session retrieved',
        data: {
          currentSession: {
            id: session.id,
            name: session.name,
            created: session.created,
            lastModified: session.lastModified,
            snapshotCount: session.snapshots.length,
            currentSnapshotId: session.currentSnapshotId
          }
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to get current session',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Update cache directory (when project is activated/deactivated)
   */
  async updateCacheDirectory(newCacheDirectory: string): Promise<void> {
    try {
      // Save current data if we have any
      if (this.data.sessions.length > 0) {
        await this.saveData();
      }

      // Update cache directory
      this.cacheDirectory = newCacheDirectory;
      this.snapshotsDirectory = path.join(newCacheDirectory, 'snapshots');
      this.isProjectBased = true;

      // Reinitialize with new directory
      await this.initialize();
    } catch (error) {
      console.error('Failed to update cache directory:', error);
      throw error;
    }
  }

  /**
   * Get cache directory
   */
  getCacheDirectory(): string {
    return this.cacheDirectory;
  }

  /**
   * Check if project-based caching is enabled
   */
  isUsingProjectCache(): boolean {
    return this.isProjectBased;
  }

  /**
   * 从文件路径推断项目根目录
   */
  private async inferProjectRoot(filePath: string): Promise<string | null> {
    try {
      let currentDir = path.dirname(filePath);
      
      // 向上搜索，寻找项目根目录标识符
      const maxDepth = 10; // 防止无限循环
      for (let i = 0; i < maxDepth; i++) {
        // 检查常见的项目根目录标识符
        const indicators = [
          'package.json',
          'requirements.txt', 
          '.git',
          'Cargo.toml',
          'go.mod',
          'pom.xml',
          'README.md'
        ];
        
        for (const indicator of indicators) {
          if (await fs.pathExists(path.join(currentDir, indicator))) {
            return currentDir;
          }
        }
        
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
          // 已到达文件系统根目录
          break;
        }
        currentDir = parentDir;
      }
      
      // 如果没有找到项目根目录，使用文件所在目录
      return path.dirname(filePath);
      
    } catch (error) {
      console.error('推断项目根目录时出错:', error);
      return null;
    }
  }

  /**
   * Async save for better performance
   */
  private saveDataAsync(): void {
    // Don't await to improve performance
    this.saveData().catch(error => {
      console.error('Background save failed:', error);
    });
  }

  /**
   * Cleanup old snapshots to save disk space
   */
  async cleanupOldSnapshots(keepLatest: number = 100): Promise<SnapshotResponse> {
    try {
      let totalCleaned = 0;
      let totalSizeSaved = 0;

      for (const session of this.data.sessions) {
        if (session.snapshots.length > keepLatest) {
          // Sort by timestamp and keep only the latest ones
          session.snapshots.sort((a, b) => b.timestamp - a.timestamp);
          const toDelete = session.snapshots.slice(keepLatest);
          
          for (const snapshot of toDelete) {
            try {
              const snapshotDir = path.dirname(snapshot.snapshotPath);
              if (await fs.pathExists(snapshotDir)) {
                const stats = await fs.stat(snapshot.snapshotPath);
                totalSizeSaved += stats.size;
                await fs.remove(snapshotDir);
                totalCleaned++;
              }
            } catch (error) {
              console.error(`Failed to cleanup snapshot ${snapshot.id}:`, error);
            }
          }

          // Update session snapshots
          session.snapshots = session.snapshots.slice(0, keepLatest);
        }
      }

      await this.saveData();

      return {
        success: true,
        message: 'Cleanup completed successfully',
        data: {
          snapshotsCleaned: totalCleaned,
          spaceSaved: `${(totalSizeSaved / 1024 / 1024).toFixed(2)} MB`,
          remainingSnapshots: this.data.sessions.reduce((sum, s) => sum + s.snapshots.length, 0)
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Cleanup failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}
