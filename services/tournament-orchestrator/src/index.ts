import 'dotenv/config';
import { getChainConfig, isDeployed } from './chains/index.js';
import { MonadClient } from './chains/client.js';
import { TournamentManager } from './lifecycle/TournamentManager.js';
import { SwissPairing } from './pairing/SwissPairing.js';
import { TournamentRunner } from './runtime/TournamentRunner.js';
import { ChessEngineClient } from './runtime/ChessEngineClient.js';
import { StateManager } from './runtime/StateManager.js';
import type { TournamentConfig, TournamentTier } from './types/index.js';

// Re-export for library usage
export { TournamentManager, SwissPairing, MonadClient, TournamentRunner, ChessEngineClient, StateManager };
export { getChainConfig, isDeployed };
export * from './types/index.js';

// TO-LOG1: Structured logger helper
function log(level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    service: 'tournament-orchestrator',
    message,
    ...meta,
  };
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ── Tier defaults ────────────────────────────────────────────────────────────

const TIER_DEFAULTS: Record<TournamentTier, { timeControl: { baseTimeSeconds: number; incrementSeconds: number } }> = {
  rookie:  { timeControl: { baseTimeSeconds: 300, incrementSeconds: 3 } },
  bronze:  { timeControl: { baseTimeSeconds: 600, incrementSeconds: 5 } },
  silver:  { timeControl: { baseTimeSeconds: 600, incrementSeconds: 5 } },
  masters: { timeControl: { baseTimeSeconds: 900, incrementSeconds: 10 } },
  legends: { timeControl: { baseTimeSeconds: 900, incrementSeconds: 10 } },
  free:    { timeControl: { baseTimeSeconds: 300, incrementSeconds: 3 } },
};

// ── Graceful shutdown ────────────────────────────────────────────────────────

let isShuttingDown = false;

function setupGracefulShutdown() {
  const shutdown = (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    log('info', `Received ${signal}, shutting down gracefully...`, { signal });
    // Allow current operations to complete for up to 30 seconds
    setTimeout(() => {
      log('error', 'Graceful shutdown timed out, forcing exit');
      process.exit(1);
    }, 30_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

async function main() {
  const command = process.argv[2];

  if (!command) {
    console.log('ChessBots Tournament Orchestrator');
    console.log('');
    console.log('Usage:');
    console.log('  orchestrator watch              - Watch for tournaments and run them');
    console.log('  orchestrator run <id> <wallets>  - Run a specific tournament');
    console.log('  orchestrator status              - Show protocol state');
    console.log('');
    return;
  }

  setupGracefulShutdown();

  if (!isDeployed()) {
    log('error', 'Contract not deployed or PRIVATE_KEY not set');
    process.exit(1);
  }

  const chainConfig = getChainConfig();
  const chain = new MonadClient(chainConfig);
  const engineUrl = process.env.CHESS_ENGINE_URL || 'http://localhost:3001';
  const engine = new ChessEngineClient(engineUrl);
  const stateManager = new StateManager();

  switch (command) {
    case 'status': {
      const protocol = await chain.getProtocolState();
      console.log('Protocol State:');
      console.log(`  Authority: ${protocol[0]}`);
      console.log(`  Treasury: ${protocol[1]}`);
      console.log(`  Protocol Fee: ${protocol[2]} bps`);
      console.log(`  Buyback Share: ${protocol[3]} bps`);
      console.log(`  Treasury Share: ${protocol[4]} bps`);
      console.log(`  Total Tournaments: ${protocol[5]}`);
      console.log(`  Total Prize Distributed: ${Number(protocol[6]) / 1e6} USDC`);
      console.log(`  Paused: ${protocol[7]}`);
      break;
    }

    case 'run': {
      const tournamentId = parseInt(process.argv[3] || '0');
      if (!tournamentId) {
        log('error', 'Usage: orchestrator run <tournament-id> <wallet1,wallet2,...>');
        process.exit(1);
      }

      const t = await chain.getTournament(BigInt(tournamentId));
      if (!t.exists) {
        log('error', `Tournament ${tournamentId} not found on-chain`, { tournamentId });
        process.exit(1);
      }

      const tier = (['rookie', 'bronze', 'silver', 'masters', 'legends'] as const)[t.tier] || 'rookie';
      const defaults = TIER_DEFAULTS[tier];

      const config: TournamentConfig = {
        tournamentId,
        tier,
        maxPlayers: t.maxPlayers,
        minPlayers: t.minPlayers,
        totalRounds: t.totalRounds,
        timeControl: {
          baseTimeSeconds: t.baseTimeSeconds || defaults.timeControl.baseTimeSeconds,
          incrementSeconds: t.incrementSeconds || defaults.timeControl.incrementSeconds,
        },
      };

      const playerWalletsArg = process.argv[4];
      if (!playerWalletsArg) {
        log('error', 'Usage: orchestrator run <tournament-id> <wallet1,wallet2,...>');
        process.exit(1);
      }
      const registeredWallets = playerWalletsArg.split(',');

      try {
        await engine.healthCheck();
        log('info', 'Chess engine connected', { url: engineUrl });
      } catch {
        log('error', 'Cannot reach chess engine', { url: engineUrl });
        process.exit(1);
      }

      const runner = new TournamentRunner(chain, engine, config, stateManager);
      await runner.run(registeredWallets);
      break;
    }

    case 'watch': {
      log('info', 'Watch mode starting', { engineUrl, contract: chainConfig.contractAddress });

      try {
        await engine.healthCheck();
        log('info', 'Chess engine connected');
      } catch {
        log('error', 'Cannot reach chess engine', { url: engineUrl });
        process.exit(1);
      }

      // TO-SM: Recover lastCheckedId from state
      let lastCheckedId = stateManager.getLastCheckedId();
      if (lastCheckedId > 0) {
        log('info', 'Recovered state from disk', { lastCheckedId });
      }

      // TO-SM: Check for recoverable tournaments on startup
      const recoverable = stateManager.getRecoverableTournaments();
      if (recoverable.length > 0) {
        log('warn', `Found ${recoverable.length} tournaments in progress from previous run`, {
          tournamentIds: recoverable.map(t => t.tournamentId),
        });
        // Log but don't auto-recover — manual intervention required for in-progress tournaments
        // as game state on the chess engine may have been lost
      }

      // TO-PI1: Validate poll interval bounds (1s min, 5min max)
      const rawPollInterval = parseInt(process.env.POLL_INTERVAL_MS || '10000');
      const pollInterval = Math.max(1000, Math.min(300_000, isNaN(rawPollInterval) ? 10_000 : rawPollInterval));
      if (rawPollInterval !== pollInterval) {
        log('warn', `POLL_INTERVAL_MS clamped to ${pollInterval}ms (was ${process.env.POLL_INTERVAL_MS})`, { pollInterval });
      }

      while (!isShuttingDown) {
        try {
          const protocol = await chain.getProtocolState();
          const totalTournaments = Number(protocol[5]);

          for (let id = lastCheckedId + 1; id <= totalTournaments; id++) {
            if (isShuttingDown) break;
            const t = await chain.getTournament(BigInt(id));
            if (!t.exists) continue;

            if (t.status === 0 && t.registeredCount >= t.minPlayers) {
              const deadline = Number(t.registrationDeadline);
              const now = Math.floor(Date.now() / 1000);
              if (deadline > 0 && now >= deadline) {
                log('info', `Tournament #${id} ready`, {
                  tournamentId: id,
                  playerCount: t.registeredCount,
                  tier: t.tier,
                });
              }
            }
          }
          lastCheckedId = totalTournaments;
          stateManager.setLastCheckedId(lastCheckedId);
        } catch (err: any) {
          log('error', 'Poll error', { error: err.message });
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      log('info', 'Watch mode stopped gracefully');
      break;
    }

    default:
      log('error', `Unknown command: ${command}`);
      process.exit(1);
  }
}

// Only run main when executed directly
if (process.argv[1]?.includes('index')) {
  main().catch((err) => {
    log('error', 'Fatal error', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
