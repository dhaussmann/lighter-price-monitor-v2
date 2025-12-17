#!/usr/bin/env node

/**
 * Init Script - Start all Exchange Trackers
 *
 * Automatically connects to and starts:
 * - Lighter Tracker
 * - Paradex Tracker
 * - Hyperliquid Tracker
 */

const WebSocket = require('ws');

// Configuration
const WORKER_URL = process.env.WORKER_URL || 'lighter-orderbook-tracker.cloudflareone-demo-account.workers.dev';
const TRACKERS = [
  { name: 'Lighter', path: '/ws/lighter' },
  { name: 'Paradex', path: '/ws/paradex' },
  { name: 'Hyperliquid', path: '/ws/hyperliquid' }
];

const TIMEOUT = 10000; // 10 seconds timeout per tracker

console.log('🚀 Exchange Tracker Initialization Script');
console.log('==========================================\n');

async function startTracker(name, path) {
  return new Promise((resolve, reject) => {
    const wsUrl = `wss://${WORKER_URL}${path}`;
    console.log(`[${name}] 🔌 Connecting to ${wsUrl}...`);

    const ws = new WebSocket(wsUrl);
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        reject(new Error(`Timeout after ${TIMEOUT}ms`));
      }
    }, TIMEOUT);

    ws.on('open', () => {
      console.log(`[${name}] ✅ WebSocket connected`);
      console.log(`[${name}] ▶  Sending start_tracking command...`);

      ws.send(JSON.stringify({ type: 'start_tracking' }));
    });

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.type === 'control') {
          clearTimeout(timeout);

          if (message.data.success) {
            console.log(`[${name}] ✅ ${message.data.message}`);
            if (message.data.markets) {
              console.log(`[${name}] 📊 Tracking ${message.data.markets} markets`);
            }
            resolved = true;
            ws.close();
            resolve({ name, success: true, data: message.data });
          } else {
            console.log(`[${name}] ⚠️  ${message.data.message}`);
            resolved = true;
            ws.close();
            resolve({ name, success: false, message: message.data.message });
          }
        } else if (message.type === 'stats') {
          console.log(`[${name}] 📊 Current stats:`, {
            isTracking: message.data.isTracking,
            markets: message.data.markets,
            messages: message.data.messagesReceived
          });
        }
      } catch (error) {
        console.error(`[${name}] ❌ Failed to parse message:`, error.message);
      }
    });

    ws.on('error', (error) => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        console.error(`[${name}] ❌ WebSocket error:`, error.message);
        reject(error);
      }
    });

    ws.on('close', () => {
      clearTimeout(timeout);
      if (!resolved) {
        resolved = true;
        resolve({ name, success: false, message: 'Connection closed unexpectedly' });
      }
    });
  });
}

async function checkStats(name, path) {
  const apiUrl = `https://${WORKER_URL}/api/${name.toLowerCase()}/stats`;
  console.log(`[${name}] 📊 Checking stats: ${apiUrl}`);

  try {
    const response = await fetch(apiUrl);
    const stats = await response.json();
    console.log(`[${name}] Stats:`, {
      isTracking: stats.isTracking,
      markets: stats.markets,
      database: stats.database
    });
    return stats;
  } catch (error) {
    console.error(`[${name}] ❌ Failed to fetch stats:`, error.message);
    return null;
  }
}

async function main() {
  const results = [];

  // Start all trackers sequentially
  for (const tracker of TRACKERS) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Starting ${tracker.name} Tracker`);
    console.log('='.repeat(50));

    try {
      const result = await startTracker(tracker.name, tracker.path);
      results.push(result);

      // Wait a bit before starting next tracker
      if (TRACKERS.indexOf(tracker) < TRACKERS.length - 1) {
        console.log(`\n⏳ Waiting 2 seconds before next tracker...\n`);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      console.error(`[${tracker.name}] ❌ Failed to start:`, error.message);
      results.push({ name: tracker.name, success: false, error: error.message });
    }
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log('📊 INITIALIZATION SUMMARY');
  console.log('='.repeat(50) + '\n');

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    const status = result.success ? 'Started' : 'Failed';
    console.log(`${icon} ${result.name}: ${status}`);
    if (!result.success && result.message) {
      console.log(`   └─ ${result.message}`);
    }
  });

  console.log(`\n📈 Total: ${successful} succeeded, ${failed} failed\n`);

  // Optional: Check all stats after initialization
  if (process.argv.includes('--verify')) {
    console.log('🔍 Verifying tracker states...\n');
    for (const tracker of TRACKERS) {
      await checkStats(tracker.name, tracker.path);
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('\n❌ Unhandled error:', error);
  process.exit(1);
});

// Run
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
