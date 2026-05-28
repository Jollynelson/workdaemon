// WorkDaemon — Notion Tool
// Creates tasks, assigns them, updates status, queries databases.
// Uses Notion API directly (MCP passthrough in production).
//
// Setup: create a Notion integration at notion.so/my-integrations
// Share your task database with the integration.

import { Client } from '@notionhq/client';
import type { MCPAdapter } from './mcp.js';
import type {
  CreateTaskParams, UpdateTaskParams,
  NotionTask, ToolResult,
} from './types.js';

// Map WorkDaemon priority to Notion select option names
// Adjust these to match your Notion database's Priority field options
const PRIORITY_MAP: Record<string, string> = {
  urgent: 'Urgent',
  high:   'High',
  medium: 'Medium',
  low:    'Low',
};

export class NotionTool {
  private notion: Client;
  private mcp:    MCPAdapter;

  constructor(mcp: MCPAdapter) {
    this.mcp    = mcp;
    this.notion = new Client({
      auth: process.env.NOTION_API_KEY,
    });
  }

  // ── Create a new task in a Notion database ───────────────────────────────
  async create_task(params: CreateTaskParams): Promise<ToolResult> {
    try {
      // Try MCP first if available (production path via OpenClaw)
      if (this.mcp.is_available('notion')) {
        const mcp_result = await this.mcp.call({
          server: 'notion',
          tool:   'create_page',
          params: this.build_notion_properties(params),
        });
        if (mcp_result.ok) {
          const page = mcp_result.result as any;
          return {
            ok:      true,
            message: `Task "${params.title}" created in Notion`,
            url:     page.url,
            data:    { page_id: page.id },
          };
        }
      }

      // Direct Notion API fallback
      const page = await this.notion.pages.create({
        parent: { database_id: params.database_id },
        properties: {
          // Title property — adjust name to match your database
          Name: {
            title: [{ text: { content: params.title } }],
          },
          // Assignee — Notion Person property
          ...(params.assignee_email ? {
            Assignee: {
              people: [{ object: 'user', id: await this.resolve_notion_user(params.assignee_email) }],
            },
          } : {}),
          // Priority select
          Priority: {
            select: { name: PRIORITY_MAP[params.priority] ?? 'Medium' },
          },
          // Due date
          ...(params.due_date ? {
            'Due Date': {
              date: { start: params.due_date },
            },
          } : {}),
          // Status
          Status: {
            status: { name: params.status ?? 'Not started' },
          },
        },
        // Description in page body
        children: params.description ? [{
          object: 'block' as const,
          type:   'paragraph' as const,
          paragraph: {
            rich_text: [{ text: { content: params.description } }],
          },
        }] : [],
      });

      return {
        ok:      true,
        message: `Task "${params.title}" created in Notion ✓`,
        url:     (page as any).url,
        data:    { page_id: page.id },
      };

    } catch (err) {
      console.error('[Notion] create_task failed:', err);
      return {
        ok:      false,
        message: `Couldn't create task in Notion: ${err}`,
      };
    }
  }

  // ── Update an existing task ───────────────────────────────────────────────
  async update_task(params: UpdateTaskParams): Promise<ToolResult> {
    try {
      const properties: Record<string, unknown> = {};

      if (params.status) {
        properties['Status'] = { status: { name: params.status } };
      }
      if (params.priority) {
        properties['Priority'] = {
          select: { name: PRIORITY_MAP[params.priority] ?? params.priority }
        };
      }
      if (params.due_date) {
        properties['Due Date'] = { date: { start: params.due_date } };
      }
      if (params.assignee_email) {
        const notion_user_id = await this.resolve_notion_user(params.assignee_email);
        if (notion_user_id) {
          properties['Assignee'] = {
            people: [{ object: 'user', id: notion_user_id }],
          };
        }
      }

      await this.notion.pages.update({
        page_id: params.page_id,
        properties: properties as any,
      });

      return {
        ok:      true,
        message: `Task updated in Notion ✓`,
        data:    { page_id: params.page_id },
      };

    } catch (err) {
      return {
        ok:      false,
        message: `Couldn't update Notion task: ${err}`,
      };
    }
  }

  // ── Mark a task as complete ───────────────────────────────────────────────
  async complete_task(page_id: string): Promise<ToolResult> {
    return this.update_task({ page_id, status: 'Done' });
  }

  // ── Query tasks assigned to a specific person ────────────────────────────
  async get_tasks_for(
    database_id:   string,
    assignee_email: string,
  ): Promise<NotionTask[]> {
    try {
      const notion_user_id = await this.resolve_notion_user(assignee_email);
      if (!notion_user_id) return [];

      const response = await this.notion.databases.query({
        database_id,
        filter: {
          and: [
            {
              property: 'Assignee',
              people:   { contains: notion_user_id },
            },
            {
              property: 'Status',
              status:   { does_not_equal: 'Done' },
            },
          ],
        },
        sorts: [{ property: 'Priority', direction: 'descending' }],
      });

      return response.results.map(page => this.parse_task(page as any));

    } catch (err) {
      console.error('[Notion] get_tasks_for failed:', err);
      return [];
    }
  }

  // ── Resolve email to Notion user ID ──────────────────────────────────────
  private async resolve_notion_user(email: string): Promise<string> {
    try {
      const users = await this.notion.users.list({});
      const user  = users.results.find(
        (u: any) => u.type === 'person' && u.person?.email === email
      );
      return (user as any)?.id ?? '';
    } catch {
      return '';
    }
  }

  // ── Build Notion properties from CreateTaskParams ─────────────────────────
  private build_notion_properties(params: CreateTaskParams): Record<string, unknown> {
    return {
      parent:     { database_id: params.database_id },
      title:      params.title,
      assignee:   params.assignee_email,
      priority:   PRIORITY_MAP[params.priority] ?? 'Medium',
      due_date:   params.due_date,
      status:     params.status ?? 'Not started',
      description: params.description,
    };
  }

  // ── Parse a Notion page into a NotionTask ─────────────────────────────────
  private parse_task(page: any): NotionTask {
    const props = page.properties ?? {};
    return {
      id:       page.id,
      title:    props.Name?.title?.[0]?.text?.content ?? 'Untitled',
      status:   props.Status?.status?.name ?? 'Unknown',
      assignee: props.Assignee?.people?.[0]?.person?.email,
      priority: props.Priority?.select?.name,
      due_date: props['Due Date']?.date?.start,
      url:      page.url,
    };
  }
}
