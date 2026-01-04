/**
 * ProjectManager - Handles project activation and workspace management
 * Similar to Serena's project activation system
 */

import fs from 'fs-extra';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import {
  ProjectConfig,
  WorkspaceInfo,
  ToolResponse
} from './types.js';
import { DataStructureManager, StructuredProjectConfig } from './dataStructure.js';

export class ProjectManager {
  private globalConfigPath: string;
  private workspaceInfo: WorkspaceInfo;
  private currentProjectRoot: string = '';
  private dataStructureManager?: DataStructureManager;
  
  // P0修复: 初始化状态管理，防止竞态条件
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    // Global config stored in user's home directory
    this.globalConfigPath = path.join(process.env.HOME || process.cwd(), '.coderecoder-global');
    this.workspaceInfo = {
      availableProjects: [],
      cacheDirectory: ''
    };
    // 启动异步初始化（不阻塞构造函数）
    this.initPromise = this.initialize();
  }

  /**
   * P0修复: 确保初始化完成后再执行操作
   * 所有公共方法应先调用此方法
   */
  async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    if (this.initPromise) {
      await this.initPromise;
    }
  }

  private async initialize(): Promise<void> {
    try {
      await fs.ensureDir(this.globalConfigPath);
      const configFile = path.join(this.globalConfigPath, 'workspace.json');
      
      if (await fs.pathExists(configFile)) {
        const content = await fs.readFile(configFile, 'utf-8');
        this.workspaceInfo = JSON.parse(content);
        
        // 恢复当前项目状态
        if (this.workspaceInfo.currentProject) {
          this.currentProjectRoot = this.workspaceInfo.currentProject.projectRoot;
          console.error(`📂 恢复当前项目: ${this.workspaceInfo.currentProject.projectName}`);
        }
      } else {
        await this.saveWorkspaceInfo();
      }
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize ProjectManager:', error);
      this.initialized = true; // Mark as initialized even on error to prevent infinite waiting
    }
  }

  private async saveWorkspaceInfo(): Promise<void> {
    try {
      const configFile = path.join(this.globalConfigPath, 'workspace.json');
      await fs.writeFile(configFile, JSON.stringify(this.workspaceInfo, null, 2));
    } catch (error) {
      console.error('Failed to save workspace info:', error);
      throw error;
    }
  }

  /**
   * Activate a project - creates .CodeRecoder directory and sets up caching
   */
  async activateProject(
    projectPath: string,
    projectName?: string,
    language?: string
  ): Promise<ToolResponse> {
    // P0修复: 确保初始化完成
    await this.ensureInitialized();
    
    try {
      // Resolve absolute path
      const resolvedPath = path.resolve(projectPath);
      
      // Check if directory exists
      if (!(await fs.pathExists(resolvedPath))) {
        return {
          success: false,
          message: 'Project directory does not exist',
          error: `Directory ${resolvedPath} not found`
        };
      }

      // Check if it's a valid project directory
      const isValidProject = await this.validateProjectDirectory(resolvedPath);
      if (!isValidProject.valid) {
        return {
          success: false,
          message: 'Invalid project directory',
          error: isValidProject.reason
        };
      }

      // Create .CodeRecoder cache directory
      const cacheDir = path.join(resolvedPath, '.CodeRecoder');
      await fs.ensureDir(cacheDir);

      // 初始化结构化数据管理器
      this.dataStructureManager = new DataStructureManager(cacheDir);
      await this.initializeStructuredData(resolvedPath, projectName || path.basename(resolvedPath), language || await this.detectProjectLanguage(resolvedPath));

      // Generate or update project config
      const existingProject = this.workspaceInfo.availableProjects.find(
        p => p.projectRoot === resolvedPath
      );

      const projectConfig: ProjectConfig = {
        projectName: projectName || existingProject?.projectName || path.basename(resolvedPath),
        projectRoot: resolvedPath,
        language: language || await this.detectProjectLanguage(resolvedPath),
        activated: true,
        createdAt: existingProject?.createdAt || Date.now(),
        lastUsed: Date.now(),
        settings: {
          autoSave: true,
          maxHistorySize: 1000,
          compressionEnabled: true,
          ...existingProject?.settings
        }
      };

      // Deactivate current project if any
      if (this.workspaceInfo.currentProject) {
        await this.deactivateCurrentProject(false);
      }

      // Update workspace info
      this.workspaceInfo.currentProject = projectConfig;
      this.workspaceInfo.cacheDirectory = cacheDir;

      // Update or add to available projects
      const projectIndex = this.workspaceInfo.availableProjects.findIndex(
        p => p.projectRoot === resolvedPath
      );

      if (projectIndex >= 0) {
        this.workspaceInfo.availableProjects[projectIndex] = projectConfig;
      } else {
        this.workspaceInfo.availableProjects.push(projectConfig);
      }

      // Save project-specific config
      await this.saveProjectConfig(projectConfig);
      await this.saveWorkspaceInfo();

      // Update current project root
      this.setCurrentProjectRoot(projectConfig.projectRoot);

      return {
        success: true,
        message: 'Project activated successfully',
        data: {
          projectName: projectConfig.projectName,
          projectRoot: projectConfig.projectRoot,
          cacheDirectory: cacheDir,
          language: projectConfig.language
        }
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to activate project',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Deactivate current project
   */
  async deactivateProject(saveHistory: boolean = true): Promise<ToolResponse> {
    // P0修复: 确保初始化完成
    await this.ensureInitialized();
    
    try {
      if (!this.workspaceInfo.currentProject) {
        return {
          success: true,
          message: 'No active project to deactivate',
          data: { hadActiveProject: false }
        };
      }

      const currentProject = this.workspaceInfo.currentProject;

      if (saveHistory) {
        // Save current state to project cache
        await this.saveProjectConfig(currentProject);
      }

      // Mark as deactivated
      currentProject.activated = false;
      
      // Update in available projects list
      const projectIndex = this.workspaceInfo.availableProjects.findIndex(
        p => p.projectRoot === currentProject.projectRoot
      );
      if (projectIndex >= 0) {
        this.workspaceInfo.availableProjects[projectIndex] = currentProject;
      }

      // Clear current project
      this.workspaceInfo.currentProject = undefined;
      this.workspaceInfo.cacheDirectory = '';

      await this.saveWorkspaceInfo();

      return {
        success: true,
        message: 'Project deactivated successfully',
        data: {
          deactivatedProject: currentProject.projectName,
          historySaved: saveHistory
        }
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to deactivate project',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async deactivateCurrentProject(saveHistory: boolean): Promise<void> {
    await this.deactivateProject(saveHistory);
  }

  /**
   * List all available projects
   */
  async listProjects(): Promise<ToolResponse> {
    // P0修复: 确保初始化完成
    await this.ensureInitialized();
    
    try {
      const projects = this.workspaceInfo.availableProjects.map(project => ({
        name: project.projectName,
        path: project.projectRoot,
        language: project.language,
        activated: project.activated,
        lastUsed: project.lastUsed,
        createdAt: project.createdAt
      }));

      return {
        success: true,
        message: 'Projects listed successfully',
        data: {
          currentProject: this.workspaceInfo.currentProject ? {
            name: this.workspaceInfo.currentProject.projectName,
            path: this.workspaceInfo.currentProject.projectRoot
          } : null,
          availableProjects: projects,
          totalProjects: projects.length
        }
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to list projects',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get current project information
   */
  async getProjectInfo(projectPath?: string): Promise<ToolResponse> {
    // P0修复: 确保初始化完成
    await this.ensureInitialized();
    
    try {
      let targetProject: ProjectConfig | undefined;

      if (projectPath) {
        const resolvedPath = path.resolve(projectPath);
        targetProject = this.workspaceInfo.availableProjects.find(
          p => p.projectRoot === resolvedPath
        );
      } else {
        targetProject = this.workspaceInfo.currentProject;
      }

      if (!targetProject) {
        return {
          success: false,
          message: projectPath ? 'Project not found' : 'No active project',
          error: projectPath ? `Project at ${projectPath} not found` : 'No project is currently activated'
        };
      }

      // Check if project directory still exists
      const dirExists = await fs.pathExists(targetProject.projectRoot);
      const cacheDir = path.join(targetProject.projectRoot, '.CodeRecoder');
      const cacheDirExists = await fs.pathExists(cacheDir);

      return {
        success: true,
        message: 'Project information retrieved',
        data: {
          project: {
            name: targetProject.projectName,
            path: targetProject.projectRoot,
            language: targetProject.language,
            activated: targetProject.activated,
            createdAt: targetProject.createdAt,
            lastUsed: targetProject.lastUsed,
            settings: targetProject.settings
          },
          status: {
            directoryExists: dirExists,
            cacheDirectoryExists: cacheDirExists,
            isCurrentProject: targetProject === this.workspaceInfo.currentProject
          },
          cacheDirectory: cacheDir
        }
      };

    } catch (error) {
      return {
        success: false,
        message: 'Failed to get project info',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Get current project's cache directory
   */
  getCurrentCacheDirectory(): string {
    return this.workspaceInfo.cacheDirectory;
  }

  /**
   * Check if a project is currently activated
   */
  hasActiveProject(): boolean {
    return !!this.workspaceInfo.currentProject;
  }

  /**
   * Get current project config
   */
  getCurrentProject(): ProjectConfig | undefined {
    return this.workspaceInfo.currentProject;
  }

  /**
   * Validate if a directory is a valid project
   */
  private async validateProjectDirectory(dirPath: string): Promise<{ valid: boolean; reason?: string }> {
    try {
      const stat = await fs.stat(dirPath);
      if (!stat.isDirectory()) {
        return { valid: false, reason: 'Path is not a directory' };
      }

      // Check for common project indicators
      const projectIndicators = [
        'package.json',
        'pyproject.toml',
        'requirements.txt',
        'Cargo.toml',
        'pom.xml',
        'build.gradle',
        '.git',
        'go.mod',
        'composer.json',
        'Gemfile',
        'CMakeLists.txt'
      ];

      const files = await fs.readdir(dirPath);
      const hasProjectIndicator = projectIndicators.some(indicator => 
        files.includes(indicator)
      );

      if (!hasProjectIndicator) {
        return { 
          valid: false, 
          reason: 'Directory does not appear to be a project (no package.json, .git, etc.)' 
        };
      }

      return { valid: true };

    } catch (error) {
      return { 
        valid: false, 
        reason: `Cannot access directory: ${error instanceof Error ? error.message : String(error)}` 
      };
    }
  }

  /**
   * Detect project language based on files
   */
  private async detectProjectLanguage(dirPath: string): Promise<string> {
    try {
      const files = await fs.readdir(dirPath);
      
      // Language detection rules
      const languageRules = [
        { files: ['package.json'], language: 'javascript' },
        { files: ['tsconfig.json'], language: 'typescript' },
        { files: ['pyproject.toml', 'requirements.txt', 'setup.py'], language: 'python' },
        { files: ['Cargo.toml'], language: 'rust' },
        { files: ['pom.xml'], language: 'java' },
        { files: ['build.gradle', 'build.gradle.kts'], language: 'java' },
        { files: ['go.mod'], language: 'go' },
        { files: ['composer.json'], language: 'php' },
        { files: ['Gemfile'], language: 'ruby' },
        { files: ['CMakeLists.txt'], language: 'cpp' }
      ];

      for (const rule of languageRules) {
        if (rule.files.some(file => files.includes(file))) {
          return rule.language;
        }
      }

      return 'unknown';

    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Save project-specific configuration
   */
  private async saveProjectConfig(project: ProjectConfig): Promise<void> {
    try {
      const cacheDir = path.join(project.projectRoot, '.CodeRecoder');
      await fs.ensureDir(cacheDir);
      
      const configFile = path.join(cacheDir, 'project.json');
      await fs.writeFile(configFile, JSON.stringify(project, null, 2));
    } catch (error) {
      console.error('Failed to save project config:', error);
      // Don't throw - this is not critical for operation
    }
  }

  /**
   * Load project-specific configuration
   */
  private async loadProjectConfig(projectRoot: string): Promise<ProjectConfig | null> {
    try {
      const configFile = path.join(projectRoot, '.CodeRecoder', 'project.json');
      
      if (await fs.pathExists(configFile)) {
        const content = await fs.readFile(configFile, 'utf-8');
        return JSON.parse(content);
      }
      
      return null;
    } catch (error) {
      console.error('Failed to load project config:', error);
      return null;
    }
  }

  /**
   * Get current project root path
   */
  getCurrentProjectRoot(): string {
    return this.currentProjectRoot;
  }

  /**
   * Update current project root
   */
  setCurrentProjectRoot(projectRoot: string): void {
    this.currentProjectRoot = projectRoot;
  }
  
  /**
   * 初始化项目的结构化数据
   */
  private async initializeStructuredData(
    projectRoot: string, 
    projectName: string, 
    language: string
  ): Promise<void> {
    if (!this.dataStructureManager) {
      throw new Error('DataStructureManager not initialized');
    }
    
    const structuredConfig: StructuredProjectConfig = {
      projectName,
      projectRoot,
      language,
      activated: true,
      version: '1.0.0',
      createdAt: Date.now(),
      lastActivated: Date.now(),
      features: {
        fileSnapshots: true,
        projectSnapshots: true,
        aiAnalysis: true,
        autoBackup: true
      }
    };
    
    await this.dataStructureManager.initializeProjectStructure(structuredConfig);
    console.error(`📁 结构化数据已初始化: ${projectName}`);
  }
}
