// WorkDaemon Daemons — Shared Types

// ── Employee loaded from database ────────────────────────────────────────────
export interface Employee {
  id:            string;
  company_id:    string;
  name:          string;
  email:         string;
  role:          DaemonRole;
  daemon_level:  PermissionLevel;   // 1 | 2 | 3
  channel_pref:  ChannelType;       // how their Daemon reaches them
}

// ── Role determines which skills the Daemon has ──────────────────────────────
export type DaemonRole =
  | 'pm'
  | 'designer'
  | 'developer'
  | 'hr'
  | 'finance'
  | 'sales'
  | 'executive'
  | 'default';

// ── Permission level — controls what a Daemon can do ────────────────────────
export type PermissionLevel = 1 | 2 | 3;
// Level 1 — Copilot:    read, suggest, remind only
// Level 2 — Assistant:  draft action, show preview, wait for approval
// Level 3 — Autonomous: execute immediately, report back

// ── Channel a Daemon uses to reach its employee ──────────────────────────────
export type ChannelType = 'slack' | 'teams' | 'whatsapp' | 'email' | 'app';

// ── A message sent to a Daemon ───────────────────────────────────────────────
export interface DaemonMessage {
  id:          string;
  from:        string;              // employee email or 'system'
  to:          string;              // target employee email
  type:        MessageType;
  payload:     DaemonPayload;
  timestamp:   string;
  requires_approval?: boolean;      // Level 2 — needs human sign-off
}

export type MessageType =
  | 'user_query'           // Employee asked their Daemon something
  | 'task_assignment'      // PM assigned a task to this employee
  | 'task_completion'      // Employee marked task done, routing to next
  | 'capacity_alert'       // Daemon flagging someone is at capacity
  | 'blocker_flag'         // Daemon flagging a blocker
  | 'reminder'             // Proactive reminder from Daemon
  | 'approval_request'     // Level 2 — Daemon asking human to approve action
  | 'approval_response'    // Human approved or rejected
  | 'broadcast'            // Company-wide message (HR, exec)
  | 'system';              // Internal system message

// ── Payload types ────────────────────────────────────────────────────────────
export type DaemonPayload =
  | QueryPayload
  | TaskPayload
  | AlertPayload
  | ApprovalPayload
  | BroadcastPayload
  | GenericPayload;

export interface QueryPayload {
  kind:     'query';
  question: string;
  context?: string;
}

export interface TaskPayload {
  kind:        'task';
  task_id:     string;
  title:       string;
  description: string;
  priority:    'low' | 'medium' | 'high' | 'urgent';
  due_date?:   string;
  assigned_by: string;
  tool?:       'notion' | 'jira' | 'linear';  // where to create it
}

export interface AlertPayload {
  kind:    'alert';
  message: string;
  context: Record<string, unknown>;
}

export interface ApprovalPayload {
  kind:            'approval';
  action:          string;         // what the Daemon wants to do
  preview:         string;         // human-readable description
  action_id:       string;         // reference for approval_response
  original_message: DaemonMessage; // the message that triggered the action
}

export interface BroadcastPayload {
  kind:    'broadcast';
  title:   string;
  body:    string;
  from:    string;
  urgent:  boolean;
}

export interface GenericPayload {
  kind: 'generic';
  data: Record<string, unknown>;
}

// ── Action a Daemon wants to take ────────────────────────────────────────────
export interface DaemonAction {
  id:          string;
  daemon_id:   string;             // which Daemon wants to act
  type:        ActionType;
  description: string;             // human-readable
  params:      Record<string, unknown>;
  status:      'pending' | 'approved' | 'rejected' | 'executed';
  created_at:  string;
}

export type ActionType =
  | 'create_task'
  | 'assign_task'
  | 'update_task'
  | 'send_message'
  | 'send_email'
  | 'schedule_meeting'
  | 'notify_daemon'
  | 'broadcast';

// ── Personal memory entry ────────────────────────────────────────────────────
export interface PersonalMemory {
  employee_email: string;
  key:            string;
  value:          unknown;
  updated_at:     string;
  ttl_seconds?:   number;
}

// ── Capacity info for an employee ────────────────────────────────────────────
export interface CapacityInfo {
  email:              string;
  active_tasks:       number;
  high_priority_count: number;
  is_overloaded:      boolean;
  overload_threshold: number;      // typically 3 high-priority tasks
}
