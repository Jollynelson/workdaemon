// WorkDaemon — Google Calendar Tool
// Schedules meetings, checks availability, reads upcoming events.
// MCP path (production): uses connected Google Calendar MCP server.

import { google } from 'googleapis';
import type { MCPAdapter } from './mcp.js';
import type {
  ScheduleMeetingParams, CalendarEvent, ToolResult,
} from './types.js';

export class CalendarTool {
  private mcp: MCPAdapter;

  constructor(mcp: MCPAdapter) {
    this.mcp = mcp;
  }

  // ── Schedule a meeting ───────────────────────────────────────────────────
  async schedule_meeting(
    organiser_email: string,
    params:          ScheduleMeetingParams,
  ): Promise<ToolResult> {
    try {
      // Production path — Calendar MCP server
      if (this.mcp.is_available('calendar')) {
        const result = await this.mcp.call({
          server: 'calendar',
          tool:   'create_event',
          params: {
            title:       params.title,
            attendees:   params.attendees,
            start:       params.start,
            end:         params.end,
            description: params.description ?? '',
            location:    params.location ?? '',
          },
        });

        if (result.ok) {
          const event = result.result as any;
          return {
            ok:      true,
            message: `Meeting "${params.title}" scheduled ✓\n` +
                     `📅 ${this.format_time(params.start)} — ${this.format_time(params.end)}\n` +
                     `👥 ${params.attendees.join(', ')}`,
            url:     event.html_link,
            data:    { event_id: event.id },
          };
        }
      }

      // Direct Google Calendar API fallback
      const auth = await this.get_oauth_client(organiser_email);
      if (!auth) {
        return {
          ok:      false,
          message: `Google Calendar not authorised for ${organiser_email}.`,
        };
      }

      const calendar = google.calendar({ version: 'v3', auth });
      const event = await calendar.events.insert({
        calendarId:    'primary',
        sendUpdates:   'all',  // sends calendar invites to all attendees
        requestBody:  {
          summary:     params.title,
          description: params.description,
          location:    params.location,
          start: {
            dateTime: params.start,
            timeZone: 'UTC',
          },
          end: {
            dateTime: params.end,
            timeZone: 'UTC',
          },
          attendees: params.attendees.map(email => ({ email })),
          conferenceData: {
            createRequest: {
              requestId:       `workdaemon-${Date.now()}`,
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        },
        conferenceDataVersion: 1,
      });

      const meet_link = event.data.conferenceData?.entryPoints?.[0]?.uri;

      return {
        ok:      true,
        message: `Meeting "${params.title}" scheduled ✓\n` +
                 `📅 ${this.format_time(params.start)}\n` +
                 `👥 ${params.attendees.join(', ')}\n` +
                 (meet_link ? `🔗 ${meet_link}` : ''),
        url:     event.data.htmlLink ?? undefined,
        data:    {
          event_id:  event.data.id,
          meet_link,
        },
      };

    } catch (err) {
      console.error('[Calendar] schedule_meeting failed:', err);
      return {
        ok:      false,
        message: `Failed to schedule meeting: ${err}`,
      };
    }
  }

  // ── Get upcoming events for an employee ──────────────────────────────────
  async get_upcoming_events(
    email:   string,
    limit:   number = 5,
  ): Promise<CalendarEvent[]> {
    try {
      if (this.mcp.is_available('calendar')) {
        const result = await this.mcp.call({
          server: 'calendar',
          tool:   'list_events',
          params: { max_results: limit },
        });
        if (result.ok) return (result.result as any).events ?? [];
      }
      return [];
    } catch {
      return [];
    }
  }

  // ── Check if someone is free at a given time ──────────────────────────────
  async is_free(email: string, start: string, end: string): Promise<boolean> {
    try {
      if (this.mcp.is_available('calendar')) {
        const result = await this.mcp.call({
          server: 'calendar',
          tool:   'check_availability',
          params: { email, start, end },
        });
        return (result.result as any)?.available ?? true;
      }
      return true; // assume free if can't check
    } catch {
      return true;
    }
  }

  private format_time(iso: string): string {
    return new Date(iso).toLocaleString('en-GB', {
      weekday: 'short', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  private async get_oauth_client(email: string): Promise<any | null> {
    // TODO: integrate with OpenClaw's OAuth token store
    return null;
  }
}
