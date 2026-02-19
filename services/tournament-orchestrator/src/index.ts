import 'dotenv/config';
import http from 'node:http';
import { getChainConfig, isDeployed } from './chains/index.js';
import { MonadClient } from './chains/client.js';
import { TournamentManager } from './lifecycle/TournamentManager.js';
import { SwissPairing } from './pairing/SwissPairing.js';
import { TournamentRunner } from './runtime/TournamentRunner.js';
import { ChessEngineClient } from './runtime/ChessEngineClient.js';
import { StateManager } from './runtime/StateManager.js';
import type { TournamentConfig, TournamentTier, TournamentFormat } from './types/index.js';
import { MatchPairing } from './pairing/MatchPairing.js';
import { RoundRobinPairing } from './pairing/RoundRobinPairing.js';
import { TeamPairing } from './pairing/TeamPairing.js';
import { createPairingEngine } from './pairing/PairingFactory.js';
import { createScoringStrategy } from './lifecycle/ScoringStrategy.js';

// Re-export for library usage
export { TournamentManager, SwissPairing, MonadClient, TournamentRunner, ChessEngineClient, StateManager };
export { MatchPairing, RoundRobinPairing, TeamPairing, createPairingEngine, createScoringStrategy };
export { getChainConfig, isDeployed };
export * from './types/index.js';

// Format mapping: on-chain uint8 → string
const FORMAT_NAMES: TournamentFormat[] = ['swiss', 'match', 'team', 'league'];

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
    console.log('  orchestrator create <format> [options]  - Create a tournament on-chain');
    console.log('');
    console.log('Create formats:');
    console.log('  create swiss  --tier <tier> --max <N> --min <N>');
    console.log('  create league --tier <tier> --max <N> --min <N>');
    console.log('  create match  --tier <tier> --best-of <1|3|5> [--opponent <addr>]');
    console.log('  create team   --tier <tier> --max-teams <N> --min-teams <N> --team-size <N>');
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
  const gatewayUrl = process.env.GATEWAY_URL || '';
  const serviceKey = process.env.SERVICE_API_KEY || '';
  const freeTierPrizeUsdc = parseFloat(process.env.FREE_TOURNAMENT_PRIZE_USDC || '0');

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
      const tournamentIdArg = process.argv[3];
      if (tournamentIdArg === undefined || tournamentIdArg === '') {
        log('error', 'Usage: orchestrator run <tournament-id> <wallet1,wallet2,...>');
        process.exit(1);
      }
      const tournamentId = parseInt(tournamentIdArg);

      const t = await chain.getTournament(BigInt(tournamentId));
      if (!t.exists) {
        log('error', `Tournament ${tournamentId} not found on-chain`, { tournamentId });
        process.exit(1);
      }

      const TIER_NAMES: TournamentTier[] = ['rookie', 'bronze', 'silver', 'masters', 'legends', 'free'];
      const tier = TIER_NAMES[t.tier] || 'rookie';
      const format = FORMAT_NAMES[t.format ?? 0] || 'swiss';
      const defaults = TIER_DEFAULTS[tier];

      const config: TournamentConfig = {
        tournamentId,
        tier,
        format,
        maxPlayers: t.maxPlayers,
        minPlayers: t.minPlayers,
        totalRounds: t.totalRounds,
        timeControl: {
          baseTimeSeconds: t.baseTimeSeconds || defaults.timeControl.baseTimeSeconds,
          incrementSeconds: t.incrementSeconds || defaults.timeControl.incrementSeconds,
        },
        freeTierPrizeUsdc: tier === 'free' ? freeTierPrizeUsdc : undefined,
        bestOf: t.bestOf,
        teamSize: t.teamSize,
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

      const runner = new TournamentRunner(chain, engine, config, stateManager, gatewayUrl, serviceKey);
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

      // Track tournaments currently being run so we don't double-trigger
      const runningTournaments = new Set<number>();
      // Track tournaments that are done (non-registration status or already ran)
      const completedTournaments = new Set<number>();
      // Track when minPlayers was first detected — starts a short grace period before launching
      const minPlayersReadyAt = new Map<number, number>();
      // Grace period (seconds) after minPlayers reached before starting (allows late joins)
      const EARLY_START_GRACE_SEC = 30;

      // ── Health check HTTP server for Railway liveness probes ──
      const healthPort = parseInt(process.env.HEALTH_PORT || process.env.PORT || '3003');
      const startedAt = new Date().toISOString();
      const healthServer = http.createServer((req, res) => {
        if (req.url === '/api/health' && req.method === 'GET') {
          const payload = JSON.stringify({
            status: 'ok',
            service: 'tournament-orchestrator',
            mode: 'watch',
            uptime: process.uptime(),
            startedAt,
            runningTournaments: runningTournaments.size,
            completedTournaments: completedTournaments.size,
          });
          res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(payload);
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      healthServer.listen(healthPort, '0.0.0.0', () => {
        log('info', `Health endpoint listening on :${healthPort}/api/health`);
      });

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

          // Tournament IDs are 0-indexed: iterate from 0 to totalTournaments - 1
          // Re-check ALL tournaments each poll (skipping completed/running ones)
          for (let id = 0; id < totalTournaments; id++) {
            if (isShuttingDown) break;
            if (runningTournaments.has(id)) continue;
            if (completedTournaments.has(id)) continue;

            const t = await chain.getTournament(BigInt(id));
            if (!t.exists) {
              completedTournaments.add(id);
              continue;
            }

            // Skip completed/cancelled tournaments (4 = Completed, 5 = Cancelled)
            if (t.status >= 4) {
              completedTournaments.add(id);
              continue;
            }

            // Also skip RoundComplete (3) — waiting for on-chain advancement
            if (t.status === 3) {
              continue;
            }

            // Helper: build config and launch runner for a tournament
            const launchRunner = async (reason: string) => {
              log('info', `Tournament #${id} ${reason} — launching runner`, {
                tournamentId: id,
                status: t.status,
                playerCount: t.registeredCount,
                tier: t.tier,
              });

              const wallets = await chain.getRegisteredWallets(BigInt(id), t.registeredCount);
              if (wallets.length < t.minPlayers) {
                log('warn', `Tournament #${id}: found ${wallets.length} wallets but need ${t.minPlayers}, skipping`, {
                  tournamentId: id,
                });
                return;
              }

              const TIER_NAMES: TournamentTier[] = ['rookie', 'bronze', 'silver', 'masters', 'legends', 'free'];
              const tier = TIER_NAMES[t.tier] || 'rookie';
              const format = FORMAT_NAMES[t.format ?? 0] || 'swiss';
              const defaults = TIER_DEFAULTS[tier];

              const config: TournamentConfig = {
                tournamentId: id,
                tier,
                format,
                maxPlayers: t.maxPlayers,
                minPlayers: t.minPlayers,
                totalRounds: t.totalRounds,
                timeControl: {
                  baseTimeSeconds: t.baseTimeSeconds || defaults.timeControl.baseTimeSeconds,
                  incrementSeconds: t.incrementSeconds || defaults.timeControl.incrementSeconds,
                },
                freeTierPrizeUsdc: tier === 'free' ? freeTierPrizeUsdc : undefined,
                bestOf: t.bestOf,
                teamSize: t.teamSize,
              };

              runningTournaments.add(id);
              completedTournaments.add(id);

              try {
                const runner = new TournamentRunner(chain, engine, config, stateManager, gatewayUrl, serviceKey);
                await runner.run(wallets);
                log('info', `Tournament #${id} completed successfully`, { tournamentId: id });
              } catch (err: any) {
                log('error', `Tournament #${id} failed`, {
                  tournamentId: id,
                  error: err.message,
                  stack: err.stack,
                });
              } finally {
                runningTournaments.delete(id);
              }
            };

            // Registration (status 0): start when full, start at deadline, or cancel if expired with too few players
            if (t.status === 0) {
              const deadline = Number(t.registrationDeadline);
              const now = Math.floor(Date.now() / 1000);
              const deadlinePassed = deadline > 0 && now >= deadline;

              // Notify the gateway about open tournaments so agents can discover them.
              // Pushes on every poll (not deduped) so the gateway always has fresh data,
              // even after a gateway restart. The gateway deduplicates internally.
              if (!deadlinePassed && gatewayUrl) {
                const entryFeeRaw = BigInt(t.entryFee ?? 0);
                const entryFee = Number(entryFeeRaw) / 1e6; // USDC has 6 decimals
                fetch(`${gatewayUrl}/api/internal/tournament-notify`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-service-key': serviceKey },
                  body: JSON.stringify({
                    tournamentId: id,
                    tournament: {
                      tier: t.tier, format: t.format ?? 0, entryFee, maxPlayers: t.maxPlayers,
                      startTime: Number(t.startTime), registrationDeadline: deadline,
                      baseTimeSeconds: t.baseTimeSeconds || 300, incrementSeconds: t.incrementSeconds || 3,
                    },
                  }),
                  signal: AbortSignal.timeout(5000),
                }).catch(err => log('warn', `Failed to notify gateway of tournament #${id}`, { error: (err as Error).message }));
              }

              if (t.registeredCount >= t.minPlayers) {
                // Start immediately if FULL — no more players can join anyway
                if (t.registeredCount >= t.maxPlayers) {
                  await launchRunner('full — starting immediately');
                  continue;
                }
                // minPlayers reached but not full — give a short grace period for
                // more players to join, then start. Track when we first noticed.
                if (!minPlayersReadyAt.has(id)) {
                  minPlayersReadyAt.set(id, now);
                  log('info', `Tournament #${id} has ${t.registeredCount}/${t.maxPlayers} players (min=${t.minPlayers}) — starting in ${EARLY_START_GRACE_SEC}s`, { tournamentId: id });
                }
                const readySince = minPlayersReadyAt.get(id)!;
                if (deadlinePassed || (now - readySince) >= EARLY_START_GRACE_SEC) {
                  minPlayersReadyAt.delete(id);
                  await launchRunner(`minPlayers reached (${t.registeredCount}/${t.maxPlayers}) — grace period elapsed`);
                  continue;
                }
              } else if (deadlinePassed) {
                // Deadline passed but not enough players — cancel this zombie tournament
                log('info', `Tournament #${id} expired with ${t.registeredCount}/${t.minPlayers} players — cancelling`, {
                  tournamentId: id,
                  registeredCount: t.registeredCount,
                  minPlayers: t.minPlayers,
                  deadline,
                });
                try {
                  await chain.cancelTournament(BigInt(id));
                  log('info', `Tournament #${id} cancelled on-chain`, { tournamentId: id });
                } catch (err: any) {
                  log('warn', `Failed to cancel tournament #${id}`, {
                    tournamentId: id,
                    error: (err as Error).message,
                  });
                }
                completedTournaments.add(id);
              }
              continue;
            }

            // InProgress (1) or RoundActive (2): resume — tournament was started but runner isn't running
            if (t.status === 1 || t.status === 2) {
              await launchRunner(`needs resume (status=${t.status}, round=${t.currentRound}/${t.totalRounds})`);
            }
          }
        } catch (err: any) {
          log('error', 'Poll error', { error: err.message });
        }

        // ── Auto-bump free tournament cap if nearing limit ──
        try {
          const proto = await chain.getProtocolState();
          const sponsoredFree = Number(proto[8]); // sponsoredFreeTournaments
          const maxFree = Number(proto[9]);        // maxFreeTournaments
          if (maxFree > 0 && maxFree - sponsoredFree <= 2) {
            const newLimit = Math.min(maxFree + 20, 255); // uint8 max = 255
            log('info', `Free tournament cap near limit (${sponsoredFree}/${maxFree}), bumping to ${newLimit}`);
            await chain.setFreeTournamentLimit(newLimit);
          }
        } catch (err: any) {
          log('warn', 'Failed to check/bump free tournament limit', { error: err.message });
        }

        // ── Auto-create: ensure there's always a tournament in registration ──
        try {
          const proto = await chain.getProtocolState();
          const totalTournaments = Number(proto[5]);
          const now = Math.floor(Date.now() / 1000);
          let hasRegistrationTournament = false;
          for (let id = Math.max(0, totalTournaments - 10); id < totalTournaments; id++) {
            if (completedTournaments.has(id) || runningTournaments.has(id)) continue;
            const t = await chain.getTournament(BigInt(id));
            if (t.exists && t.status === 0) {
              // Only count as active if deadline hasn't passed yet
              const deadline = Number(t.registrationDeadline);
              if (deadline <= 0 || now < deadline) {
                hasRegistrationTournament = true;
                break;
              }
            }
          }
          if (!hasRegistrationTournament) {
            await chain.createTournament(
              5, 0, 8, 2,                          // Free tier, Swiss, max=8, min=2
              BigInt(now + 120),                    // startTime: 2 min
              BigInt(now + 90),                     // deadline: 90s (bots join via websocket in <5s)
              300, 3,                               // 5 min + 3s increment
            );
            log('info', 'Auto-created free Swiss tournament (no registration tournaments found)');

            // Notify agent-gateway to broadcast to connected agents (fast-path)
            // Include tournament data so the gateway can broadcast without reading the chain (avoids RPC 429)
            if (gatewayUrl) {
              const newProto = await chain.getProtocolState();
              const newId = Number(newProto[5]) - 1;
              fetch(`${gatewayUrl}/api/internal/tournament-notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-service-key': serviceKey },
                body: JSON.stringify({
                  tournamentId: newId,
                  tournament: {
                    tier: 5, format: 0, entryFee: 0, maxPlayers: 8,
                    startTime: now + 120, registrationDeadline: now + 90,
                    baseTimeSeconds: 300, incrementSeconds: 3,
                  },
                }),
                signal: AbortSignal.timeout(5000),
              }).catch(err => log('warn', 'Failed to notify gateway of new tournament', { error: (err as Error).message }));
            }
          }
        } catch (err: any) {
          log('warn', 'Auto-create check failed', { error: err.message });
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      }

      log('info', 'Watch mode stopped gracefully');
      break;
    }

    case 'create': {
      const format = process.argv[3] as TournamentFormat | undefined;
      if (!format || !FORMAT_NAMES.includes(format)) {
        log('error', `Invalid format: ${format}. Must be one of: ${FORMAT_NAMES.join(', ')}`);
        process.exit(1);
      }

      // Parse --key value args
      const args = process.argv.slice(4);
      const getArg = (key: string, fallback?: string): string | undefined => {
        const idx = args.indexOf(`--${key}`);
        return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
      };

      const TIER_NAMES: TournamentTier[] = ['rookie', 'bronze', 'silver', 'masters', 'legends', 'free'];
      const tierName = (getArg('tier', 'free') || 'free') as TournamentTier;
      const tierIndex = TIER_NAMES.indexOf(tierName);
      if (tierIndex === -1) {
        log('error', `Invalid tier: ${tierName}. Must be one of: ${TIER_NAMES.join(', ')}`);
        process.exit(1);
      }

      const defaults = TIER_DEFAULTS[tierName];
      const now = Math.floor(Date.now() / 1000);
      const startTime = BigInt(now + 180); // 3 minutes from now
      const registrationDeadline = BigInt(now + 120); // 2 minutes from now
      const baseTime = parseInt(getArg('base-time') || String(defaults.timeControl.baseTimeSeconds));
      const increment = parseInt(getArg('increment') || String(defaults.timeControl.incrementSeconds));

      const formatIndex = FORMAT_NAMES.indexOf(format);

      let txHash: string;

      switch (format) {
        case 'swiss':
        case 'league': {
          const maxPlayers = parseInt(getArg('max', '8')!);
          const minPlayers = parseInt(getArg('min', '4')!);
          txHash = await chain.createTournament(
            tierIndex, formatIndex, maxPlayers, minPlayers,
            startTime, registrationDeadline, baseTime, increment,
          );
          log('info', `Created ${format} tournament`, {
            tier: tierName, maxPlayers, minPlayers, txHash,
          });
          break;
        }

        case 'match': {
          const bestOf = parseInt(getArg('best-of', '3')!);
          const opponent = (getArg('opponent') || '0x0000000000000000000000000000000000000000') as `0x${string}`;
          txHash = await chain.createMatchChallenge(
            tierIndex, startTime, registrationDeadline,
            baseTime, increment, bestOf, opponent,
          );
          log('info', `Created match challenge`, {
            tier: tierName, bestOf, opponent, txHash,
          });
          break;
        }

        case 'team': {
          const maxTeams = parseInt(getArg('max-teams', '4')!);
          const minTeams = parseInt(getArg('min-teams', '2')!);
          const teamSize = parseInt(getArg('team-size', '5')!);
          txHash = await chain.createTeamTournament(
            tierIndex, maxTeams, minTeams,
            startTime, registrationDeadline, baseTime, increment, teamSize,
          );
          log('info', `Created team tournament`, {
            tier: tierName, maxTeams, minTeams, teamSize, txHash,
          });
          break;
        }
      }

      // Read back the tournament to confirm
      const protocol = await chain.getProtocolState();
      const newId = Number(protocol[5]) - 1;
      console.log(`\nTournament created successfully!`);
      console.log(`  ID: ${newId}`);
      console.log(`  Format: ${format}`);
      console.log(`  Tier: ${tierName}`);
      console.log(`  Registration deadline: ${new Date(Number(registrationDeadline) * 1000).toISOString()}`);
      console.log(`  Start time: ${new Date(Number(startTime) * 1000).toISOString()}`);
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
