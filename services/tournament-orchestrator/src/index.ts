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
  rookie:  { timeControl: { baseTimeSeconds: 60,  incrementSeconds: 2 } },
  bronze:  { timeControl: { baseTimeSeconds: 60,  incrementSeconds: 2 } },
  silver:  { timeControl: { baseTimeSeconds: 90,  incrementSeconds: 2 } },
  masters: { timeControl: { baseTimeSeconds: 120, incrementSeconds: 3 } },
  legends: { timeControl: { baseTimeSeconds: 120, incrementSeconds: 3 } },
  free:    { timeControl: { baseTimeSeconds: 60,  incrementSeconds: 2 } },
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
  // GATEWAY_URL is REQUIRED for agents to receive game notifications.
  // Default to the Railway production URL if not explicitly set.
  const gatewayUrl = process.env.GATEWAY_URL || 'https://agent-gateway-production-590d.up.railway.app';
  if (!process.env.GATEWAY_URL) {
    log('warn', 'GATEWAY_URL not set — using default production gateway URL', { gatewayUrl });
  }
  const serviceKey = process.env.SERVICE_API_KEY || '';
  const freeTierPrizeUsdc = parseFloat(process.env.FREE_TOURNAMENT_PRIZE_USDC || '0');

  switch (command) {
    case 'status': {
      const protocol = await chain.getProtocolState();
      console.log('Protocol State:');
      console.log(`  Authority: ${protocol[0]}`);
      console.log(`  Treasury: ${protocol[1]}`);
      console.log(`  Total Tournaments: ${protocol[2]}`);
      console.log(`  Total Prize Distributed: ${Number(protocol[3]) / 1e6} USDC`);
      console.log(`  Paused: ${protocol[4]}`);
      console.log(`  Sponsored Free: ${protocol[5]}`);
      console.log(`  Max Free: ${protocol[6]}`);
      break;
    }

    case 'run': {
      const tournamentIdArg = process.argv[3];
      if (tournamentIdArg === undefined || tournamentIdArg === '') {
        log('error', 'Usage: orchestrator run <tournament-id> <wallet1,wallet2,...> [--v4]');
        process.exit(1);
      }
      const tournamentId = parseInt(tournamentIdArg);

      // Detect V4: --v4 flag or try V4 first then V3
      const forceV4 = process.argv.includes('--v4');
      let t: any;
      let isV4 = forceV4;

      if (forceV4) {
        t = await chain.getV4Tournament(BigInt(tournamentId));
      } else {
        // Try V4 first, fall back to V3
        try {
          const v4t = await chain.getV4Tournament(BigInt(tournamentId));
          if (v4t.exists) {
            t = v4t;
            isV4 = true;
          }
        } catch { /* V4 lookup failed, try V3 */ }
        if (!t) {
          t = await chain.getTournament(BigInt(tournamentId));
        }
      }

      if (!t.exists) {
        log('error', `Tournament ${tournamentId} not found on-chain (checked ${isV4 ? 'V4' : 'V3 and V4'})`, { tournamentId });
        process.exit(1);
      }

      log('info', `Running tournament #${tournamentId} on ${isV4 ? 'V4' : 'V3'} contract`);

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
        useV4: isV4,
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
      // Track failure count per tournament to avoid infinite retries consuming runner slots
      const failureCount = new Map<number, number>();
      const lastErrors = new Map<number, string>();
      const MAX_FAILURES = 3; // After 3 failures, skip the tournament permanently
      // Grace period (seconds) after minPlayers reached before starting (allows late joins)
      const EARLY_START_GRACE_SEC = 15;
      // Max concurrent tournament runners. Set to 1 because all runners share a single
      // wallet, and concurrent on-chain transactions cause nonce collisions ("An existing
      // transaction had higher priority"). Sequential execution is more reliable.
      const MAX_CONCURRENT_RUNNERS = 1;

      // ── Health check HTTP server for Railway liveness probes ──
      const healthPort = parseInt(process.env.HEALTH_PORT || process.env.PORT || '3003');
      const startedAt = new Date().toISOString();
      const healthServer = http.createServer((req, res) => {
        if (req.url === '/api/health' && req.method === 'GET') {
          const failedTournaments = Array.from(failureCount.entries())
            .filter(([_, count]) => count >= MAX_FAILURES)
            .map(([id]) => id);
          const recentErrors = Object.fromEntries(
            Array.from(lastErrors.entries()).slice(-10)
          );
          const payload = JSON.stringify({
            status: 'ok',
            service: 'tournament-orchestrator',
            mode: 'watch',
            uptime: process.uptime(),
            startedAt,
            runningTournaments: runningTournaments.size,
            completedTournaments: completedTournaments.size,
            permanentlySkipped: failedTournaments.length,
            skippedIds: failedTournaments.slice(0, 20),
            recentErrors,
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
        // ── Scan helper: shared logic for scanning V3 or V4 contract ──
        const scanContract = async (isV4: boolean) => {
          const protocol = isV4
            ? await chain.getV4ProtocolState()
            : await chain.getProtocolState();
          const totalTournaments = Number(protocol[2]);
          const contractLabel = isV4 ? 'V4' : 'V3';

          // Tournament IDs are 0-indexed: iterate from 0 to totalTournaments - 1
          // Only check recent tournaments (last 30) to avoid scanning the full history.
          // Scan NEWEST first (descending) so new Registration tournaments get priority
          const scanStart = Math.max(0, totalTournaments - 30);
          for (let id = totalTournaments - 1; id >= scanStart; id--) {
            if (isShuttingDown) break;
            // Use composite key for V4 to avoid ID collisions with V3
            const trackingKey = isV4 ? id + 100_000 : id;
            if (runningTournaments.has(trackingKey)) continue;
            if (completedTournaments.has(trackingKey)) continue;
            if ((failureCount.get(trackingKey) || 0) >= MAX_FAILURES) {
              completedTournaments.add(trackingKey);
              log('warn', `${contractLabel} Tournament #${id} permanently skipped after ${MAX_FAILURES} failures`, { tournamentId: id });
              continue;
            }

            const t = isV4
              ? await chain.getV4Tournament(BigInt(id))
              : await chain.getTournament(BigInt(id));
            if (!t.exists) {
              completedTournaments.add(trackingKey);
              continue;
            }

            if (t.status >= 4) {
              completedTournaments.add(trackingKey);
              continue;
            }

            if (t.status === 3) {
              continue;
            }

            const launchRunner = (reason: string) => {
              runningTournaments.add(trackingKey);
              completedTournaments.add(trackingKey);

              log('info', `${contractLabel} Tournament #${id} ${reason} — launching runner`, {
                tournamentId: id,
                contract: contractLabel,
                status: t.status,
                playerCount: t.registeredCount,
                tier: t.tier,
                concurrentRunners: runningTournaments.size,
              });

              (async () => {
                try {
                  const wallets = isV4
                    ? await chain.getV4RegisteredWallets(BigInt(id), t.registeredCount)
                    : await chain.getRegisteredWallets(BigInt(id), t.registeredCount);
                  if (wallets.length < t.minPlayers) {
                    log('warn', `${contractLabel} Tournament #${id}: found ${wallets.length} wallets but need ${t.minPlayers}, skipping`, {
                      tournamentId: id,
                    });
                    runningTournaments.delete(trackingKey);
                    completedTournaments.delete(trackingKey);
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
                    useV4: isV4,
                  };

                  const runner = new TournamentRunner(chain, engine, config, stateManager, gatewayUrl, serviceKey);
                  await runner.run(wallets);
                  log('info', `${contractLabel} Tournament #${id} completed successfully`, { tournamentId: id });
                } catch (err: any) {
                  const failures = (failureCount.get(trackingKey) || 0) + 1;
                  failureCount.set(trackingKey, failures);
                  lastErrors.set(trackingKey, `${err.message}`.slice(0, 200));
                  log('error', `${contractLabel} Tournament #${id} failed (attempt ${failures}/${MAX_FAILURES}) — ${failures >= MAX_FAILURES ? 'permanently skipping' : 'will retry'}`, {
                    tournamentId: id,
                    error: err.message,
                    failures,
                  });
                  completedTournaments.delete(trackingKey);
                } finally {
                  runningTournaments.delete(trackingKey);
                }
              })();
            };

            if (t.status === 0) {
              const deadline = Number(t.registrationDeadline);
              const now = Math.floor(Date.now() / 1000);
              const deadlinePassed = deadline > 0 && now >= deadline;

              if (!deadlinePassed && gatewayUrl) {
                const entryFeeRaw = BigInt(t.entryFee ?? 0);
                const entryFee = Number(entryFeeRaw) / 1e6;
                fetch(`${gatewayUrl}/api/internal/tournament-notify`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-service-key': serviceKey },
                  body: JSON.stringify({
                    tournamentId: id,
                    tournament: {
                      tier: t.tier, format: t.format ?? 0, entryFee, maxPlayers: t.maxPlayers,
                      startTime: Number(t.startTime), registrationDeadline: deadline,
                      baseTimeSeconds: t.baseTimeSeconds || 300, incrementSeconds: t.incrementSeconds || 3,
                      isV4,
                    },
                  }),
                  signal: AbortSignal.timeout(5000),
                }).catch(err => log('warn', `Failed to notify gateway of ${contractLabel} tournament #${id}`, { error: (err as Error).message }));
              }

              if (t.registeredCount >= t.minPlayers) {
                if (t.registeredCount >= t.maxPlayers) {
                  if (runningTournaments.size >= MAX_CONCURRENT_RUNNERS) {
                    log('info', `${contractLabel} Tournament #${id} full but ${runningTournaments.size} runners active — deferring`, { tournamentId: id });
                  } else {
                    launchRunner('full — starting immediately');
                  }
                  continue;
                }
                const minKey = isV4 ? trackingKey : id;
                if (!minPlayersReadyAt.has(minKey)) {
                  minPlayersReadyAt.set(minKey, now);
                  log('info', `${contractLabel} Tournament #${id} has ${t.registeredCount}/${t.maxPlayers} players (min=${t.minPlayers}) — starting in ${EARLY_START_GRACE_SEC}s`, { tournamentId: id });
                }
                const readySince = minPlayersReadyAt.get(minKey)!;
                if (deadlinePassed || (now - readySince) >= EARLY_START_GRACE_SEC) {
                  if (runningTournaments.size >= MAX_CONCURRENT_RUNNERS) {
                    log('info', `${contractLabel} Tournament #${id} ready but ${runningTournaments.size} runners active — deferring`, { tournamentId: id });
                  } else {
                    minPlayersReadyAt.delete(minKey);
                    launchRunner(`minPlayers reached (${t.registeredCount}/${t.maxPlayers}) — grace period elapsed`);
                  }
                  continue;
                }
              } else if (deadlinePassed) {
                log('info', `${contractLabel} Tournament #${id} expired with ${t.registeredCount}/${t.minPlayers} players — cancelling`, {
                  tournamentId: id,
                  registeredCount: t.registeredCount,
                  minPlayers: t.minPlayers,
                  deadline,
                });
                try {
                  if (isV4) {
                    await chain.cancelV4Tournament(BigInt(id));
                  } else {
                    await chain.cancelTournament(BigInt(id));
                  }
                  log('info', `${contractLabel} Tournament #${id} cancelled on-chain`, { tournamentId: id });
                } catch (err: any) {
                  log('warn', `Failed to cancel ${contractLabel} tournament #${id}`, {
                    tournamentId: id,
                    error: (err as Error).message,
                  });
                }
                completedTournaments.add(trackingKey);
              }
              continue;
            }

            if (t.status === 1 || t.status === 2) {
              if (runningTournaments.size >= MAX_CONCURRENT_RUNNERS) {
                log('info', `${contractLabel} Tournament #${id} needs resume but ${runningTournaments.size} runners active — deferring`, { tournamentId: id });
              } else {
                launchRunner(`needs resume (status=${t.status}, round=${t.currentRound}/${t.totalRounds})`);
              }
            }
          }
        };

        try {
          // Scan V4 contract first (priority), then V3 for backward compat
          await scanContract(true);  // V4
          await scanContract(false); // V3
        } catch (err: any) {
          log('error', 'Poll error', { error: err.message });
        }

        // ── Auto-bump free tournament cap if nearing limit ──
        try {
          const proto = await chain.getProtocolState();
          const sponsoredFree = Number(proto[5]); // sponsoredFreeTournaments
          const maxFree = Number(proto[6]);        // maxFreeTournaments
          if (maxFree > 0 && maxFree - sponsoredFree <= 2) {
            const newLimit = Math.min(maxFree + 50, 65535); // uint16 max = 65535
            log('info', `Free tournament cap near limit (${sponsoredFree}/${maxFree}), bumping to ${newLimit}`);
            await chain.setFreeTournamentLimit(newLimit);
          }
        } catch (err: any) {
          log('warn', 'Failed to check/bump free tournament limit', { error: err.message });
        }

        // ── Auto-create: ensure there's one tournament per game type in registration ──
        // Now creates on V4 contract. Checks both V3 and V4 for existing open tournaments
        // to avoid creating duplicates during the transition period.
        try {
          const now = Math.floor(Date.now() / 1000);
          const openGameTypes = new Set<string>();

          // Check V4 for open tournaments
          try {
            const v4Proto = await chain.getV4ProtocolState();
            const v4Total = Number(v4Proto[2]);
            for (let id = Math.max(0, v4Total - 20); id < v4Total; id++) {
              const trackingKey = id + 100_000;
              if (completedTournaments.has(trackingKey) || runningTournaments.has(trackingKey)) continue;
              const t = await chain.getV4Tournament(BigInt(id));
              if (t.exists && t.status === 0) {
                const deadline = Number(t.registrationDeadline);
                if (deadline <= 0 || now < deadline) {
                  openGameTypes.add(`${t.tier}:${t.format ?? 0}`);
                }
              }
            }
          } catch (err: any) {
            log('warn', 'Failed to scan V4 for open tournaments', { error: err.message });
          }

          // Also check V3 for open tournaments (transition period)
          try {
            const v3Proto = await chain.getProtocolState();
            const v3Total = Number(v3Proto[2]);
            for (let id = Math.max(0, v3Total - 20); id < v3Total; id++) {
              if (completedTournaments.has(id) || runningTournaments.has(id)) continue;
              const t = await chain.getTournament(BigInt(id));
              if (t.exists && t.status === 0) {
                const deadline = Number(t.registrationDeadline);
                if (deadline <= 0 || now < deadline) {
                  openGameTypes.add(`${t.tier}:${t.format ?? 0}`);
                }
              }
            }
          } catch (err: any) {
            log('warn', 'Failed to scan V3 for open tournaments', { error: err.message });
          }

          // Helper to auto-create a V4 tournament if not already open
          const autoCreateIfNeeded = async (
            tier: number, format: number, maxPlayers: number, minPlayers: number,
            baseTime: number, increment: number, label: string,
          ) => {
            const key = `${tier}:${format}`;
            if (openGameTypes.has(key)) return;

            await chain.createV4Tournament(
              tier, format, 4, // bracket=4 (Open) — enum: Unrated=0,ClassC=1,ClassB=2,ClassA=3,Open=4
              maxPlayers, minPlayers,
              BigInt(now + 360),      // start 6 min from now
              BigInt(now + 300),      // registration closes 5 min from now
              baseTime, increment,
            );
            log('info', `Auto-created V4 ${label} tournament (no open ${key} found)`);

            openGameTypes.add(key);

            if (gatewayUrl) {
              const newProto = await chain.getV4ProtocolState();
              const newId = Number(newProto[2]) - 1;
              fetch(`${gatewayUrl}/api/internal/tournament-notify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-service-key': serviceKey },
                body: JSON.stringify({
                  tournamentId: newId,
                  tournament: {
                    tier, format, entryFee: 0, maxPlayers,
                    startTime: now + 360, registrationDeadline: now + 300,
                    baseTimeSeconds: baseTime, incrementSeconds: increment,
                    isV4: true,
                  },
                }),
                signal: AbortSignal.timeout(5000),
              }).catch(err => log('warn', 'Failed to notify gateway of new V4 tournament', { error: (err as Error).message }));
            }
          };

          // Only create one Free Swiss at a time — agents funnel into this one tournament
          // Rapid time control: 3min + 5s increment
          await autoCreateIfNeeded(5, 0, 8, 2, 180, 5, 'Free Swiss');

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

      // Use V4 contract for all new tournaments (unless --v3 flag is set)
      const useV3 = args.includes('--v3');
      const bracket = parseInt(getArg('bracket', '0')!); // 0=Open by default
      let txHash: string;

      switch (format) {
        case 'swiss':
        case 'league': {
          const maxPlayers = parseInt(getArg('max', '8')!);
          const minPlayers = parseInt(getArg('min', '4')!);
          if (useV3) {
            txHash = await chain.createTournament(
              tierIndex, formatIndex, maxPlayers, minPlayers,
              startTime, registrationDeadline, baseTime, increment,
            );
          } else {
            txHash = await chain.createV4Tournament(
              tierIndex, formatIndex, bracket, maxPlayers, minPlayers,
              startTime, registrationDeadline, baseTime, increment,
            );
          }
          log('info', `Created ${format} tournament (${useV3 ? 'V3' : 'V4'})`, {
            tier: tierName, maxPlayers, minPlayers, bracket, txHash,
          });
          break;
        }

        case 'match': {
          const bestOf = parseInt(getArg('best-of', '3')!);
          const opponent = (getArg('opponent') || '0x0000000000000000000000000000000000000000') as `0x${string}`;
          // Match challenges still use V3 (V4 may not support createMatchChallenge)
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
          if (useV3) {
            txHash = await chain.createTeamTournament(
              tierIndex, maxTeams, minTeams,
              startTime, registrationDeadline, baseTime, increment, teamSize,
            );
          } else {
            txHash = await chain.createV4TeamTournament(
              tierIndex, bracket, maxTeams, minTeams,
              startTime, registrationDeadline, baseTime, increment, teamSize,
            );
          }
          log('info', `Created team tournament (${useV3 ? 'V3' : 'V4'})`, {
            tier: tierName, maxTeams, minTeams, teamSize, bracket, txHash,
          });
          break;
        }
      }

      // Read back the tournament to confirm
      const protocol = useV3 ? await chain.getProtocolState() : await chain.getV4ProtocolState();
      const newId = Number(protocol[2]) - 1;
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
