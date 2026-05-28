// WorkDaemon — Web Channel
// Replaces Slack for development and testing.
// WebSocket server — the web GUI connects here.
// Every Daemon message flows through this instead of Slack API.

import { WebSocketServer, WebSocket } from 'ws';
import type { Employee } from '../types.js';

// ── Message types the WebSocket sends/receives ────────────────────────────────
export interface WSInbound {
  type:      'message' | 'approval';
  email:     string;        // which employee is sending
  text:      string;        // the message text
  action_id?: string;       // for approval responses
}

export interface WSOutbound {
  type:       'daemon_reply' | 'bus_event' | 'brain_status' | 'system';
  to_email:   string;       // which employee this is for
  from:       string;       // Daemon name or bus source
  text:       string;       // message text
  meta?:      Record<string, unknown>; // extra data (model used, cached, etc)
  timestamp:  string;
}

type MessageHandler = (
  email:    string,
  text:     string,
  action_id?: string,
) => Promise<void>;

export class WebChannel {
  private wss:      WebSocketServer;
  private clients:  Map<string, WebSocket> = new Map(); // email → ws connection
  private on_msg?:  MessageHandler;

  constructor(port: number = 3001) {
    this.wss = new WebSocketServer({ port });
    console.log(`[WebChannel] WebSocket server on ws://localhost:${port}`);
  }

  // ── Start listening for GUI connections ───────────────────────────────────
  async connect(on_message: MessageHandler): Promise<void> {
    this.on_msg = on_message;

    this.wss.on('connection', (ws, req) => {
      console.log('[WebChannel] GUI client connected');

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString()) as WSInbound;

          if (msg.type === 'message' || msg.type === 'approval') {
            // Register this connection to the employee's email
            this.clients.set(msg.email, ws);
            await this.on_msg?.(msg.email, msg.text, msg.action_id);
          }

          // Identify — GUI sends this on load to register email → connection
          if ((msg as any).type === 'identify') {
            this.clients.set(msg.email, ws);
          }
        } catch (err) {
          console.error('[WebChannel] Parse error:', err);
        }
      });

      ws.on('close', () => {
        // Remove disconnected client
        for (const [email, client] of this.clients.entries()) {
          if (client === ws) {
            this.clients.delete(email);
            console.log(`[WebChannel] ${email} disconnected`);
          }
        }
      });
    });
  }

  // ── Send a reply to a specific employee's GUI ────────────────────────────
  async send(employee: Employee, text: string): Promise<void> {
    this.emit({
      type:      'daemon_reply',
      to_email:  employee.email,
      from:      `${employee.name}'s Daemon`,
      text,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Send an approval preview (Level 2) ───────────────────────────────────
  async send_approval_request(
    employee:  Employee,
    preview:   string,
    action_id: string,
  ): Promise<void> {
    this.emit({
      type:      'daemon_reply',
      to_email:  employee.email,
      from:      `${employee.name}'s Daemon`,
      text:      `__APPROVAL_REQUEST__`,
      meta: {
        preview,
        action_id,
        kind: 'approval',
      },
      timestamp: new Date().toISOString(),
    });
  }

  // ── Send a task assignment notification ──────────────────────────────────
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
      `${emoji} **New task assigned by ${assigned_by}**\n` +
      `**${task_title}** — ${priority} priority\n` +
      (context ? `\n📋 ${context}` : ''),
    );
  }

  // ── Broadcast a bus event to all connected GUIs ──────────────────────────
  // So you can watch cross-Daemon activity in real time
  broadcast_bus_event(event: {
    from:    string;
    to:      string;
    type:    string;
    message: string;
  }): void {
    const outbound: WSOutbound = {
      type:      'bus_event',
      to_email:  '__all__',
      from:      event.from,
      text:      `${event.from} → ${event.to}: [${event.type}] ${event.message}`,
      meta:      event,
      timestamp: new Date().toISOString(),
    };
    this.broadcast(outbound);
  }

  // ── Send Brain query status (model used, cached, latency) ────────────────
  broadcast_brain_status(email: string, meta: Record<string, unknown>): void {
    this.emit({
      type:      'brain_status',
      to_email:  email,
      from:      'Brain',
      text:      '',
      meta,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Emit to a specific employee's connection ──────────────────────────────
  private emit(msg: WSOutbound): void {
    const ws = this.clients.get(msg.to_email);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    } else {
      // Queue or log — GUI might reconnect
      console.log(
        `[WebChannel] No connection for ${msg.to_email} — message queued`
      );
    }
  }

  // ── Broadcast to all connected GUIs (bus events, system messages) ─────────
  private broadcast(msg: WSOutbound): void {
    const raw = JSON.stringify(msg);
    for (const ws of this.clients.values()) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw);
      }
    }
  }

  close(): void {
    this.wss.close();
  }
}
