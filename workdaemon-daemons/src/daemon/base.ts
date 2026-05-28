// WorkDaemon — Base Daemon
// Every staff Daemon extends this class.
// Handles: Brain queries, permission checks, cross-Daemon messaging,
//          personal memory reads, and channel delivery.
// OpenClaw provides the agent loop — this is what WorkDaemon adds on top.

import { v4 as uuid }             from 'uuid';
import type { WorkDaemonBrain }    from 'workdaemon-brain';
import type { DaemonBus }          from '../bus/index.js';
import type { PermissionService }  from '../permissions/index.js';
import type { PersonalMemoryStore } from '../memory/personal.js';
import type { SlackChannel }       from '../channels/slack.js';
import type {
  Employee, DaemonMessage, TaskPayload,
  PermissionLevel, ActionType,
} from '../types.js';

export abstract class BaseDaemon {
  protected employee:   Employee;
  protected brain:      WorkDaemonBrain;
  protected bus:        DaemonBus;
  protected permissions: PermissionService;
  protected memory:     PersonalMemoryStore;
  protected slack:      SlackChannel;

  constructor(deps: {
    employee:    Employee;
    brain:       WorkDaemonBrain;
    bus:         DaemonBus;
    permissions: PermissionService;
    memory:      PersonalMemoryStore;
    slack:       SlackChannel;
  }) {
    this.employee    = deps.employee;
    this.brain       = deps.brain;
    this.bus         = deps.bus;
    this.permissions = deps.permissions;
    this.memory      = deps.memory;
    this.slack       = deps.slack;
  }

  // ── Boot — register with bus, load personal context ──────────────────────
  async boot(): Promise<void> {
    // Register to receive bus messages
    this.bus.register(this.employee.email, msg => this.on_bus_message(msg));

    // Load capacity from personal memory
    const capacity = await this.memory.get_capacity(this.employee.email);
    console.log(
      `[Daemon:${this.employee.email}] Booted | ` +
      `Level ${this.employee.daemon_level} | ` +
      `${capacity.active_tasks} tasks | ` +
      `${capacity.is_overloaded ? '⚠ OVERLOADED' : '✓ capacity ok'}`
    );
  }

  // ── Handle an inbound message from the employee (via Slack, app etc) ─────
  async handle_message(text: string, action_id?: string): Promise<void> {
    // Handle Level 2 approval responses
    if (action_id) {
      await this.handle_approval_response(action_id);
      return;
    }

    // Save to conversation context
    await this.memory.push_context(this.employee.email, {
      role: 'user', content: text,
    });

    // Let the role-specific Daemon handle it first
    const handled = await this.on_employee_message(text);
    if (handled) return;

    // Fall through to Brain query
    await this.ask_brain(text);
  }

  // ── Query the Brain with a question ─────────────────────────────────────
  async ask_brain(question: string): Promise<string> {
    // Layer 1: check personal memory first (instant)
    const personal_answer = await this.check_personal_memory(question);
    if (personal_answer) {
      await this.reply(personal_answer);
      return personal_answer;
    }

    // Layer 2: query the Company Brain (RAG)
    const answer = await this.brain.query({
      company_id: this.employee.company_id,
      question,
      asked_by:   this.employee.email,
    });

    const response_text = answer.answer +
      (answer.sources.length > 0
        ? `\n\n_Sources: ${answer.sources.map(s => s.title).join(', ')}_`
        : '');

    await this.reply(response_text);

    await this.memory.push_context(this.employee.email, {
      role: 'daemon', content: answer.answer,
    });

    return answer.answer;
  }

  // ── Check personal memory for fast answers ────────────────────────────────
  private async check_personal_memory(question: string): Promise<string | null> {
    const q = question.toLowerCase();

    // "How many tasks do I have?" / "What's my workload?"
    if (q.includes('task') || q.includes('workload') || q.includes('capacity')) {
      const tasks    = await this.memory.get_tasks(this.employee.email);
      const capacity = await this.memory.get_capacity(this.employee.email);

      if (tasks.length > 0) {
        const high = tasks.filter((t: any) =>
          t.priority === 'high' || t.priority === 'urgent'
        );
        return `You have ${tasks.length} active tasks ` +
               `(${high.length} high priority). ` +
               (capacity.is_overloaded
                 ? `⚠️ You're at capacity — consider pushing back on new assignments.`
                 : `You have capacity for new work.`);
      }
    }

    return null;
  }

  // ── Attempt an action — runs through permission service ──────────────────
  async attempt_action(
    type:        ActionType,
    description: string,
    params:      Record<string, unknown>,
    execute:     () => Promise<void>,
  ): Promise<void> {
    const result = await this.permissions.check(
      this.employee.email,
      this.employee.daemon_level as PermissionLevel,
      type,
      description,
      params,
    );

    if (!result.granted) {
      await this.reply(`I can't do that — ${result.reason}`);
      return;
    }

    if (result.requires_preview) {
      // Level 2 — show preview and wait for approval
      const preview = this.permissions.build_preview(type, params);
      await this.slack.send_approval_request(
        this.employee, preview, result.action_id
      );
      return;
    }

    // Level 3 — or Level 2 with approval already granted — execute
    await execute();
  }

  // ── Handle approval response (Level 2) ───────────────────────────────────
  private async handle_approval_response(action_id: string): Promise<void> {
    const approved = action_id.startsWith('approve:');
    const clean_id = action_id.replace(/^(approve|reject):/, '');

    const action = await this.permissions.resolve_approval(
      this.employee.email, clean_id, approved
    );

    if (!action) {
      await this.reply("I couldn't find that pending action. It may have expired.");
      return;
    }

    if (!approved) {
      await this.reply(`Got it — I've cancelled that action.`);
      return;
    }

    await this.reply(`Approved — executing now...`);
    await this.on_action_approved(action.type as ActionType, action.params);
  }

  // ── Handle messages from other Daemons via the bus ───────────────────────
  private async on_bus_message(message: DaemonMessage): Promise<void> {
    console.log(
      `[Daemon:${this.employee.email}] ` +
      `Bus message from ${message.from} [${message.type}]`
    );

    switch (message.type) {
      case 'task_assignment': {
        const payload = message.payload as any;
        await this.memory.add_task(this.employee.email, {
          id:          payload.task_id,
          title:       payload.title,
          priority:    payload.priority,
          due_date:    payload.due_date,
          assigned_by: message.from,
        });

        // Check capacity before accepting
        const capacity = await this.memory.get_capacity(this.employee.email);

        if (capacity.is_overloaded) {
          // Notify the assigning Daemon about capacity issue
          await this.bus.send(
            this.employee.email,
            message.from,
            'capacity_alert',
            {
              kind:    'alert',
              message: `${this.employee.name} is at capacity ` +
                       `(${capacity.high_priority_count} high-priority tasks). ` +
                       `New task "${payload.title}" was added but may need timeline adjustment.`,
              context: { capacity },
            }
          );
        }

        // Notify the employee
        await this.slack.send_task_notification(
          this.employee,
          payload.title,
          message.from,
          payload.priority,
          payload.description,
        );
        break;
      }

      case 'capacity_alert': {
        // PM/assigning Daemon received a capacity alert
        const payload = message.payload as any;
        await this.reply(
          `⚠️ Heads up: ${payload.message}\n\n` +
          `Would you like me to:\n` +
          `• Adjust the deadline, or\n` +
          `• Re-prioritise their existing tasks?\n\n` +
          `Just tell me what you'd like to do.`
        );
        break;
      }

      case 'broadcast': {
        const payload = message.payload as any;
        await this.reply(
          `📢 *Company announcement from ${payload.from}:*\n\n` +
          `*${payload.title}*\n${payload.body}`
        );
        break;
      }

      default:
        await this.on_custom_bus_message(message);
    }
  }

  // ── Reply to the employee via their preferred channel ────────────────────
  async reply(text: string): Promise<void> {
    switch (this.employee.channel_pref) {
      case 'slack':
        await this.slack.send(this.employee, text);
        break;
      default:
        // Other channels (Teams, WhatsApp, email) plugged in here
        console.log(`[Daemon:${this.employee.email}] → ${text.slice(0, 100)}`);
    }
  }

  // ── Abstract methods — role-specific Daemons implement these ─────────────

  /** Handle a message from the employee — return true if handled */
  protected abstract on_employee_message(text: string): Promise<boolean>;

  /** Handle role-specific bus messages */
  protected abstract on_custom_bus_message(message: DaemonMessage): Promise<void>;

  /** Called when a Level 2 action is approved by the employee */
  protected abstract on_action_approved(
    type:   ActionType,
    params: Record<string, unknown>,
  ): Promise<void>;
}
