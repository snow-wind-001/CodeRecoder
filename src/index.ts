#!/usr/bin/env node

/**
 * CodeRecoder MCP Server
 * 
 * A Model Context Protocol server that provides code generation with rollback functionality.
 * Inspired by Cursor's multi-round generation and undo features.
 * 
 * This server can be integrated with Cline or other MCP-compatible AI assistants
 * to provide sophisticated version control for AI-generated code.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import path from 'path';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { HistoryManager } from './historyManager.js';
import { ProjectManager } from './projectManager.js';
import { FileSnapshotManager } from './fileSnapshotManager.js';
import { ProjectSnapshotManager } from './projectSnapshotManager.js';
import {
  RecordEditParams,
  RollbackParams,
  ListHistoryParams,
  CreateSessionParams,
  GetDiffParams,
  ActivateProjectParams,
  ListProjectsParams,
  GetProjectInfoParams,
  DeactivateProjectParams,
  ToolResponse
} from './types.js';

class CodeRecoderServer {
  private server: Server;
  private historyManager: HistoryManager;
  private projectManager: ProjectManager;
  private snapshotManager: FileSnapshotManager;
  private projectSnapshotManager: ProjectSnapshotManager;

  constructor() {
    // Initialize MCP server
    this.server = new Server(
      {
        name: 'coderecoder-mcp',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize project manager
    this.projectManager = new ProjectManager();
    
    // Initialize managers (will be updated when project is activated)
    this.historyManager = new HistoryManager();
    this.snapshotManager = new FileSnapshotManager();
    this.projectSnapshotManager = new ProjectSnapshotManager();

    this.setupToolHandlers();
    this.setupErrorHandling();
    
    // 启动时自动同步到当前激活的项目（异步执行，不阻塞启动）
    this.initializeManagers();
  }

  private async initializeManagers(): Promise<void> {
    try {
      // 重试机制确保项目管理器初始化完成
      const maxRetries = 5;
      let retries = 0;
      
      const tryInitialize = async (): Promise<void> => {
        const projectInfo = await this.projectManager.getProjectInfo();
        if (projectInfo.success && projectInfo.data?.project?.cacheDirectory) {
          console.error(`🔄 启动时同步所有管理器到项目: ${projectInfo.data.project.cacheDirectory}`);
          await this.historyManager.updateCacheDirectory(projectInfo.data.project.cacheDirectory);
          await this.snapshotManager.updateCacheDirectory(projectInfo.data.project.cacheDirectory);
          await this.projectSnapshotManager.updateCacheDirectory(projectInfo.data.project.cacheDirectory);
          console.error(`✅ 启动时管理器同步完成`);
        } else if (retries < maxRetries) {
          retries++;
          setTimeout(() => tryInitialize(), 200 * retries); // 递增延迟
        }
      };
      
      // 立即尝试一次，然后异步重试
      setTimeout(() => tryInitialize(), 50);
      
    } catch (error) {
      console.warn('启动时管理器同步警告:', error);
    }
  }

  private setupToolHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'create_file_snapshot',
            description: 'Create a file snapshot for instant backup and restore. Much faster than record_edit - uses direct file copying.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Absolute path to the file to snapshot'
                },
                prompt: {
                  type: 'string',
                  description: 'User prompt or description for this snapshot'
                },
                sessionId: {
                  type: 'string',
                  description: 'Optional session ID to group related snapshots',
                  optional: true
                },
                metadata: {
                  type: 'object',
                  description: 'Optional metadata about the generation (model, temperature, etc.)',
                  optional: true
                }
              },
              required: ['filePath', 'prompt']
            }
          },
          {
            name: 'record_edit',
            description: 'Legacy: Record a code edit for version history tracking. Note: create_file_snapshot is much faster.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Absolute path to the file being edited'
                },
                startLine: {
                  type: 'number',
                  description: 'Starting line number (1-based) of the edit'
                },
                endLine: {
                  type: 'number',
                  description: 'Ending line number (1-based) of the edit'
                },
                oldContent: {
                  type: 'string',
                  description: 'Original content that was replaced'
                },
                newContent: {
                  type: 'string',
                  description: 'New content that replaced the original'
                },
                prompt: {
                  type: 'string',
                  description: 'User prompt that led to this edit'
                },
                sessionId: {
                  type: 'string',
                  description: 'Optional session ID to group related edits',
                  optional: true
                },
                metadata: {
                  type: 'object',
                  description: 'Optional metadata about the generation (model, temperature, etc.)',
                  optional: true
                }
              },
              required: ['filePath', 'startLine', 'endLine', 'oldContent', 'newContent', 'prompt']
            }
          },
          {
            name: 'restore_file_snapshot',
            description: 'Restore a file from a snapshot. Instant file restore using direct file copying.',
            inputSchema: {
              type: 'object',
              properties: {
                snapshotId: {
                  type: 'string',
                  description: 'Snapshot ID to restore from'
                }
              },
              required: ['snapshotId']
            }
          },
          {
            name: 'rollback_to_version',
            description: 'Legacy: Rollback files to a previous version. Note: restore_file_snapshot is much faster.',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Session ID to rollback within'
                },
                editId: {
                  type: 'string',
                  description: 'Optional specific edit ID to rollback to. If not provided, rollback to session start.',
                  optional: true
                }
              },
              required: ['sessionId']
            }
          },
          {
            name: 'list_file_snapshots',
            description: 'List AI-enhanced file snapshots with intelligent summaries for easy rollback selection. Shows snapshot time, modified files, and AI-generated summaries.',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Optional session ID to filter snapshots',
                  optional: true
                },
                filePath: {
                  type: 'string',
                  description: 'Optional file path to filter snapshots',
                  optional: true
                },
                limit: {
                  type: 'number',
                  description: 'Optional limit on number of results (default 20 for better readability)',
                  optional: true
                },
                format: {
                  type: 'string',
                  description: 'Output format: "detailed" (default) shows full info, "compact" shows summary only',
                  optional: true
                }
              },
              required: []
            }
          },
          {
            name: 'delete_file_snapshot',
            description: 'Delete a specific file snapshot and its associated files. Use with caution as this operation cannot be undone.',
            inputSchema: {
              type: 'object',
              properties: {
                snapshotId: {
                  type: 'string',
                  description: 'ID of the snapshot to delete'
                }
              },
              required: ['snapshotId']
            }
          },
          {
            name: 'list_history',
            description: 'Legacy: List edit history for debugging. Note: list_file_snapshots is much faster.',
            inputSchema: {
              type: 'object',
              properties: {
                sessionId: {
                  type: 'string',
                  description: 'Optional session ID to filter history',
                  optional: true
                },
                filePath: {
                  type: 'string',
                  description: 'Optional file path to filter history',
                  optional: true
                },
                limit: {
                  type: 'number',
                  description: 'Optional limit on number of results',
                  optional: true
                }
              },
              required: []
            }
          },
          {
            name: 'create_session',
            description: 'Create a new editing session to group related changes. Useful for organizing different features or experiments.',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'Optional name for the session',
                  optional: true
                },
                description: {
                  type: 'string',
                  description: 'Optional description of what this session is for',
                  optional: true
                }
              },
              required: []
            }
          },
          {
            name: 'get_current_session',
            description: 'Get information about the current active session.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'get_diff',
            description: 'Generate a diff between two edit versions to see what changed.',
            inputSchema: {
              type: 'object',
              properties: {
                fromEditId: {
                  type: 'string',
                  description: 'ID of the first edit'
                },
                toEditId: {
                  type: 'string',
                  description: 'ID of the second edit'
                }
              },
              required: ['fromEditId', 'toEditId']
            }
          },
          {
            name: 'activate_project',
            description: 'Activate a project for code tracking. Creates .CodeRecoder cache directory with structured data.',
            inputSchema: {
              type: 'object',
              properties: {
                projectPath: {
                  type: 'string',
                  description: 'Absolute path to the project directory'
                },
                projectName: {
                  type: 'string',
                  description: 'Optional custom name for the project',
                  optional: true
                },
                language: {
                  type: 'string',
                  description: 'Optional programming language (auto-detected if not provided)',
                  optional: true
                }
              },
              required: ['projectPath']
            }
          },
          {
            name: 'deactivate_project',
            description: 'Deactivate the current project and optionally save history.',
            inputSchema: {
              type: 'object',
              properties: {
                saveHistory: {
                  type: 'boolean',
                  description: 'Whether to save current history before deactivating',
                  optional: true
                }
              },
              required: []
            }
          },
          {
            name: 'list_projects',
            description: 'List all available projects and show current active project.',
            inputSchema: {
              type: 'object',
              properties: {},
              required: []
            }
          },
          {
            name: 'get_project_info',
            description: 'Get detailed information about a project or the current active project.',
            inputSchema: {
              type: 'object',
              properties: {
                projectPath: {
                  type: 'string',
                  description: 'Optional project path. If not provided, returns current project info.',
                  optional: true
                }
              },
              required: []
            }
          },
          {
            name: 'create_project_snapshot',
            description: 'Create a project-wide snapshot (like Cursor). Analyzes project changes using Serena and saves incrementally or fully based on save count.',
            inputSchema: {
              type: 'object',
              properties: {
                prompt: {
                  type: 'string',
                  description: 'Description of changes being saved'
                },
                name: {
                  type: 'string',
                  description: 'Optional user-friendly name for the snapshot (e.g., "Feature Complete", "Before Refactor")',
                  optional: true
                },
                tags: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Optional tags for categorizing snapshots (e.g., ["stable", "feature"])',
                  optional: true
                },
                projectPath: {
                  type: 'string',
                  description: 'Optional project path. Uses current active project if not provided.',
                  optional: true
                }
              },
              required: ['prompt']
            }
          },
          {
            name: 'list_project_snapshots',
            description: 'List all project snapshots with save numbers, types (incremental/full), and Serena analysis.',
            inputSchema: {
              type: 'object',
              properties: {
                format: {
                  type: 'string',
                  description: 'Output format: "detailed" (default) or "compact" for Cline',
                  optional: true
                }
              },
              required: []
            }
          },
          {
            name: 'restore_project_snapshot',
            description: 'Restore entire project to a specific snapshot state.',
            inputSchema: {
              type: 'object',
              properties: {
                snapshotId: {
                  type: 'string',
                  description: 'ID of the snapshot to restore'
                }
              },
              required: ['snapshotId']
            }
          }
        ] as Tool[]
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        let result: ToolResponse;

        switch (name) {
          case 'create_file_snapshot':
            result = await this.handleCreateSnapshot(args as unknown as any);
            break;

          case 'restore_file_snapshot':
            result = await this.handleRestoreSnapshot(args as unknown as any);
            break;

          case 'list_file_snapshots':
            result = await this.handleListSnapshots(args as unknown as any);
            break;

          case 'delete_file_snapshot':
            result = await this.handleDeleteSnapshot(args as unknown as any);
            break;

          case 'record_edit':
            result = await this.handleRecordEdit(args as unknown as RecordEditParams);
            break;

          case 'rollback_to_version':
            result = await this.handleRollback(args as unknown as RollbackParams);
            break;

          case 'list_history':
            result = await this.handleListHistory(args as unknown as ListHistoryParams);
            break;

          case 'create_session':
            result = await this.handleCreateSession(args as unknown as CreateSessionParams);
            break;

          case 'get_current_session':
            result = await this.handleGetCurrentSession();
            break;

          case 'get_diff':
            result = await this.handleGetDiff(args as unknown as GetDiffParams);
            break;

          case 'activate_project':
            result = await this.handleActivateProject(args as unknown as ActivateProjectParams);
            break;

          case 'deactivate_project':
            result = await this.handleDeactivateProject(args as unknown as DeactivateProjectParams);
            break;

          case 'list_projects':
            result = await this.handleListProjects();
            break;

          case 'get_project_info':
            result = await this.handleGetProjectInfo(args as unknown as GetProjectInfoParams);
            break;

          case 'create_project_snapshot':
            result = await this.handleCreateProjectSnapshot(args as unknown as any);
            break;

          case 'list_project_snapshots':
            result = await this.handleListProjectSnapshots(args as unknown as any);
            break;

          case 'restore_project_snapshot':
            result = await this.handleRestoreProjectSnapshot(args as unknown as any);
            break;

          default:
            result = {
              success: false,
              message: `Unknown tool: ${name}`,
              error: `Tool '${name}' is not recognized`
            };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        };

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Error handling tool ${name}:`, error);
        
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                success: false,
                message: `Error executing ${name}`,
                error: errorMessage
              }, null, 2)
            }
          ],
          isError: true
        };
      }
    });
  }

  private async handleRecordEdit(params: RecordEditParams): Promise<ToolResponse> {
    return await this.historyManager.recordEdit(
      params.filePath,
      params.startLine,
      params.endLine,
      params.oldContent,
      params.newContent,
      params.prompt,
      params.sessionId,
      undefined, // parentEditId - could be added later for branching
      params.metadata
    );
  }

  private async handleRollback(params: RollbackParams): Promise<ToolResponse> {
    return await this.historyManager.rollback(params.target);
  }

  private async handleListHistory(params: ListHistoryParams): Promise<ToolResponse> {
    return await this.historyManager.getHistory(
      params.sessionId,
      params.filePath,
      params.limit
    );
  }

  private async handleCreateSession(params: CreateSessionParams): Promise<ToolResponse> {
    return await this.historyManager.createSession(params.name, params.description);
  }

  private async handleGetCurrentSession(): Promise<ToolResponse> {
    return await this.historyManager.getCurrentSession();
  }

  private async handleGetDiff(params: GetDiffParams): Promise<ToolResponse> {
    return await this.historyManager.getDiff(params.fromEditId, params.toEditId);
  }

  private async handleActivateProject(params: ActivateProjectParams): Promise<ToolResponse> {
    const result = await this.projectManager.activateProject(
      params.projectPath,
      params.projectName,
      params.language
    );

    if (result.success && result.data?.cacheDirectory) {
      // Update all managers to use the new cache directory
      console.error(`🔄 同步所有管理器到项目: ${result.data.cacheDirectory}`);
      await this.historyManager.updateCacheDirectory(result.data.cacheDirectory);
      await this.snapshotManager.updateCacheDirectory(result.data.cacheDirectory);
      await this.projectSnapshotManager.updateCacheDirectory(result.data.cacheDirectory);
      console.error(`✅ 所有管理器同步完成`);

    }

    return result;
  }

  private async ensureSnapshotManagerSync(): Promise<void> {
    try {
      const projectInfo = await this.projectManager.getProjectInfo();
      if (projectInfo.success && projectInfo.data?.project?.cacheDirectory) {
        // 确保同步所有管理器到当前项目
        await this.historyManager.updateCacheDirectory(projectInfo.data.project.cacheDirectory);
        await this.snapshotManager.updateCacheDirectory(projectInfo.data.project.cacheDirectory);
        await this.projectSnapshotManager.updateCacheDirectory(projectInfo.data.project.cacheDirectory);
        console.error(`🔄 所有管理器已同步到项目: ${projectInfo.data.project.cacheDirectory}`);
      } else {
        console.warn('⚠️ 无法获取项目信息进行同步');
      }
    } catch (error) {
      console.warn('管理器同步警告:', error);
    }
  }


  // New high-performance snapshot handlers
  private async handleCreateSnapshot(params: any): Promise<ToolResponse> {
    // 确保快照管理器同步到当前项目
    await this.ensureSnapshotManagerSync();
    
    return await this.snapshotManager.createSnapshot(
      params.filePath,
      params.prompt,
      params.sessionId,
      undefined, // parentSnapshotId
      params.metadata
    );
  }

  private async handleRestoreSnapshot(params: any): Promise<ToolResponse> {
    return await this.snapshotManager.restoreSnapshot(params.snapshotId);
  }

  private async handleDeleteSnapshot(params: any): Promise<ToolResponse> {
    return await this.snapshotManager.deleteSnapshot(params.snapshotId);
  }

  private async handleListSnapshots(params: any): Promise<ToolResponse> {
    // 确保项目已激活并同步
    const projectInfo = await this.projectManager.getProjectInfo();
    if (projectInfo.success && projectInfo.data?.project?.cacheDirectory) {
      console.error(`📸 准备同步快照管理器到: ${projectInfo.data.project.cacheDirectory}`);
      await this.snapshotManager.updateCacheDirectory(projectInfo.data.project.cacheDirectory);
      console.error(`📸 快照管理器已同步完成`);
    } else {
      console.error(`⚠️ 无法获取项目信息，使用默认配置`);
    }

    console.error(`📋 开始获取快照列表...`);
    const result = await this.snapshotManager.listSnapshots(
      params.sessionId,
      params.filePath,
      params.limit || 20
    );
    console.error(`📋 快照列表结果: 成功=${result.success}, 快照数量=${result.data?.snapshots?.length || 0}`);

    if (!result.success) {
      return result;
    }

    // Enhanced formatting for Cline display
    const format = params.format || 'detailed';
    const snapshots = result.data.snapshots || [];

    if (snapshots.length === 0) {
      return {
        success: true,
        message: '📸 暂无AI增强快照记录\n\n💡 使用 create_file_snapshot 工具创建带有AI分析的文件快照',
        data: result.data
      };
    }

    let displayText = '';
    
    if (format === 'compact') {
      displayText = `📸 AI增强快照列表 (${snapshots.length}个)\n\n`;
      snapshots.forEach((snapshot: any, index: number) => {
        const time = new Date(snapshot.timestamp).toLocaleString('zh-CN');
        const complexityMap: { [key: string]: string } = { 'low': '🟢', 'medium': '🟡', 'high': '🔴' };
        const complexity = complexityMap[snapshot.complexity] || '🟡';
        displayText += `${index + 1}. ${complexity} ${snapshot.aiSummary || snapshot.prompt}\n`;
        displayText += `   📁 ${snapshot.fileName} | ⏰ ${time.split(' ')[1]}\n\n`;
      });
    } else {
      displayText = `🤖 AI增强快照详细列表\n`;
      displayText += `📊 总计: ${snapshots.length}个快照，${result.data.totalSessions}个会话\n\n`;
      
      snapshots.forEach((snapshot: any, index: number) => {
        const time = new Date(snapshot.timestamp).toLocaleString('zh-CN');
        const complexityMap: { [key: string]: string } = { 'low': '🟢 低', 'medium': '🟡 中', 'high': '🔴 高' };
        const complexity = complexityMap[snapshot.complexity] || '🟡 中';
        const aiFlags = [];
        if (snapshot.aiEnhanced) aiFlags.push('🤖 AI增强');
        if (snapshot.serenaUsed) aiFlags.push('🔍 Serena');
        if (snapshot.llmUsed) aiFlags.push('🧠 LLM');
        
        displayText += `━━━ 快照 ${index + 1} ━━━\n`;
        displayText += `📸 ID: ${snapshot.id.substring(0, 8)}...\n`;
        displayText += `🧠 智能摘要: ${snapshot.aiSummary || snapshot.prompt}\n`;
        displayText += `📁 文件: ${snapshot.fileName} (${Math.round(snapshot.fileSize / 1024)}KB)\n`;
        displayText += `⏰ 时间: ${time}\n`;
        displayText += `📊 复杂度: ${complexity}\n`;
        displayText += `🎯 意图: ${snapshot.intent}\n`;
        displayText += `🔍 影响: ${snapshot.impact}\n`;
        displayText += `✨ AI功能: ${aiFlags.join(', ')}\n`;
        
        if (snapshot.changeAnalysis) {
          const { added, deleted, modified } = snapshot.changeAnalysis;
          if (added > 0 || deleted > 0 || modified > 0) {
            displayText += `📈 变更: +${added} -${deleted} ~${modified} 行\n`;
          }
        }
        
        displayText += `\n💡 恢复命令: restore_file_snapshot {"snapshotId": "${snapshot.id}"}\n\n`;
      });
      
      displayText += `📱 Web界面: http://localhost:3001 (可视化管理)\n`;
      displayText += `⚡ 快速恢复: 选择上方任一快照ID使用 restore_file_snapshot 工具`;
    }

    return {
      success: true,
      message: displayText,
      data: result.data
    };
  }

  private async handleDeactivateProject(params: DeactivateProjectParams): Promise<ToolResponse> {
    return await this.projectManager.deactivateProject(params.saveHistory ?? true);
  }

  private async handleListProjects(): Promise<ToolResponse> {
    return await this.projectManager.listProjects();
  }

  private async handleGetProjectInfo(params: GetProjectInfoParams): Promise<ToolResponse> {
    return await this.projectManager.getProjectInfo(params.projectPath);
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  // Project Snapshot handlers (Cursor-style)
  private async handleCreateProjectSnapshot(params: any): Promise<ToolResponse> {
    // 确保管理器状态同步
    await this.initializeManagers();
    await this.ensureProjectSnapshotManagerSync();
    
    // 首先尝试从参数获取项目路径
    let projectPath = params.projectPath;
    
    // 如果没有提供，尝试从项目管理器获取
    if (!projectPath) {
      projectPath = this.projectManager.getCurrentProjectRoot();
    }
    
    // 如果仍然没有，尝试从项目管理器的项目信息获取
    if (!projectPath) {
      const projectInfo = await this.projectManager.getProjectInfo();
      if (projectInfo.success && projectInfo.data?.project) {
        projectPath = projectInfo.data.project.projectRoot;
      }
    }
    
    // 如果还是没有，直接使用项目快照管理器的项目根路径
    if (!projectPath && this.projectSnapshotManager) {
      projectPath = this.projectSnapshotManager.getProjectRoot();
    }
    
    if (!projectPath) {
      return {
        success: false,
        message: 'No active project. Please activate a project first.'
      };
    }
    
    return await this.projectSnapshotManager.createProjectSnapshot(projectPath, params.prompt, params.name, params.tags);
  }

  private async handleListProjectSnapshots(params: any): Promise<ToolResponse> {
    await this.ensureProjectSnapshotManagerSync();
    
    const result = await this.projectSnapshotManager.listProjectSnapshots();
    
    if (result.success) {
      // Format for enhanced display
      const snapshots = result.data?.snapshots || [];
      const summary = result.data?.summary || {};
      
      let display = `🗂️ 项目快照历史 (共 ${summary.total} 个快照)\n`;
      display += `📊 统计: ${summary.full} 个全量快照, ${summary.incremental} 个增量快照\n`;
      display += `🔢 当前保存次数: ${summary.currentSave}, 最后全量保存: ${summary.lastFullSave}\n\n`;
      
      if (snapshots.length === 0) {
        display += "❌ 暂无项目快照\n";
        display += "💡 使用 create_project_snapshot 创建第一个快照\n";
      } else {
        display += "🕒 快照列表 (按时间倒序):\n\n";
        
        snapshots.forEach((snapshot: any, index: number) => {
          const typeEmoji = snapshot.type === 'full' ? '📦' : '📄';
          const complexityEmoji: { [key: string]: string } = { low: '🟢', medium: '🟡', high: '🔴' };
          
          display += `${index + 1}. ${snapshot.name || snapshot.id.substring(0, 8)}\n`;
          display += `   🆔 ID: ${snapshot.id.substring(0, 8)}...\n`;
          display += `   📅 时间: ${snapshot.displayTime} (${snapshot.timeSince})\n`;
          display += `   💬 描述: ${snapshot.prompt}\n`;
          
          if (snapshot.tags && snapshot.tags.length > 0) {
            display += `   🏷️  标签: ${snapshot.tags.join(', ')}\n`;
          }
          
          if (snapshot.serenaAnalysis) {
            display += `   🤖 AI分析: ${snapshot.serenaAnalysis.summary}\n`;
            display += `   🎯 复杂度: ${complexityEmoji[snapshot.serenaAnalysis.complexity] || '⚪'} ${snapshot.serenaAnalysis.complexity}\n`;
          }
          
          const actualFileCount = snapshot.metadata?.actualFileCount;
          if (actualFileCount !== undefined) {
            display += `   📁 实际文件: ${actualFileCount} 个文件\n`;
          } else {
            display += `   📁 变更文件: ${snapshot.changedFiles.length > 0 ? snapshot.changedFiles.length + ' 个文件' : '无变更'}\n`;
          }
          
          if (snapshot.dependencies && snapshot.dependencies.length > 0) {
            display += `   🔗 依赖快照: ${snapshot.dependencies.length} 个 (需要按顺序恢复)\n`;
          }
          
          display += `   📏 大小: ${snapshot.sizeInfo.estimatedSize}\n`;
          
          // 恢复提示
          if (snapshot.type === 'full') {
            display += `   ✅ 可直接恢复 (独立快照)\n`;
          } else {
            display += `   ⚠️  需连续恢复 (依赖 ${snapshot.dependencies.length} 个前置快照)\n`;
          }
          
          display += `\n`;
        });
        
        display += "💡 使用 restore_project_snapshot 恢复快照\n";
        display += "⚠️  增量快照需要按依赖顺序恢复，系统会自动处理\n";
      }
      
      return {
        success: true,
        message: display,
        data: result.data
      };
    }
    
    return result;
  }

  private async handleRestoreProjectSnapshot(params: any): Promise<ToolResponse> {
    await this.ensureProjectSnapshotManagerSync();
    
    return await this.projectSnapshotManager.restoreProjectSnapshot(params.snapshotId);
  }


  private async ensureProjectSnapshotManagerSync(): Promise<void> {
    try {
      const projectInfo = await this.projectManager.getProjectInfo();
      if (projectInfo.success && projectInfo.data?.project?.cacheDirectory) {
        // 同步项目快照管理器
        await this.projectSnapshotManager.updateCacheDirectory(projectInfo.data.project.cacheDirectory);
        
        // 更新项目管理器的当前项目根路径
        const projectRoot = projectInfo.data.project.projectRoot;
        if (projectRoot) {
          this.projectManager.setCurrentProjectRoot(projectRoot);
        }
        
        console.error(`🔄 项目快照管理器已同步: ${projectInfo.data.project.cacheDirectory}`);
      } else {
        console.warn('⚠️ 无法获取项目信息进行同步:', projectInfo);
      }
    } catch (error) {
      console.warn('项目快照管理器同步警告:', error);
    }
  }

  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('CodeRecoder MCP Server running on stdio');
  }
}

// Start the server
const server = new CodeRecoderServer();
server.start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
