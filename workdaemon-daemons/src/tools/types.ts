// WorkDaemon — Tool Types
// Shared interfaces for all MCP tool integrations

// ── Result every tool action returns ────────────────────────────────────────
export interface ToolResult {
  ok:      boolean;
  message: string;              // Human-readable result for Daemon reply
  data?:   Record<string, unknown>; // Raw data for further processing
  url?:    string;              // Link to created/updated resource
}

// ── Notion ───────────────────────────────────────────────────────────────────
export interface CreateTaskParams {
  database_id:  string;         // Notion database ID to create in
  title:        string;
  assignee_email: string;
  priority:     'urgent' | 'high' | 'medium' | 'low';
  due_date?:    string;         // ISO date string
  description?: string;
  status?:      string;         // e.g. "Not started", "In Progress"
}

export interface UpdateTaskParams {
  page_id:    string;           // Notion page ID of the task
  status?:    string;
  assignee_email?: string;
  due_date?:  string;
  priority?:  string;
}

export interface NotionTask {
  id:         string;
  title:      string;
  status:     string;
  assignee?:  string;
  priority?:  string;
  due_date?:  string;
  url:        string;
}

// ── Gmail ────────────────────────────────────────────────────────────────────
export interface SendEmailParams {
  to:       string;
  subject:  string;
  body:     string;
  cc?:      string[];
  reply_to?: string;
}

// ── Google Calendar ──────────────────────────────────────────────────────────
export interface ScheduleMeetingParams {
  title:       string;
  attendees:   string[];         // email addresses
  start:       string;           // ISO datetime
  end:         string;           // ISO datetime
  description?: string;
  location?:   string;
}

export interface CalendarEvent {
  id:         string;
  title:      string;
  start:      string;
  end:        string;
  attendees:  string[];
  url:        string;
}

// ── MCP call interface ───────────────────────────────────────────────────────
export interface MCPCallParams {
  server:  string;              // MCP server name e.g. 'notion', 'gmail'
  tool:    string;              // Tool name e.g. 'create_page'
  params:  Record<string, unknown>;
}

export interface MCPCallResult {
  ok:     boolean;
  result: unknown;
  error?: string;
}
