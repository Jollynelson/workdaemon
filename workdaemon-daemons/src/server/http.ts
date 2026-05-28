// WorkDaemon — HTTP Server
// Serves the web GUI on port 3000
// REST endpoints for employee roster and company model
// WebSocket server runs separately on port 3001

import express from 'express';
import path    from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function create_http_server(port: number = 3000) {
  const app = express();
  const db  = new Pool({
    connectionString: process.env.DATABASE_URL ??
      'postgresql://workdaemon:password@localhost:5432/workdaemon'
  });

  app.use(express.json());

  // ── Serve the web GUI static files ────────────────────────────────────────
  app.use(express.static(path.join(__dirname, '../../public')));

  // ── API: list all employees for this company ──────────────────────────────
  app.get('/api/employees', async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT id, name, email, role, daemon_level, channel_pref
         FROM employees WHERE company_id = $1 ORDER BY name`,
        [process.env.COMPANY_ID]
      );
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── API: get company model (org, projects, blockers etc) ──────────────────
  app.get('/api/company-model', async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT properties FROM kg_entities
         WHERE company_id = $1 AND type = 'company_model'
         ORDER BY created_at DESC LIMIT 1`,
        [process.env.COMPANY_ID]
      );
      res.json(result.rows[0]?.properties ?? null);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── API: get tasks for an employee ────────────────────────────────────────
  app.get('/api/tasks/:email', async (req, res) => {
    res.json({ tasks: [], message: 'Tasks come from personal memory (Redis)' });
  });

  // ── Fallback → serve index.html ───────────────────────────────────────────
  app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '../../public/index.html'));
  });

  app.listen(port, () => {
    console.log(`[HTTP] Web GUI at http://localhost:${port}`);
  });

  return app;
}
