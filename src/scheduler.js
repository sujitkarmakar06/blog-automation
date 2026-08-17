'use strict';

const store = require('./store');
const { publishPost } = require('./publisher');

/**
 * Polling scheduler: every INTERVAL it publishes any 'scheduled' post whose
 * time is due (across all users). Good for an MVP/single-node deployment;
 * swap for a real job queue (BullMQ / cloud cron) with retries at scale.
 */
const INTERVAL_MS = 15 * 1000;
let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const due = await store.posts.dueScheduled(10);
    for (const row of due) {
      console.log(`[scheduler] publishing due post #${row.id}`);
      const res = await publishPost(row.id);
      console.log(`[scheduler] post #${row.id} -> ${res.ok ? 'published' : 'FAILED: ' + res.message}`);
    }
  } catch (e) {
    console.error('[scheduler] error:', e.message);
  } finally {
    running = false;
  }
}

function start() {
  if (timer) return;
  console.log(`[scheduler] started (polling every ${INTERVAL_MS / 1000}s)`);
  timer = setInterval(tick, INTERVAL_MS);
  tick();
}
function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { start, stop, tick };
