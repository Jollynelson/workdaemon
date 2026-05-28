// WorkDaemon — Cross-Daemon Message Bus
// The magic layer: Daemon A sends → Bus routes → Daemon B receives
// In-process for same company (fast), Redis pub/sub for multi-server
// This is what makes work move between people without opening any app

import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { v4 as uuid } from 'uuid';
import type { DaemonMessage, MessageType, DaemonPayload } from '../types.js';

type MessageHandler = (message: DaemonMessage) => Promise<void>;

export class DaemonBus extends EventEmitter {
  private handlers: Map<string, MessageHandler> = new Map();
  private publisher:  Redis;
  private subscriber: Redis;
  private channel:    string;

  constructor(
    private company_id: string,
    redis_url = 'redis://localhost:6379',
  ) {
    super();
    this.channel    = `workdaemon:bus:${company_id}`;
    this.publisher  = new Redis(redis_url, { lazyConnect: true });
    this.subscriber = new Redis(redis_url, { lazyConnect: true });
  }

  async connect(): Promise<void> {
    await this.publisher.connect();
    await this.subscriber.connect();

    // Subscribe to the company channel
    await this.subscriber.subscribe(this.channel);

    this.subscriber.on('message', (_channel, raw) => {
      try {
        const message = JSON.parse(raw) as DaemonMessage;
        this.deliver(message);
      } catch (err) {
        console.error('[Bus] Failed to parse message:', err);
      }
    });

    console.log(`[Bus] Connected — company: ${company_id}`);
  }

  // ── Register a Daemon to receive messages ────────────────────────────────
  register(email: string, handler: MessageHandler): void {
    this.handlers.set(email, handler);
    console.log(`[Bus] Daemon registered: ${email}`);
  }

  unregister(email: string): void {
    this.handlers.delete(email);
  }

  // ── Send a message from one Daemon to another ────────────────────────────
  async send(
    from:    string,
    to:      string,
    type:    MessageType,
    payload: DaemonPayload,
    options?: { requires_approval?: boolean },
  ): Promise<string> {
    const message: DaemonMessage = {
      id:               uuid(),
      from,
      to,
      type,
      payload,
      timestamp:        new Date().toISOString(),
      requires_approval: options?.requires_approval,
    };

    // Publish to Redis so all servers receive it
    await this.publisher.publish(this.channel, JSON.stringify(message));

    console.log(
      `[Bus] ${from} → ${to} [${type}] msg:${message.id.slice(0, 8)}`
    );

    return message.id;
  }

  // ── Broadcast to ALL Daemons in this company ─────────────────────────────
  async broadcast(
    from:    string,
    type:    MessageType,
    payload: DaemonPayload,
  ): Promise<void> {
    const message: DaemonMessage = {
      id:        uuid(),
      from,
      to:        '__broadcast__',
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    await this.publisher.publish(this.channel, JSON.stringify(message));
    console.log(`[Bus] Broadcast from ${from} [${type}]`);
  }

  // ── Deliver message to the right Daemon handler ──────────────────────────
  private async deliver(message: DaemonMessage): Promise<void> {
    if (message.to === '__broadcast__') {
      // Deliver to all registered Daemons
      const promises = Array.from(this.handlers.values()).map(
        handler => handler(message).catch(err =>
          console.error(`[Bus] Handler error (broadcast):`, err)
        )
      );
      await Promise.all(promises);
      return;
    }

    const handler = this.handlers.get(message.to);
    if (!handler) {
      // Daemon not on this server — Redis pub/sub handles cross-server routing
      return;
    }

    try {
      await handler(message);
    } catch (err) {
      console.error(`[Bus] Handler error for ${message.to}:`, err);
    }
  }

  async disconnect(): Promise<void> {
    await this.publisher.quit();
    await this.subscriber.quit();
  }
}
