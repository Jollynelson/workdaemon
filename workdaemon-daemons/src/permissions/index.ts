// WorkDaemon — Permission Service
// Every Daemon action passes through here before executing
// Level 1 → suggest only
// Level 2 → show preview, wait for human approval
// Level 3 → execute immediately

import { v4 as uuid } from 'uuid';
import type {
  PermissionLevel, DaemonAction, DaemonMessage, ActionType
} from '../types.js';
import type { PersonalMemoryStore } from '../memory/personal.js';

// Actions allowed at each level
const LEVEL_1_ALLOWED: ActionType[] = [
  'notify_daemon',  // can tell other Daemons things
];

const LEVEL_2_ALLOWED: ActionType[] = [
  ...LEVEL_1_ALLOWED,
  'create_task',
  'assign_task',
  'update_task',
  'send_message',
  'send_email',
  'broadcast',
];

const LEVEL_3_ALLOWED: ActionType[] = [
  ...LEVEL_2_ALLOWED,
  'schedule_meeting',
];

export type PermissionResult =
  | { granted: true;  requires_preview: false }
  | { granted: true;  requires_preview: true;  action_id: string }
  | { granted: false; reason: string };

export class PermissionService {
  constructor(private memory: PersonalMemoryStore) {}

  // ── Check if a Daemon can take an action ─────────────────────────────────
  async check(
    email:        string,
    level:        PermissionLevel,
    action_type:  ActionType,
    action_desc:  string,
    action_params: Record<string, unknown>,
  ): Promise<PermissionResult> {

    // Level 1 — very restricted
    if (level === 1) {
      if (!LEVEL_1_ALLOWED.includes(action_type)) {
        return {
          granted: false,
          reason: `Your Daemon is in Copilot mode (Level 1). ` +
                  `It can suggest but cannot ${action_type.replace('_', ' ')}. ` +
                  `Upgrade to Level 2 to enable this.`,
        };
      }
      return { granted: true, requires_preview: false };
    }

    // Level 2 — can act but must show preview first
    if (level === 2) {
      if (!LEVEL_2_ALLOWED.includes(action_type)) {
        return {
          granted: false,
          reason: `This action requires Level 3 autonomy.`,
        };
      }

      // Store the pending action and return action_id for the approval flow
      const action_id = uuid();
      const action: DaemonAction = {
        id:          action_id,
        daemon_id:   email,
        type:        action_type,
        description: action_desc,
        params:      action_params,
        status:      'pending',
        created_at:  new Date().toISOString(),
      };

      await this.memory.store_pending_action(email, action_id, action);

      return {
        granted:          true,
        requires_preview: true,
        action_id,
      };
    }

    // Level 3 — full autonomy, execute immediately
    if (level === 3) {
      if (!LEVEL_3_ALLOWED.includes(action_type)) {
        return {
          granted: false,
          reason:  `Unsupported action type: ${action_type}`,
        };
      }
      return { granted: true, requires_preview: false };
    }

    return { granted: false, reason: 'Unknown permission level' };
  }

  // ── Employee responds to approval request (Level 2 flow) ─────────────────
  async resolve_approval(
    email:     string,
    action_id: string,
    approved:  boolean,
  ): Promise<DaemonAction | null> {
    const action = await this.memory.get_pending_action(
      email, action_id
    ) as DaemonAction | null;

    if (!action) return null;

    action.status = approved ? 'approved' : 'rejected';
    await this.memory.clear_pending_action(email, action_id);
    return action;
  }

  // ── Build the preview message shown to employee (Level 2) ─────────────────
  build_preview(action_type: ActionType, params: Record<string, unknown>): string {
    switch (action_type) {
      case 'create_task':
        return `Create task: "${params.title}" ` +
               `(${params.priority} priority) ` +
               `${params.due_date ? `due ${params.due_date}` : ''} ` +
               `in ${params.tool ?? 'Notion'}`;

      case 'assign_task':
        return `Assign "${params.title}" to ${params.assignee} ` +
               `with ${params.priority} priority`;

      case 'send_message':
        return `Send message to ${params.to}: "${String(params.body).slice(0, 80)}..."`;

      case 'send_email':
        return `Send email to ${params.to} — Subject: "${params.subject}"`;

      case 'schedule_meeting':
        return `Schedule meeting: "${params.title}" ` +
               `with ${(params.attendees as string[]).join(', ')} ` +
               `on ${params.date}`;

      case 'broadcast':
        return `Broadcast company-wide: "${String(params.title)}" ` +
               `— ${String(params.body).slice(0, 60)}...`;

      default:
        return `Execute: ${action_type} — ${JSON.stringify(params).slice(0, 100)}`;
    }
  }
}
