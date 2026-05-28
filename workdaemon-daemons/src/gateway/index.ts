// WorkDaemon — Gateway
// The OpenClaw-inspired Gateway — boots the entire Daemon layer.
// One Gateway per company. Wires: Brain ↔ Bus ↔ Daemons ↔ Slack.
//
// This is what you deploy. One process per company.
// All Daemons run as logical tenants inside this single process.

import 'dotenv/config';
import pg from 'pg';

import { WorkDaemonBrain }   from 'workdaemon-brain';
import { DaemonBus }         from '../bus/index.js';
import { PersonalMemoryStore } from '../memory/personal.js';
import { PermissionService } from '../permissions/index.js';
import { WebChannel }        from '../channels/web.js';
import { create_http_server } from '../server/http.js';
import { DaemonRegistry }    from '../daemon/registry.js';
import { tools }             from '../tools/index.js';
import type { Employee }     from '../types.js';

const { Pool } = pg;

export class WorkDaemonGateway {
  private brain:      WorkDaemonBrain;
  private bus:        DaemonBus;
  private memory:     PersonalMemoryStore;
  private permissions: PermissionService;
  private slack:      WebChannel;
  private registry:   DaemonRegistry;
  private db:         pg.Pool;

  constructor() {
    const company_id = process.env.COMPANY_ID!;
    const redis_url  = process.env.REDIS_URL ?? 'redis://localhost:6379';

    this.brain   = new WorkDaemonBrain();
    this.bus     = new DaemonBus(company_id, redis_url);
    this.memory  = new PersonalMemoryStore(redis_url);
    this.permissions = new PermissionService(this.memory);

    this.slack = new WebChannel(3001);

    this.registry = new DaemonRegistry(
      this.brain,
      this.bus,
      this.permissions,
      this.memory,
      this.slack,
    );

    this.db = new Pool({
      connectionString: process.env.DATABASE_URL ??
        'postgresql://workdaemon:password@localhost:5432/workdaemon'
    });
  }

  // ── Boot the entire Gateway ───────────────────────────────────────────────
  async boot(): Promise<void> {
    console.log('\n👻 WorkDaemon Gateway booting...');
    console.log(`   Company: ${process.env.COMPANY_NAME}`);
    console.log('━'.repeat(60));

    // 1. Boot the Brain
    await this.brain.boot();

    // 1b. Report available tools
    tools.report();

    // 2. Connect the bus
    await this.bus.connect();

    // 3. Connect personal memory
    await this.memory.connect();

    // 4. Load all employees from database
    const employees = await this.load_employees();
    console.log(`\n[Gateway] Loaded ${employees.length} employees`);

    // 5. Spawn one Daemon per employee
    await this.registry.spawn_all(employees);

    // 6. Start HTTP server (serves web GUI)
    create_http_server(3000);

    // 7. Connect web channel — route every message to the right Daemon
    await this.slack.connect(async (email, text, action_id) => {
      await this.registry.route_message(email, text, action_id);
    });

    // 7. Start continuous Brain sync
    this.brain.start_continuous_sync();

    console.log('\n✅ Gateway ready');
    console.log(`   ${this.registry.count()} Daemons active`);
    console.log(`   Listening on Slack\n`);

    // Graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT',  () => this.shutdown());
  }

  // ── Load all employees for this company from Postgres ────────────────────
  private async load_employees(): Promise<Employee[]> {
    const result = await this.db.query(
      `SELECT id, company_id, name, email, role,
              daemon_level, channel_pref
       FROM employees
       WHERE company_id = $1
       ORDER BY name`,
      [process.env.COMPANY_ID]
    );

    return result.rows.map(row => ({
      id:           row.id,
      company_id:   row.company_id,
      name:         row.name,
      email:        row.email,
      role:         row.role ?? 'default',
      daemon_level: row.daemon_level ?? 1,
      channel_pref: row.channel_pref ?? 'slack',
    }));
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────
  async shutdown(): Promise<void> {
    console.log('\n[Gateway] Shutting down...');
    await this.registry.shutdown();
    await this.bus.disconnect();
    await this.memory.disconnect();
    await this.brain.shutdown();
    await this.db.end();
    console.log('[Gateway] Goodbye.\n');
    process.exit(0);
  }
}
