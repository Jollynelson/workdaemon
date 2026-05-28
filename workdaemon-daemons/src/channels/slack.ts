// WorkDaemon — Slack Channel Delivery
// Delivers Daemon responses and notifications to employees via Slack
// Uses Slack Socket Mode — no public URL needed

import { WebClient }     from '@slack/web-api';
import { SocketModeClient } from '@slack/socket-mode';
import type { Employee, DaemonMessage } from '../types.js';

type SlackMessageHandler = (
  email: string,
  text:  string,
  action_id?: string,
) => Promise<void>;

export class SlackChannel {
  private web:    WebClient;
  private socket: SocketModeClient;
  private email_to_slack_id: Map<string, string> = new Map();
  private on_message?: SlackMessageHandler;

  constructor(
    bot_token:  string,
    app_token:  string,
  ) {
    this.web    = new WebClient(bot_token);
    this.socket = new SocketModeClient({ appToken: app_token });
  }

  // ── Connect and start listening for employee messages ────────────────────
  async connect(on_message: SlackMessageHandler): Promise<void> {
    this.on_message = on_message;

    // Listen for direct messages from employees
    this.socket.on('slack_event', async ({ event, ack }) => {
      await ack();

      if (event.type !== 'message' || event.bot_id) return;

      // Resolve Slack user ID to email
      const email = await this.resolve_email(event.user);
      if (!email) return;

      // Handle button clicks (Level 2 approvals)
      if (event.type === 'block_actions') {
        const action = event.actions?.[0];
        if (action?.action_id?.startsWith('approve:') || action?.action_id?.startsWith('reject:')) {
          await this.on_message?.(email, action.value, action.action_id);
          return;
        }
      }

      await this.on_message?.(email, event.text ?? '');
    });

    // Handle interactive payloads (button clicks)
    this.socket.on('interactive', async ({ payload, ack }) => {
      await ack();
      const action     = payload.actions?.[0];
      const user_email = payload.user?.email ?? await this.resolve_email(payload.user?.id);
      if (user_email && action) {
        await this.on_message?.(user_email, action.value ?? '', action.action_id);
      }
    });

    await this.socket.start();
    console.log('[Slack] Connected and listening');
  }

  // ── Send a simple text message to an employee ────────────────────────────
  async send(employee: Employee, text: string): Promise<void> {
    const slack_id = await this.get_slack_id(employee.email);
    if (!slack_id) {
      console.warn(`[Slack] No Slack ID for ${employee.email}`);
      return;
    }

    await this.web.chat.postMessage({
      channel: slack_id,
      text,
      username: `${employee.name}'s Daemon`,
      icon_emoji: ':ghost:',
    });
  }

  // ── Send a Level 2 approval preview with Approve / Reject buttons ────────
  async send_approval_request(
    employee:  Employee,
    preview:   string,
    action_id: string,
  ): Promise<void> {
    const slack_id = await this.get_slack_id(employee.email);
    if (!slack_id) return;

    await this.web.chat.postMessage({
      channel:   slack_id,
      username:  `${employee.name}'s Daemon`,
      icon_emoji: ':ghost:',
      text:      `I'm about to do something — check this over first:`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Ready to execute:*\n${preview}` },
        },
        {
          type: 'actions',
          elements: [
            {
              type:      'button',
              text:      { type: 'plain_text', text: '✅ Approve', emoji: true },
              style:     'primary',
              action_id: `approve:${action_id}`,
              value:     `approve:${action_id}`,
            },
            {
              type:      'button',
              text:      { type: 'plain_text', text: '❌ Reject', emoji: true },
              style:     'danger',
              action_id: `reject:${action_id}`,
              value:     `reject:${action_id}`,
            },
          ],
        },
      ],
    });
  }

  // ── Send task assignment notification ────────────────────────────────────
  async send_task_notification(
    employee:    Employee,
    task_title:  string,
    assigned_by: string,
    priority:    string,
    context?:    string,
  ): Promise<void> {
    const priority_emoji: Record<string, string> = {
      urgent: '🔴', high: '🟠', medium: '🟡', low: '🟢',
    };

    const emoji = priority_emoji[priority] ?? '⚪';

    await this.send(
      employee,
      `${emoji} *New task assigned by ${assigned_by}*\n` +
      `*${task_title}* — ${priority} priority\n` +
      (context ? `\n📋 *Context:*\n${context}` : ''),
    );
  }

  // ── Resolve Slack user ID → email ────────────────────────────────────────
  private async resolve_email(slack_id: string): Promise<string | null> {
    try {
      const result = await this.web.users.info({ user: slack_id });
      return result.user?.profile?.email ?? null;
    } catch {
      return null;
    }
  }

  // ── Get or lookup Slack ID for an email ──────────────────────────────────
  private async get_slack_id(email: string): Promise<string | null> {
    if (this.email_to_slack_id.has(email)) {
      return this.email_to_slack_id.get(email)!;
    }
    try {
      const result = await this.web.users.lookupByEmail({ email });
      const id     = result.user?.id ?? null;
      if (id) this.email_to_slack_id.set(email, id);
      return id;
    } catch {
      return null;
    }
  }
}
