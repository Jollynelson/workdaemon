// WorkDaemon — Default Daemon
// Every employee gets this if no specific role Daemon exists.
// Handles: Brain queries, reminders, task updates, capacity checks.
// The complete baseline Daemon for every staff member.

import { BaseDaemon }  from '../base.js';
import type { DaemonMessage, ActionType } from '../../types.js';

export class DefaultDaemon extends BaseDaemon {

  protected async on_employee_message(text: string): Promise<boolean> {
    const lower = text.toLowerCase();

    // Mark task complete and hand off
    if (lower.includes('done') || lower.includes('finished') ||
        lower.includes('complete') || lower.includes('push to')) {
      await this.handle_completion(text);
      return true;
    }

    // Flag a blocker
    if (lower.includes('blocked') || lower.includes('stuck') ||
        lower.includes('can\'t proceed') || lower.includes('blocker')) {
      await this.handle_blocker(text);
      return true;
    }

    return false; // Fall to Brain query
  }

  // ── Mark work done and route to next person ───────────────────────────────
  private async handle_completion(text: string): Promise<void> {
    // Extract what was completed and where it should go
    const result = await this.brain.query({
      company_id: this.employee.company_id,
      question:   `Based on: "${text}" — what task was completed and who should it go to next? ` +
                  `Return JSON: { "task": "task title", "next_person": "name or email" }`,
      asked_by:   this.employee.email,
    });

    let parsed: any;
    try {
      const clean = result.answer
        .replace(/```json\n?/g, '').replace(/```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      await this.reply(
        `Got it — what task did you complete, and who should I pass it to next?`
      );
      return;
    }

    if (parsed.next_person && parsed.next_person.includes('@')) {
      await this.bus.send(
        this.employee.email,
        parsed.next_person,
        'task_assignment',
        {
          kind:        'task',
          task_id:     `handoff-${Date.now()}`,
          title:       parsed.task,
          description: `Passed from ${this.employee.name} — work completed, ready for your review.`,
          priority:    'high',
          assigned_by: this.employee.email,
          tool:        'notion',
        }
      );

      await this.reply(
        `✅ Marked complete. Passed "${parsed.task}" to ${parsed.next_person}. ` +
        `Their Daemon has been notified.`
      );
    } else {
      await this.reply(
        `✅ "${parsed.task}" marked as complete. ` +
        `Who should I pass it to next?`
      );
    }
  }

  // ── Flag a blocker up to the PM ───────────────────────────────────────────
  private async handle_blocker(text: string): Promise<void> {
    // Find who the PM is
    const pm_result = await this.brain.query({
      company_id: this.employee.company_id,
      question:   `Who is the project manager or PM? Return their email only.`,
      asked_by:   this.employee.email,
    });

    const pm_email = pm_result.answer.trim().toLowerCase();

    if (pm_email.includes('@')) {
      await this.bus.send(
        this.employee.email,
        pm_email,
        'blocker_flag',
        {
          kind:    'alert',
          message: `${this.employee.name} is blocked: ${text}`,
          context: { flagged_by: this.employee.email, text },
        }
      );

      await this.reply(
        `🚧 I've flagged this blocker to the PM (${pm_email}). ` +
        `They'll be in touch. In the meantime, is there anything else I can help with?`
      );
    } else {
      await this.reply(
        `I've noted the blocker: "${text}". ` +
        `I couldn't find your PM's contact — can you tell me who to notify?`
      );
    }
  }

  protected async on_custom_bus_message(message: DaemonMessage): Promise<void> {
    // Generic fallback — just surface the message to the employee
    await this.reply(
      `Message from ${message.from}: ${JSON.stringify(message.payload).slice(0, 200)}`
    );
  }

  protected async on_action_approved(
    type:   ActionType,
    params: Record<string, unknown>,
  ): Promise<void> {
    await this.reply(`Action approved — executing: ${type}`);
  }
}
