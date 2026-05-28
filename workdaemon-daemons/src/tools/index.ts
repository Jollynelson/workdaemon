// WorkDaemon — Tool Registry
// Single import point for all Daemon tool access.
// Daemons call: this.tools.notion.create_task(...)
//               this.tools.gmail.send(...)
//               this.tools.calendar.schedule_meeting(...)

import { MCPAdapter }    from './mcp.js';
import { NotionTool }    from './notion.js';
import { GmailTool }     from './gmail.js';
import { CalendarTool }  from './calendar.js';

export class ToolRegistry {
  readonly mcp:      MCPAdapter;
  readonly notion:   NotionTool;
  readonly gmail:    GmailTool;
  readonly calendar: CalendarTool;

  constructor() {
    this.mcp      = new MCPAdapter();
    this.notion   = new NotionTool(this.mcp);
    this.gmail    = new GmailTool(this.mcp);
    this.calendar = new CalendarTool(this.mcp);
  }

  // ── Log what's available at startup ─────────────────────────────────────
  report(): void {
    const tools = ['notion', 'gmail', 'calendar'] as const;
    console.log('[Tools] Available MCP servers:');
    for (const tool of tools) {
      const available = this.mcp.is_available(tool);
      console.log(`   ${available ? '✓' : '○'} ${tool} ${available ? '(MCP)' : '(direct API fallback)'}`);
    }
  }
}

// Singleton — shared across all Daemons in one Gateway process
export const tools = new ToolRegistry();
