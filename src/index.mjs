/**
 * Twitter Comment Pack — main entrypoint.
 * Runs List Comment mode (Mode A) only.
 */
import fs from 'fs';
import path from 'path';
import { loadConfig } from './config.mjs';
import { initStore } from './lib/store.mjs';
import { runListMode } from './modes/list-comment.mjs';

const RUN_LOG = 'data/run.log';

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    const dir = path.dirname(RUN_LOG);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(RUN_LOG, line + '\n');
  } catch {}
}

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? `${reason.message}\n${reason.stack || ''}` : String(reason);
  log(`[fatal] unhandled rejection: ${message}`);
});

process.on('uncaughtException', (error) => {
  log(`[fatal] uncaught exception: ${error.message}\n${error.stack || ''}`);
  process.exit(1);
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  log('Twitter Comment Pack starting...');
  const cfg = loadConfig();
  initStore('data/store.db');
  const rateStr = typeof cfg.commentsPerHour === 'object'
    ? `${cfg.commentsPerHour.min}-${cfg.commentsPerHour.max}/hr (random)`
    : `${cfg.commentsPerHour}/hr`;
  log(`Mode: List Comment | AI(comment): ${cfg.llm.comment.provider} | AI(router): ${cfg.llm.router.provider} | Rate: ${rateStr}`);

  // Main loop - always run list comment mode
  while (true) {
    try {
      await runListMode(cfg, log);
    } catch (e) {
      log(`Loop error: ${e.message}`);
      if (/SESSION_EXPIRED|401|403/.test(e.message)) {
        process.exit(1);
      }
    }
    // Sleep between full cycles
    const cycleSleep = 5 * 60 * 1000 + Math.floor(Math.random() * 5 * 60 * 1000);
    log(`Cycle done. Sleeping ${Math.round(cycleSleep / 60000)} min before next cycle.`);
    await sleep(cycleSleep);
  }
}

main().catch(async (e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
