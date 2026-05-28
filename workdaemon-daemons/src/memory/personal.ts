// WorkDaemon — Personal Daemon Memory (Layer 1)
// The fastest intelligence layer — checked before Brain queries
// Stores: tasks, priorities, deadlines, preferences, recent context
// Backed by Redis for sub-millisecond reads

import Redis from 'ioredis';
import type { CapacityInfo, PersonalMemory } from '../types.js';

const OVERLOAD_THRESHOLD = 3; // high-priority tasks before flagging capacity

export class PersonalMemoryStore {
  private redis: Redis;

  constructor(redis_url = 'redis://localhost:6379') {
    this.redis = new Redis(redis_url, { lazyConnect: true });
  }

  async connect(): Promise<void> {
    await this.redis.connect();
  }

  // ── Generic key-value set ────────────────────────────────────────────────
  async set(
    email: string,
    key: string,
    value: unknown,
    ttl_seconds?: number,
  ): Promise<void> {
    const store_key = this.key(email, key);
    const serialised = JSON.stringify(value);

    if (ttl_seconds) {
      await this.redis.setex(store_key, ttl_seconds, serialised);
    } else {
      await this.redis.set(store_key, serialised);
    }
  }

  // ── Generic key-value get ────────────────────────────────────────────────
  async get<T>(email: string, key: string): Promise<T | null> {
    const raw = await this.redis.get(this.key(email, key));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  // ── Task management ──────────────────────────────────────────────────────
  async add_task(email: string, task: {
    id: string; title: string; priority: string;
    due_date?: string; assigned_by: string;
  }): Promise<void> {
    const tasks = await this.get_tasks(email);
    tasks.push({ ...task, added_at: new Date().toISOString() });
    await this.set(email, 'tasks', tasks);
    await this.recalculate_capacity(email, tasks);
  }

  async complete_task(email: string, task_id: string): Promise<void> {
    const tasks = await this.get_tasks(email);
    const updated = tasks.filter((t: any) => t.id !== task_id);
    await this.set(email, 'tasks', updated);
    await this.recalculate_capacity(email, updated);
  }

  async get_tasks(email: string): Promise<any[]> {
    return (await this.get<any[]>(email, 'tasks')) ?? [];
  }

  // ── Capacity check — the smart layer that knows when someone is overloaded
  async get_capacity(email: string): Promise<CapacityInfo> {
    const cached = await this.get<CapacityInfo>(email, 'capacity');
    if (cached) return cached;

    const tasks      = await this.get_tasks(email);
    return this.calculate_capacity(email, tasks);
  }

  private async recalculate_capacity(email: string, tasks: any[]): Promise<void> {
    const capacity = this.calculate_capacity(email, tasks);
    await this.set(email, 'capacity', capacity, 300); // cache for 5 min
  }

  private calculate_capacity(email: string, tasks: any[]): CapacityInfo {
    const high_priority = tasks.filter(
      (t: any) => t.priority === 'high' || t.priority === 'urgent'
    ).length;

    return {
      email,
      active_tasks:        tasks.length,
      high_priority_count: high_priority,
      is_overloaded:       high_priority >= OVERLOAD_THRESHOLD,
      overload_threshold:  OVERLOAD_THRESHOLD,
    };
  }

  // ── Employee preferences ─────────────────────────────────────────────────
  async set_preference(email: string, pref: string, value: unknown): Promise<void> {
    const prefs = await this.get_preferences(email);
    prefs[pref]  = value;
    await this.set(email, 'preferences', prefs);
  }

  async get_preferences(email: string): Promise<Record<string, unknown>> {
    return (await this.get<Record<string, unknown>>(email, 'preferences')) ?? {};
  }

  // ── Recent conversation context ──────────────────────────────────────────
  async push_context(email: string, entry: {
    role: 'user' | 'daemon'; content: string;
  }): Promise<void> {
    const context = await this.get_context(email);
    context.push({ ...entry, timestamp: new Date().toISOString() });
    // Keep last 20 exchanges only
    const trimmed = context.slice(-20);
    await this.set(email, 'context', trimmed, 3600); // 1 hour TTL
  }

  async get_context(email: string): Promise<any[]> {
    return (await this.get<any[]>(email, 'context')) ?? [];
  }

  async clear_context(email: string): Promise<void> {
    await this.redis.del(this.key(email, 'context'));
  }

  // ── Store pending approval actions (Level 2) ─────────────────────────────
  async store_pending_action(email: string, action_id: string, action: unknown): Promise<void> {
    await this.set(email, `pending_action:${action_id}`, action, 3600);
  }

  async get_pending_action(email: string, action_id: string): Promise<unknown> {
    return this.get(email, `pending_action:${action_id}`);
  }

  async clear_pending_action(email: string, action_id: string): Promise<void> {
    await this.redis.del(this.key(email, `pending_action:${action_id}`));
  }

  // ── Namespace helper ──────────────────────────────────────────────────────
  private key(email: string, field: string): string {
    return `daemon:${email}:${field}`;
  }

  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}
