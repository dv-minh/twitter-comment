import { commentsInLastHour } from './store.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let currentCap = null;
let lastCapReset = 0;
let currentBatchSize = null;
let postsInCurrentBatch = 0;
let lastBatchBreakTime = 0;
let currentNumBatches = 0;

export async function waitForSlot(cfg, log) {
  while (true) {
    let cap;
    const now = Date.now();

    // Initialize or randomize cap & batch strategy at start of hour
    if (typeof cfg.commentsPerHour === 'object' && cfg.commentsPerHour !== null) {
      const min = cfg.commentsPerHour.min;
      const max = cfg.commentsPerHour.max;
      if (currentCap === null || now - lastCapReset >= 60 * 60 * 1000) {
        currentCap = Math.floor(Math.random() * (max - min + 1)) + min;
        currentNumBatches = 2 + Math.floor(Math.random() * 2); // 2 or 3 batches
        currentBatchSize = Math.ceil(currentCap / currentNumBatches);
        postsInCurrentBatch = 0;
        lastBatchBreakTime = now;
        lastCapReset = now;
        log(`[rate] randomized to ${currentCap}/hr in ${currentNumBatches} batches (~${currentBatchSize} posts/batch)`);
      }
      cap = currentCap;
    } else {
      cap = cfg.commentsPerHour;
      if (currentCap === null) {
        currentNumBatches = 2 + Math.floor(Math.random() * 2);
        currentBatchSize = Math.ceil(cap / currentNumBatches);
        postsInCurrentBatch = 0;
        lastBatchBreakTime = now;
        lastCapReset = now;
        log(`[rate] fixed ${cap}/hr in ${currentNumBatches} batches (~${currentBatchSize} posts/batch)`);
      }
    }

    // Check if current batch is complete → take a break
    if (postsInCurrentBatch >= currentBatchSize && now - lastBatchBreakTime > 100) {
      const batchBreakMs = 10 * 60 * 1000 + Math.floor(Math.random() * 5 * 60 * 1000); // 10-15 min
      log(`[rate] batch complete (${postsInCurrentBatch}/${currentBatchSize}) — batch break ${Math.round(batchBreakMs / 1000)}s`);
      await sleep(batchBreakMs);
      postsInCurrentBatch = 0;
      lastBatchBreakTime = now;
    }

    // Check hourly cap (don't exceed total for the hour)
    const count = commentsInLastHour();
    if (count < cap) return;
    
    const waitMs = 5 * 60_000 + Math.floor(Math.random() * 60_000);
    log(`[rate] cap ${count}/${cap} reached — sleeping ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
}

// Call this after a post is successfully made to track batch progress
export function markPostInBatch() {
  postsInCurrentBatch++;
}

export async function postSleep(cfg, log) {
  const { delayMinMs = 60_000, delayMaxMs = 240_000 } = cfg;
  const ms = delayMinMs + Math.floor(Math.random() * Math.max(1, delayMaxMs - delayMinMs));
  log(`[rate] post-sleep ${Math.round(ms / 1000)}s`);
  await sleep(ms);
}
