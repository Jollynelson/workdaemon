// WorkDaemon — Daemon Registry
// Spawns one Daemon per employee, keeps them all alive.
// OpenClaw Gateway calls this on company boot.

import type { WorkDaemonBrain }    from 'workdaemon-brain';
import type { DaemonBus }          from '../bus/index.js';
import type { PermissionService }  from '../permissions/index.js';
import type { PersonalMemoryStore } from '../memory/personal.js';
import type { SlackChannel }       from '../channels/slack.js';
import type { Employee, DaemonRole } from '../types.js';
import { BaseDaemon }   from './base.js';
import { PMDaemon }     from './roles/pm.js';
import { DefaultDaemon } from './roles/default.js';

export class DaemonRegistry {
  private daemons: Map<string, BaseDaemon> = new Map(); // email → Daemon

  constructor(
    private brain:       WorkDaemonBrain,
    private bus:         DaemonBus,
    private permissions: PermissionService,
    private memory:      PersonalMemoryStore,
    private slack:       SlackChannel,
  ) {}

  // ── Spawn Daemons for all employees in the company ───────────────────────
  async spawn_all(employees: Employee[]): Promise<void> {
    console.log(`[Registry] Spawning ${employees.length} Daemons...`);

    await Promise.all(employees.map(emp => this.spawn(emp)));

    console.log(
      `[Registry] All Daemons alive: ` +
      Array.from(this.daemons.keys()).join(', ')
    );
  }

  // ── Spawn a single Daemon for one employee ───────────────────────────────
  async spawn(employee: Employee): Promise<BaseDaemon> {
    const existing = this.daemons.get(employee.email);
    if (existing) return existing;

    const deps = {
      employee,
      brain:       this.brain,
      bus:         this.bus,
      permissions: this.permissions,
      memory:      this.memory,
      slack:       this.slack,
    };

    // Pick the right Daemon class based on role
    const daemon = this.create_daemon(employee.role, deps);
    await daemon.boot();

    this.daemons.set(employee.email, daemon);
    return daemon;
  }

  // ── Route an inbound message from Slack to the right Daemon ─────────────
  async route_message(
    email:     string,
    text:      string,
    action_id?: string,
  ): Promise<void> {
    const daemon = this.daemons.get(email);
    if (!daemon) {
      console.warn(`[Registry] No Daemon for ${email}`);
      return;
    }
    await daemon.handle_message(text, action_id);
  }

  // ── Get a specific Daemon ────────────────────────────────────────────────
  get(email: string): BaseDaemon | undefined {
    return this.daemons.get(email);
  }

  // ── How many Daemons are running ─────────────────────────────────────────
  count(): number {
    return this.daemons.size;
  }

  // ── Shut down all Daemons cleanly ────────────────────────────────────────
  async shutdown(): Promise<void> {
    console.log(`[Registry] Shutting down ${this.daemons.size} Daemons`);
    this.daemons.clear();
  }

  // ── Factory — create the right Daemon class for the role ─────────────────
  private create_daemon(
    role: DaemonRole,
    deps: ConstructorParameters<typeof BaseDaemon>[0],
  ): BaseDaemon {
    switch (role) {
      case 'pm':        return new PMDaemon(deps);
      case 'hr':        return new DefaultDaemon(deps); // HR Daemon — Phase 5
      case 'finance':   return new DefaultDaemon(deps); // Finance Daemon — Phase 5
      case 'designer':  return new DefaultDaemon(deps); // Designer Daemon — Phase 5
      case 'developer': return new DefaultDaemon(deps); // Dev Daemon — Phase 5
      case 'sales':     return new DefaultDaemon(deps); // Sales Daemon — Phase 5
      case 'executive': return new DefaultDaemon(deps); // Exec Daemon — Phase 5
      default:          return new DefaultDaemon(deps);
    }
  }
}
