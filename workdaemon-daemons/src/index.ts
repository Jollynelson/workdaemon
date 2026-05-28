// WorkDaemon — Main Entry Point
// Run: npm run dev

import { WorkDaemonGateway } from './gateway/index.js';

const gateway = new WorkDaemonGateway();
gateway.boot().catch(err => {
  console.error('Gateway failed to boot:', err);
  process.exit(1);
});
