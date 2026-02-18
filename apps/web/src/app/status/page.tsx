'use client';

import { useState, useEffect, useCallback } from 'react';
import { CHAIN } from '@/lib/chains';
import { Activity, CheckCircle, XCircle, RefreshCw, Clock, Server } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ServiceHealth {
  name: string;
  url: string;
  status: 'checking' | 'healthy' | 'unhealthy' | 'unknown';
  latencyMs?: number;
  details?: Record<string, unknown>;
  lastChecked?: Date;
  error?: string;
}

const SERVICES: { name: string; url: string }[] = [
  { name: 'Agent Gateway', url: CHAIN.gatewayUrl },
  { name: 'Chess Engine', url: (process.env.NEXT_PUBLIC_CHESS_ENGINE_URL || '').trim() || '' },
  { name: 'Tournament Orchestrator', url: (process.env.NEXT_PUBLIC_ORCHESTRATOR_URL || '').trim() || '' },
];

// RPC health check (Monad chain)
async function checkRpc(): Promise<{ healthy: boolean; latencyMs: number; blockNumber?: string }> {
  const start = Date.now();
  try {
    const res = await fetch(CHAIN.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return { healthy: !!data.result, latencyMs: Date.now() - start, blockNumber: data.result };
  } catch {
    return { healthy: false, latencyMs: Date.now() - start };
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

function StatusIndicator({ status }: { status: ServiceHealth['status'] }) {
  return (
    <div className="flex items-center gap-2">
      {status === 'checking' && <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />}
      {status === 'healthy' && <CheckCircle className="w-5 h-5 text-green-400" />}
      {status === 'unhealthy' && <XCircle className="w-5 h-5 text-red-400" />}
      {status === 'unknown' && <Activity className="w-5 h-5 text-gray-500" />}
      <span className={cn(
        'text-sm font-medium capitalize',
        status === 'healthy' && 'text-green-400',
        status === 'unhealthy' && 'text-red-400',
        status === 'checking' && 'text-gray-400',
        status === 'unknown' && 'text-gray-500',
      )}>
        {status}
      </span>
    </div>
  );
}

export default function StatusPage() {
  const [services, setServices] = useState<ServiceHealth[]>(
    SERVICES.map(s => ({ ...s, status: s.url ? 'checking' : 'unknown' }))
  );
  const [rpcHealth, setRpcHealth] = useState<{ status: 'checking' | 'healthy' | 'unhealthy'; latencyMs?: number; blockNumber?: string }>({ status: 'checking' });
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const checkServices = useCallback(async () => {
    setLastRefresh(new Date());

    // Check RPC
    setRpcHealth({ status: 'checking' });
    const rpc = await checkRpc();
    setRpcHealth({
      status: rpc.healthy ? 'healthy' : 'unhealthy',
      latencyMs: rpc.latencyMs,
      blockNumber: rpc.blockNumber,
    });

    // Check each service health endpoint
    for (let i = 0; i < SERVICES.length; i++) {
      const svc = SERVICES[i];
      if (!svc.url) {
        setServices(prev => {
          const next = [...prev];
          next[i] = { ...next[i], status: 'unknown', error: 'URL not configured' };
          return next;
        });
        continue;
      }

      setServices(prev => {
        const next = [...prev];
        next[i] = { ...next[i], status: 'checking' };
        return next;
      });

      try {
        const start = Date.now();
        const res = await fetch(`${svc.url}/api/health`, {
          signal: AbortSignal.timeout(5000),
        });
        const latencyMs = Date.now() - start;

        if (res.ok) {
          const data = await res.json();
          setServices(prev => {
            const next = [...prev];
            next[i] = {
              ...next[i],
              status: 'healthy',
              latencyMs,
              details: data,
              lastChecked: new Date(),
              error: undefined,
            };
            return next;
          });
        } else {
          setServices(prev => {
            const next = [...prev];
            next[i] = {
              ...next[i],
              status: 'unhealthy',
              latencyMs,
              lastChecked: new Date(),
              error: `HTTP ${res.status}`,
            };
            return next;
          });
        }
      } catch (err: any) {
        setServices(prev => {
          const next = [...prev];
          next[i] = {
            ...next[i],
            status: 'unhealthy',
            lastChecked: new Date(),
            error: err.name === 'AbortError' ? 'Timeout (5s)' : 'Connection failed',
          };
          return next;
        });
      }
    }
  }, []);

  useEffect(() => {
    checkServices();
    const interval = setInterval(checkServices, 30_000); // Refresh every 30s
    return () => clearInterval(interval);
  }, [checkServices]);

  const allHealthy = services.every(s => s.status === 'healthy' || s.status === 'unknown') && rpcHealth.status === 'healthy';
  const anyUnhealthy = services.some(s => s.status === 'unhealthy') || rpcHealth.status === 'unhealthy';

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">System Status</h1>
          <p className="text-gray-400 mt-1">ChessBots infrastructure health</p>
        </div>
        <button
          onClick={checkServices}
          className="flex items-center gap-2 px-4 py-2 border border-chess-border hover:border-chess-accent/50 rounded-lg text-sm transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Refresh
        </button>
      </div>

      {/* Overall Status Banner */}
      <div className={cn(
        'rounded-xl p-4 mb-8 border',
        allHealthy && 'bg-green-900/20 border-green-700/40',
        anyUnhealthy && 'bg-red-900/20 border-red-700/40',
        !allHealthy && !anyUnhealthy && 'bg-yellow-900/20 border-yellow-700/40',
      )}>
        <div className="flex items-center gap-3">
          {allHealthy && <CheckCircle className="w-6 h-6 text-green-400" />}
          {anyUnhealthy && <XCircle className="w-6 h-6 text-red-400" />}
          {!allHealthy && !anyUnhealthy && <Activity className="w-6 h-6 text-yellow-400" />}
          <div>
            <h2 className="font-semibold">
              {allHealthy ? 'All Systems Operational' : anyUnhealthy ? 'Service Disruption Detected' : 'Checking Services...'}
            </h2>
            <p className="text-xs text-gray-400">
              Last checked: {lastRefresh.toLocaleTimeString()}
            </p>
          </div>
        </div>
      </div>

      {/* Monad RPC */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Blockchain</h3>
        <div className="bg-chess-surface border border-chess-border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Server className="w-5 h-5 text-[#836EF9]" />
              <div>
                <h4 className="font-medium">Monad RPC</h4>
                <p className="text-xs text-gray-500 font-mono">{CHAIN.rpcUrl}</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {rpcHealth.latencyMs !== undefined && (
                <span className="text-xs text-gray-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {rpcHealth.latencyMs}ms
                </span>
              )}
              <StatusIndicator status={rpcHealth.status} />
            </div>
          </div>
          {rpcHealth.blockNumber && (
            <p className="text-xs text-gray-500 mt-2">
              Latest block: {parseInt(rpcHealth.blockNumber, 16).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      {/* Backend Services */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Backend Services</h3>
        <div className="space-y-3">
          {services.map((svc, i) => (
            <div key={i} className="bg-chess-surface border border-chess-border rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Server className="w-5 h-5 text-chess-accent-light" />
                  <div>
                    <h4 className="font-medium">{svc.name}</h4>
                    <p className="text-xs text-gray-500 font-mono">{svc.url || 'Not configured'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {svc.latencyMs !== undefined && (
                    <span className="text-xs text-gray-500 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {svc.latencyMs}ms
                    </span>
                  )}
                  <StatusIndicator status={svc.status} />
                </div>
              </div>

              {/* Details */}
              {svc.details && (
                <div className="mt-3 pt-3 border-t border-chess-border/50 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {svc.details.uptime !== undefined && (
                    <div>
                      <p className="text-xs text-gray-500">Uptime</p>
                      <p className="text-sm font-medium">{formatUptime(svc.details.uptime as number)}</p>
                    </div>
                  )}
                  {svc.details.activeGames !== undefined && (
                    <div>
                      <p className="text-xs text-gray-500">Active Games</p>
                      <p className="text-sm font-medium">{String(svc.details.activeGames)}</p>
                    </div>
                  )}
                  {svc.details.archivedGames !== undefined && (
                    <div>
                      <p className="text-xs text-gray-500">Archived Games</p>
                      <p className="text-sm font-medium">{String(svc.details.archivedGames)}</p>
                    </div>
                  )}
                  {svc.details.runningTournaments !== undefined && (
                    <div>
                      <p className="text-xs text-gray-500">Running</p>
                      <p className="text-sm font-medium">{String(svc.details.runningTournaments)}</p>
                    </div>
                  )}
                  {svc.details.completedTournaments !== undefined && (
                    <div>
                      <p className="text-xs text-gray-500">Completed</p>
                      <p className="text-sm font-medium">{String(svc.details.completedTournaments)}</p>
                    </div>
                  )}
                  {svc.details.agentIndexReady !== undefined && (
                    <div>
                      <p className="text-xs text-gray-500">Agent Index</p>
                      <p className="text-sm font-medium">{svc.details.agentIndexReady ? 'Ready' : 'Loading'}</p>
                    </div>
                  )}
                </div>
              )}

              {svc.error && (
                <p className="mt-2 text-xs text-red-400">{svc.error}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Frontend */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-3">Frontend</h3>
        <div className="bg-chess-surface border border-chess-border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Server className="w-5 h-5 text-green-400" />
              <div>
                <h4 className="font-medium">Web App (Vercel)</h4>
                <p className="text-xs text-gray-500 font-mono">chessbots.io</p>
              </div>
            </div>
            <StatusIndicator status="healthy" />
          </div>
        </div>
      </div>

      {/* Auto-refresh notice */}
      <p className="text-xs text-gray-600 text-center mt-8">
        Auto-refreshes every 30 seconds
      </p>
    </div>
  );
}
