// WorkDaemon — PM Daemon
// The most action-heavy role.
// Can: assign tasks, track progress, flag blockers, run handoffs.
// This is the demo role — Phase 2 build priority.

import { v4 as uuid }     from 'uuid';
import { BaseDaemon }      from '../base.js';
import { tools }           from '../../tools/index.js';
import type { DaemonMessage, ActionType, TaskPayload } from '../../types.js';

// Keywords that signal a task assignment intent
const ASSIGN_SIGNALS = [
  'assign', 'give', 'send', 'delegate', 'ask', 'tell',
  'create task', 'add task', 'make a task',
];

// Priority keywords
const PRIORITY_MAP: Record<string, TaskPayload['priority']> = {
  'urgent':      'urgent',
  'asap':        'urgent',
  'immediately': 'urgent',
  'high':        'high',
  'important':   'high',
  'medium':      'medium',
  'normal':      'medium',
  'low':         'low',
  'whenever':    'low',
};

export class PMDaemon extends BaseDaemon {

  // ── Handle employee message ───────────────────────────────────────────────
  protected async on_employee_message(text: string): Promise<boolean> {
    const lower = text.toLowerCase();

    // Task assignment intent
    if (ASSIGN_SIGNALS.some(s => lower.includes(s))) {
      await this.handle_task_assignment_intent(text);
      return true;
    }

    // Progress check
    if (lower.includes('progress') || lower.includes('status') ||
        lower.includes('update') || lower.includes('where are we')) {
      await this.handle_progress_check(text);
      return true;
    }

    // Capacity check for a person
    if (lower.includes('capacity') || lower.includes('overloaded') ||
        lower.includes('how busy')) {
      await this.handle_capacity_check(text);
      return true;
    }

    return false; // Not handled — fall to Brain query
  }

  // ── Parse and execute task assignment ────────────────────────────────────
  private async handle_task_assignment_intent(text: string): Promise<void> {
    // Use Brain to parse the assignment intent
    const parsed_raw = await this.brain.query({
      company_id: this.employee.company_id,
      question:   `Parse this task assignment request and return JSON only:
"${text}"

Return exactly:
{
  "assignee_name": "first name or full name mentioned",
  "assignee_email": "email if mentioned, or null",
  "task_title": "task title",
  "priority": "urgent|high|medium|low",
  "due_date": "date if mentioned or null",
  "context": "any additional context for the task"
}`,
      asked_by:   this.employee.email,
    });

    let assignment: any;
    try {
      const clean = parsed_raw.answer
        .replace(/```json\n?/g, '').replace(/```/g, '').trim();
      assignment = JSON.parse(clean);
    } catch {
      // Brain couldn't parse — ask for clarification
      await this.reply(
        `I want to create that task but I need a bit more detail:\n` +
        `• Who should it be assigned to?\n` +
        `• What's the task?\n` +
        `• What priority? (urgent / high / medium / low)`
      );
      return;
    }

    // Look up the assignee in the company model if email not provided
    let assignee_email = assignment.assignee_email;
    if (!assignee_email && assignment.assignee_name) {
      assignee_email = await this.resolve_employee_email(assignment.assignee_name);
    }

    if (!assignee_email) {
      await this.reply(
        `I couldn't find ${assignment.assignee_name} in the team. ` +
        `Can you give me their email?`
      );
      return;
    }

    const task_id = uuid();
    const params  = {
      task_id,
      assignee:    assignee_email,
      title:       assignment.task_title,
      description: assignment.context ?? '',
      priority:    this.detect_priority(assignment.priority),
      due_date:    assignment.due_date,
      tool:        'notion',
    };

    await this.attempt_action(
      'assign_task',
      `Assign "${assignment.task_title}" to ${assignee_email} (${params.priority} priority)`,
      params,
      async () => {
        await this.execute_task_assignment(task_id, assignee_email!, params);
      }
    );
  }

  // ── Execute the actual task assignment ───────────────────────────────────
  private async execute_task_assignment(
    task_id:        string,
    assignee_email: string,
    params:         Record<string, unknown>,
  ): Promise<void> {
    // Create task in Notion via MCP tool
    const notion_result = await tools.notion.create_task({
      database_id:    process.env.NOTION_TASKS_DB_ID ?? '',
      title:          params.title as string,
      assignee_email,
      priority:       params.priority as TaskPayload['priority'],
      due_date:       params.due_date as string | undefined,
      description:    params.description as string,
    });
    if (!notion_result.ok) {
      console.warn('[PMDaemon] Notion failed:', notion_result.message);
    }

    // Send assignment to assignee's Daemon via the bus
    await this.bus.send(
      this.employee.email,
      assignee_email,
      'task_assignment',
      {
        kind:        'task',
        task_id:     params.task_id as string,
        title:       params.title as string,
        description: params.description as string,
        priority:    params.priority as TaskPayload['priority'],
        due_date:    params.due_date as string | undefined,
        assigned_by: this.employee.email,
        tool:        'notion',
      }
    );

    await this.reply(
      `✅ Done — "${params.title}" assigned to ${assignee_email} ` +
      `at ${params.priority} priority.\n` +
      `Their Daemon has been notified. ` +
      (params.due_date ? `Due: ${params.due_date}.` : '')
    );
  }

  // ── Check project progress via Brain ─────────────────────────────────────
  private async handle_progress_check(text: string): Promise<void> {
    // Brain already knows all project statuses
    await this.ask_brain(text);
  }

  // ── Check someone's capacity ──────────────────────────────────────────────
  private async handle_capacity_check(text: string): Promise<void> {
    // Extract name from text via Brain
    const result = await this.brain.query({
      company_id: this.employee.company_id,
      question:   `Who is being asked about in: "${text}"? Return their email only.`,
      asked_by:   this.employee.email,
    });

    const target_email = result.answer.trim().toLowerCase();
    if (!target_email.includes('@')) {
      await this.ask_brain(text);
      return;
    }

    const capacity = await this.memory.get_capacity(target_email);

    await this.reply(
      `📊 *${target_email} capacity:*\n` +
      `• ${capacity.active_tasks} active tasks\n` +
      `• ${capacity.high_priority_count} high priority\n` +
      `• Status: ${capacity.is_overloaded
        ? '⚠️ Overloaded — consider reassigning or adjusting deadlines'
        : '✅ Has capacity for new work'}`
    );
  }

  // ── Resolve an employee name to their email via Brain ────────────────────
  private async resolve_employee_email(name: string): Promise<string | null> {
    const result = await this.brain.query({
      company_id: this.employee.company_id,
      question:   `What is the email address of ${name}? Return email only.`,
      asked_by:   this.employee.email,
    });
    const email = result.answer.trim().toLowerCase();
    return email.includes('@') ? email : null;
  }

  // ── Detect priority from string ───────────────────────────────────────────
  private detect_priority(raw: string): TaskPayload['priority'] {
    const lower = (raw ?? '').toLowerCase();
    for (const [keyword, priority] of Object.entries(PRIORITY_MAP)) {
      if (lower.includes(keyword)) return priority;
    }
    return 'medium';
  }

  // ── Handle custom bus messages (blocker escalations etc) ─────────────────
  protected async on_custom_bus_message(message: DaemonMessage): Promise<void> {
    if (message.type === 'blocker_flag') {
      const payload = message.payload as any;
      await this.reply(
        `🚧 *Blocker flagged by ${message.from}:*\n${payload.message}\n\n` +
        `How would you like me to handle this?`
      );
    }
  }

  // ── Handle approved Level 2 actions ──────────────────────────────────────
  protected async on_action_approved(
    type:   ActionType,
    params: Record<string, unknown>,
  ): Promise<void> {
    if (type === 'assign_task') {
      await this.execute_task_assignment(
        params.task_id as string,
        params.assignee as string,
        params,
      );
    }
  }
}
