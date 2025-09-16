/**
 * Core types for CodeRecoder MCP - Multi-round code generation with rollback
 */

export interface ProjectConfig {
  projectName: string;
  projectRoot: string;
  language?: string;
  activated: boolean;
  createdAt: number;
  lastUsed: number;
  settings?: {
    autoSave?: boolean;
    maxHistorySize?: number;
    compressionEnabled?: boolean;
  };
}

export interface WorkspaceInfo {
  currentProject?: ProjectConfig;
  availableProjects: ProjectConfig[];
  cacheDirectory: string;
}

export interface CodeEdit {
  id: string;
  timestamp: number;
  filePath: string;
  startLine: number;
  endLine: number;
  oldContent: string;
  newContent: string;
  prompt: string;
  sessionId: string;
  parentEditId?: string; // For branching support
  summary?: string; // Auto-generated summary for quick identification
  changeType?: 'create' | 'modify' | 'delete' | 'move'; // Type of change
  linesChanged?: number; // Number of lines affected
  metadata?: {
    model?: string;
    temperature?: number;
    tokens?: number;
  };
}

export interface CodeSession {
  id: string;
  name?: string;
  created: number;
  lastModified: number;
  edits: CodeEdit[];
  currentEditId?: string;
  description?: string;
}

export interface SnapshotData {
  sessions: CodeSession[];
  currentSessionId?: string;
  version: string;
}

export interface RollbackTarget {
  sessionId: string;
  editId?: string; // If not provided, rollback to session start
}

export interface FileState {
  filePath: string;
  content: string;
  editHistory: string[]; // Edit IDs that affected this file
}

export interface DiffResult {
  added: string[];
  removed: string[];
  modified: Array<{
    line: number;
    oldContent: string;
    newContent: string;
  }>;
}

export interface GenerationContext {
  filePath: string;
  cursorPosition?: {
    line: number;
    character: number;
  };
  selectedText?: string;
  contextLines?: {
    before: number;
    after: number;
  };
}

export interface ToolResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export interface EditTreeNode {
  edit: CodeEdit;
  children: EditTreeNode[];
  parent?: EditTreeNode;
}

// MCP Tool parameter types
export interface RecordEditParams {
  filePath: string;
  startLine: number;
  endLine: number;
  oldContent: string;
  newContent: string;
  prompt: string;
  sessionId?: string;
  metadata?: CodeEdit['metadata'];
}

export interface RollbackParams {
  target: RollbackTarget;
}

export interface ListHistoryParams {
  sessionId?: string;
  filePath?: string;
  limit?: number;
}

export interface CreateSessionParams {
  name?: string;
  description?: string;
}

export interface GetFileStateParams {
  filePath: string;
  editId?: string; // Get file state at specific edit
}

export interface GetDiffParams {
  fromEditId: string;
  toEditId: string;
  filePath?: string;
}

// Project management parameter types
export interface ActivateProjectParams {
  projectPath: string;
  projectName?: string;
  language?: string;
  autoLaunchGUI?: boolean;
}

export interface ListProjectsParams {
  // No parameters needed
}

export interface GetProjectInfoParams {
  projectPath?: string; // If not provided, return current project
}

export interface DeactivateProjectParams {
  saveHistory?: boolean;
}
