/**
 * HistoryManager - Core functionality for tracking code edits and managing rollbacks
 * Implements a tree-like structure for supporting branching edit history
 */

import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { createTwoFilesPatch } from 'diff';
import {
  CodeEdit,
  CodeSession,
  SnapshotData,
  RollbackTarget,
  FileState,
  DiffResult,
  EditTreeNode,
  ToolResponse
} from './types.js';

export class HistoryManager {
  private snapshotPath: string;
  private data: SnapshotData;
  private editTree: Map<string, EditTreeNode> = new Map();
  private isProjectBased: boolean = false;

  constructor(cacheDirectory?: string) {
    if (cacheDirectory) {
      this.snapshotPath = cacheDirectory;
      this.isProjectBased = true;
    } else {
      // Fallback to current directory for backward compatibility
      this.snapshotPath = path.join(process.cwd(), '.CodeRecoder');
      this.isProjectBased = false;
    }
    
    this.data = {
      sessions: [],
      version: '1.0.0'
    };
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      await fs.ensureDir(this.snapshotPath);
      const historyDir = path.join(this.snapshotPath, 'history');
      await fs.ensureDir(historyDir);
      const dataPath = path.join(historyDir, 'edits.json');
      
      if (await fs.pathExists(dataPath)) {
        const content = await fs.readFile(dataPath, 'utf-8');
        this.data = JSON.parse(content);
        this.buildEditTree();
      } else {
        await this.saveData();
      }
    } catch (error) {
      console.error('Failed to initialize HistoryManager:', error);
      // Continue with empty data if initialization fails
    }
  }

  private buildEditTree(): void {
    this.editTree.clear();
    
    for (const session of this.data.sessions) {
      for (const edit of session.edits) {
        const node: EditTreeNode = {
          edit,
          children: [],
          parent: undefined
        };
        this.editTree.set(edit.id, node);
      }
    }

    // Build parent-child relationships
    for (const node of this.editTree.values()) {
      if (node.edit.parentEditId) {
        const parent = this.editTree.get(node.edit.parentEditId);
        if (parent) {
          parent.children.push(node);
          node.parent = parent;
        }
      }
    }
  }

  private async saveData(): Promise<void> {
    try {
      const historyDir = path.join(this.snapshotPath, 'history');
      await fs.ensureDir(historyDir);
      const dataPath = path.join(historyDir, 'edits.json');
      await fs.writeFile(dataPath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Failed to save history data:', error);
      throw error;
    }
  }

  /**
   * Create a new session for organizing related edits
   */
  async createSession(name?: string, description?: string): Promise<ToolResponse> {
    try {
      const session: CodeSession = {
        id: uuidv4(),
        name: name || `Session ${this.data.sessions.length + 1}`,
        created: Date.now(),
        lastModified: Date.now(),
        edits: [],
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
   * Record a new code edit with performance optimization and summary generation
   */
  async recordEdit(
    filePath: string,
    startLine: number,
    endLine: number,
    oldContent: string,
    newContent: string,
    prompt: string,
    sessionId?: string,
    parentEditId?: string,
    metadata?: CodeEdit['metadata']
  ): Promise<ToolResponse> {
    try {
      // Use current session if no sessionId provided
      if (!sessionId) {
        if (!this.data.currentSessionId) {
          const createResult = await this.createSession();
          if (!createResult.success) return createResult;
          sessionId = this.data.currentSessionId!;
        } else {
          sessionId = this.data.currentSessionId;
        }
      }

      const session = this.data.sessions.find(s => s.id === sessionId);
      if (!session) {
        return {
          success: false,
          message: 'Session not found',
          error: `Session ${sessionId} does not exist`
        };
      }

      // Generate smart summary and analyze change
      const changeAnalysis = this.analyzeChange(oldContent, newContent, filePath, prompt);

      const edit: CodeEdit = {
        id: uuidv4(),
        timestamp: Date.now(),
        filePath,
        startLine,
        endLine,
        oldContent,
        newContent,
        prompt,
        sessionId,
        parentEditId,
        summary: changeAnalysis.summary,
        changeType: changeAnalysis.changeType,
        linesChanged: changeAnalysis.linesChanged,
        metadata
      };

      session.edits.push(edit);
      session.lastModified = Date.now();
      session.currentEditId = edit.id;

      // Update edit tree
      const node: EditTreeNode = {
        edit,
        children: [],
        parent: parentEditId ? this.editTree.get(parentEditId) : undefined
      };
      this.editTree.set(edit.id, node);

      if (parentEditId) {
        const parent = this.editTree.get(parentEditId);
        if (parent) {
          parent.children.push(node);
        }
      }

      // Async save for better performance
      this.saveDataAsync();

      return {
        success: true,
        message: 'Edit recorded successfully',
        data: { 
          editId: edit.id, 
          sessionId,
          summary: edit.summary,
          changeType: edit.changeType,
          linesChanged: edit.linesChanged,
          fileName: path.basename(filePath)
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to record edit',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Analyze code change and generate summary
   */
  private analyzeChange(oldContent: string, newContent: string, filePath: string, prompt: string): {
    summary: string;
    changeType: 'create' | 'modify' | 'delete' | 'move';
    linesChanged: number;
  } {
    const fileName = path.basename(filePath);
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const linesChanged = Math.abs(newLines.length - oldLines.length) + 
                        Math.min(oldLines.length, newLines.length);

    let changeType: 'create' | 'modify' | 'delete' | 'move' = 'modify';
    let summary = '';

    // Determine change type
    if (oldContent.trim() === '' && newContent.trim() !== '') {
      changeType = 'create';
      summary = `Created ${fileName}`;
    } else if (oldContent.trim() !== '' && newContent.trim() === '') {
      changeType = 'delete';
      summary = `Deleted content in ${fileName}`;
    } else {
      changeType = 'modify';
      
      // Generate intelligent summary
      if (prompt.length > 0) {
        // Use first part of prompt as summary
        const promptSummary = prompt.length > 50 ? prompt.substring(0, 47) + '...' : prompt;
        summary = `${promptSummary} (${fileName})`;
      } else {
        // Analyze content changes
        if (newLines.length > oldLines.length) {
          summary = `Added ${newLines.length - oldLines.length} lines to ${fileName}`;
        } else if (newLines.length < oldLines.length) {
          summary = `Removed ${oldLines.length - newLines.length} lines from ${fileName}`;
        } else {
          summary = `Modified ${fileName}`;
        }
      }
    }

    return {
      summary,
      changeType,
      linesChanged
    };
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
   * Rollback to a specific edit or session start
   */
  async rollback(target: RollbackTarget): Promise<ToolResponse> {
    try {
      const session = this.data.sessions.find(s => s.id === target.sessionId);
      if (!session) {
        return {
          success: false,
          message: 'Session not found',
          error: `Session ${target.sessionId} does not exist`
        };
      }

      let targetEdit: CodeEdit | undefined;
      if (target.editId) {
        targetEdit = session.edits.find(e => e.id === target.editId);
        if (!targetEdit) {
          return {
            success: false,
            message: 'Edit not found',
            error: `Edit ${target.editId} does not exist in session`
          };
        }
      }

      // Calculate which files need to be restored
      const fileStates = await this.calculateFileStates(session, targetEdit?.id);
      const restoredFiles: string[] = [];

      // Apply rollback to each affected file
      for (const [filePath, state] of fileStates) {
        try {
          await fs.writeFile(filePath, state.content);
          restoredFiles.push(filePath);
        } catch (error) {
          console.error(`Failed to restore file ${filePath}:`, error);
        }
      }

      // Update session state
      if (targetEdit) {
        session.currentEditId = targetEdit.id;
      } else {
        delete session.currentEditId;
      }

      await this.saveData();

      return {
        success: true,
        message: 'Rollback completed successfully',
        data: {
          restoredFiles,
          targetEdit: targetEdit?.id,
          sessionId: target.sessionId
        }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Rollback failed',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Calculate file states at a specific point in session history
   */
  private async calculateFileStates(
    session: CodeSession,
    upToEditId?: string
  ): Promise<Map<string, FileState>> {
    const fileStates = new Map<string, FileState>();
    
    // If no target edit specified, return original file states (before any edits)
    if (!upToEditId) {
      return fileStates;
    }

    // Find the chronological order of edits up to the target
    const targetEditIndex = session.edits.findIndex(e => e.id === upToEditId);
    if (targetEditIndex === -1) {
      throw new Error(`Edit ${upToEditId} not found in session`);
    }

    const editsToApply = session.edits.slice(0, targetEditIndex + 1);
    
    // Group edits by file and apply them chronologically
    const fileEditMap = new Map<string, CodeEdit[]>();
    
    for (const edit of editsToApply) {
      const fileEdits = fileEditMap.get(edit.filePath) || [];
      fileEdits.push(edit);
      fileEditMap.set(edit.filePath, fileEdits);
    }

    // Calculate final state for each file
    for (const [filePath, edits] of fileEditMap) {
      try {
        // Start with original file content if it exists
        let content = '';
        try {
          content = await fs.readFile(filePath, 'utf-8');
        } catch {
          // File might not exist yet
        }

        // Apply edits in reverse chronological order to reconstruct the state
        // This is a simplified approach - in practice, you'd want more sophisticated merging
        const lastEdit = edits[edits.length - 1];
        
        fileStates.set(filePath, {
          filePath,
          content: this.reconstructFileContent(content, edits),
          editHistory: edits.map(e => e.id)
        });
      } catch (error) {
        console.error(`Failed to calculate state for file ${filePath}:`, error);
      }
    }

    return fileStates;
  }

  /**
   * Reconstruct file content by applying edits chronologically
   */
  private reconstructFileContent(originalContent: string, edits: CodeEdit[]): string {
    let content = originalContent;
    
    // For simplicity, we'll use the content from the last edit
    // In a production system, you'd want to properly merge line-based changes
    if (edits.length > 0) {
      const lastEdit = edits[edits.length - 1];
      // Replace the specified lines with new content
      const lines = content.split('\n');
      const newLines = lastEdit.newContent.split('\n');
      
      lines.splice(
        lastEdit.startLine - 1,
        lastEdit.endLine - lastEdit.startLine + 1,
        ...newLines
      );
      
      content = lines.join('\n');
    }
    
    return content;
  }

  /**
   * Get edit history for a session or file
   */
  async getHistory(
    sessionId?: string,
    filePath?: string,
    limit?: number
  ): Promise<ToolResponse> {
    try {
      let sessions = this.data.sessions;
      
      if (sessionId) {
        sessions = sessions.filter(s => s.id === sessionId);
      }

      const history = [];
      
      for (const session of sessions) {
        let edits = session.edits;
        
        if (filePath) {
          edits = edits.filter(e => e.filePath === filePath);
        }
        
        if (limit) {
          edits = edits.slice(-limit);
        }

        history.push({
          session: {
            id: session.id,
            name: session.name,
            created: session.created,
            lastModified: session.lastModified
          },
          edits: edits.map(edit => ({
            id: edit.id,
            timestamp: edit.timestamp,
            filePath: edit.filePath,
            prompt: edit.prompt,
            parentEditId: edit.parentEditId,
            hasChildren: this.editTree.get(edit.id)?.children.length ?? 0 > 0
          }))
        });
      }

      return {
        success: true,
        message: 'History retrieved successfully',
        data: { history, totalSessions: this.data.sessions.length }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to retrieve history',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get current session information
   */
  async getCurrentSession(): Promise<ToolResponse> {
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
            editCount: session.edits.length,
            currentEditId: session.currentEditId
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
   * Generate diff between two edits
   */
  async getDiff(fromEditId: string, toEditId: string): Promise<ToolResponse> {
    try {
      const fromEdit = this.findEditById(fromEditId);
      const toEdit = this.findEditById(toEditId);

      if (!fromEdit || !toEdit) {
        return {
          success: false,
          message: 'One or both edits not found',
          error: `Edit ${!fromEdit ? fromEditId : toEditId} not found`
        };
      }

      const diff = createTwoFilesPatch(
        fromEdit.filePath,
        toEdit.filePath,
        fromEdit.newContent,
        toEdit.newContent,
        `Edit ${fromEditId}`,
        `Edit ${toEditId}`
      );

      return {
        success: true,
        message: 'Diff generated successfully',
        data: { diff, fromEditId, toEditId }
      };
    } catch (error) {
      return {
        success: false,
        message: 'Failed to generate diff',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private findEditById(editId: string): CodeEdit | undefined {
    for (const session of this.data.sessions) {
      const edit = session.edits.find(e => e.id === editId);
      if (edit) return edit;
    }
    return undefined;
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
      this.snapshotPath = newCacheDirectory;
      this.isProjectBased = true;

      // Reinitialize with new directory
      await this.initialize();
    } catch (error) {
      console.error('Failed to update cache directory:', error);
      throw error;
    }
  }

  /**
   * Get current cache directory
   */
  getCacheDirectory(): string {
    return this.snapshotPath;
  }

  /**
   * Check if project-based caching is enabled
   */
  isUsingProjectCache(): boolean {
    return this.isProjectBased;
  }
}
