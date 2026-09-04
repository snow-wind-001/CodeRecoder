/**
 * Legacy analysis service. It provides deterministic local diff summaries.
 * Serena and LLM paths remain disabled until real transports are configured.
 */

import fs from 'fs-extra';
import path from 'path';

export interface CodeAnalysisResult {
  success: boolean;
  summary: string;
  changes: {
    added: number;
    deleted: number;
    modified: number;
  };
  diffText: string;
  aiAnalysis?: {
    intent: string;
    impact: string;
    complexity: 'low' | 'medium' | 'high';
    recommendations?: string;
  };
  error?: string;
}

export interface AnalysisOptions {
  useSerena?: boolean;
  useLLM?: boolean;
  maxDiffLines?: number;
  llmProvider?: 'vllm' | 'bailian';
  llmModel?: string;
}

export class AIAnalysisService {
  private serenaAvailable: boolean = false;
  private llmAvailable: boolean = false;

  constructor() {
    this.checkDependencies();
  }

  private checkDependencies(): void {
    // Legacy analysis has no configured MCP client or LLM transport. Keep both
    // capabilities disabled instead of reporting simulated providers as live.
    this.serenaAvailable = false;
    this.llmAvailable = false;
  }

  /**
   * Analyze code changes before creating snapshot
   */
  async analyzeCodeChanges(
    originalFilePath: string,
    newContent?: string,
    prompt?: string,
    options: AnalysisOptions = {}
  ): Promise<CodeAnalysisResult> {
    const startTime = Date.now();
    
    try {
      // Get current file content
      const currentContent = await fs.pathExists(originalFilePath) 
        ? await fs.readFile(originalFilePath, 'utf-8')
        : '';

      // If no new content provided, analyze current content
      const contentToAnalyze = newContent || currentContent;

      // Step 1: Basic diff analysis
      const diffResult = await this.generateDiff(currentContent, contentToAnalyze);

      // Step 2: Serena code comparison (if available and requested)
      let serenaDiff = null;
      if (options.useSerena !== false && this.serenaAvailable) {
        serenaDiff = await this.getSerenaComparison(originalFilePath, contentToAnalyze);
      }

      // Step 3: LLM analysis (if available and requested)
      let aiAnalysis = null;
      if (options.useLLM !== false && this.llmAvailable) {
        aiAnalysis = await this.getLLMAnalysis(
          diffResult.diffText,
          prompt,
          options.llmProvider || 'vllm',
          options.llmModel
        );
      }

      // Step 4: Generate intelligent summary
      const summary = this.generateIntelligentSummary(
        diffResult,
        serenaDiff,
        aiAnalysis,
        prompt,
        path.basename(originalFilePath)
      );

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        summary,
        changes: diffResult.changes,
        diffText: diffResult.diffText,
        aiAnalysis,
        metadata: {
          processingTime: `${processingTime}ms`,
          serenaUsed: !!serenaDiff,
          llmUsed: !!aiAnalysis,
          fileName: path.basename(originalFilePath)
        }
      } as any;

    } catch (error) {
      return {
        success: false,
        summary: `分析失败: ${error instanceof Error ? error.message : String(error)}`,
        changes: { added: 0, deleted: 0, modified: 0 },
        diffText: '',
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Generate basic diff between old and new content
   */
  private async generateDiff(oldContent: string, newContent: string): Promise<{
    diffText: string;
    changes: { added: number; deleted: number; modified: number };
  }> {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    let added = 0;
    let deleted = 0;
    let modified = 0;

    // Simple diff algorithm
    const maxLines = Math.max(oldLines.length, newLines.length);
    let diffText = '';

    for (let i = 0; i < maxLines; i++) {
      const oldLine = oldLines[i] || '';
      const newLine = newLines[i] || '';

      if (!oldLine && newLine) {
        added++;
        diffText += `+ ${newLine}\n`;
      } else if (oldLine && !newLine) {
        deleted++;
        diffText += `- ${oldLine}\n`;
      } else if (oldLine !== newLine) {
        modified++;
        diffText += `- ${oldLine}\n`;
        diffText += `+ ${newLine}\n`;
      }
    }

    return {
      diffText: diffText.trim(),
      changes: { added, deleted, modified }
    };
  }

  /**
   * Get code comparison from Serena MCP
   */
  private async getSerenaComparison(filePath: string, newContent: string): Promise<any> {
    void filePath;
    void newContent;
    console.warn('Serena comparison is disabled: no Serena MCP client is configured');
    return null;
  }

  /**
   * Get AI analysis from LLM service
   */
  private async getLLMAnalysis(
    diffText: string,
    prompt?: string,
    provider: 'vllm' | 'bailian' = 'vllm',
    model?: string
  ): Promise<any> {
    try {
      // Prepare analysis prompt
      const analysisPrompt = this.buildAnalysisPrompt(diffText, prompt);

      // Call the configured provider transport (legacy builds keep it disabled).
      const llmResult = await this.callLLMService(analysisPrompt, provider, model);

      return {
        intent: llmResult.intent || '代码修改',
        impact: llmResult.impact || '局部影响',
        complexity: llmResult.complexity || 'medium',
        recommendations: llmResult.recommendations || '建议进行测试验证'
      };
    } catch (error) {
      console.warn('LLM analysis failed:', error);
      return null;
    }
  }

  /**
   * Build prompt for LLM analysis
   */
  private buildAnalysisPrompt(diffText: string, userPrompt?: string): string {
    return `
分析以下代码变更，请提供简洁的中文分析：

用户提示: ${userPrompt || '无'}

代码差异:
${diffText}

请分析并以JSON格式返回:
{
  "intent": "修改意图的简短描述",
  "impact": "影响范围评估",
  "complexity": "low|medium|high",
  "recommendations": "建议或注意事项"
}
`.trim();
  }

  /**
   * Call LLM service (placeholder implementation)
   */
  private async callLLMService(
    prompt: string,
    provider: 'vllm' | 'bailian',
    model?: string
  ): Promise<any> {
    void prompt;
    void provider;
    void model;
    throw new Error('LLM analysis is disabled: no provider transport is configured');
  }

  /**
   * Generate intelligent summary combining all analysis results
   */
  private generateIntelligentSummary(
    diffResult: any,
    serenaDiff: any,
    aiAnalysis: any,
    userPrompt?: string,
    fileName?: string
  ): string {
    const parts = [];

    // User prompt (highest priority)
    if (userPrompt) {
      parts.push(userPrompt.length > 50 ? userPrompt.substring(0, 47) + '...' : userPrompt);
    }

    // AI analysis intent
    if (aiAnalysis?.intent) {
      parts.push(`[${aiAnalysis.intent}]`);
    }

    // File name and changes
    if (fileName) {
      const { added, deleted, modified } = diffResult.changes;
      if (added > 0 || deleted > 0 || modified > 0) {
        const changeDesc = [];
        if (added > 0) changeDesc.push(`+${added}行`);
        if (deleted > 0) changeDesc.push(`-${deleted}行`);
        if (modified > 0) changeDesc.push(`~${modified}行`);
        
        parts.push(`${fileName} (${changeDesc.join(', ')})`);
      } else {
        parts.push(fileName);
      }
    }

    // Complexity indicator
    if (aiAnalysis?.complexity) {
      const complexityEmoji: { [key: string]: string } = {
        'low': '🟢',
        'medium': '🟡', 
        'high': '🔴'
      };
      const emoji = complexityEmoji[aiAnalysis.complexity] || '🟡';
      parts.push(emoji);
    }

    return parts.join(' ') || '代码快照';
  }

  /**
   * Quick analysis for simple cases (fallback)
   */
  async quickAnalyze(filePath: string, prompt?: string): Promise<string> {
    try {
      const stats = await fs.stat(filePath);
      const fileName = path.basename(filePath);
      const sizeKB = Math.round(stats.size / 1024);
      
      if (prompt) {
        return `${prompt} (${fileName}, ${sizeKB}KB)`;
      }
      
      return `修改 ${fileName} (${sizeKB}KB)`;
    } catch (error) {
      return prompt || '代码快照';
    }
  }

  /**
   * Check if services are available
   */
  getServiceStatus(): { serena: boolean; llm: boolean } {
    return {
      serena: this.serenaAvailable,
      llm: this.llmAvailable
    };
  }
}
