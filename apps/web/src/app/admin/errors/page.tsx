'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw, AlertTriangle, AlertCircle, Info, Search } from 'lucide-react';
import { CHAIN } from '@/lib/chains';
import { shortenAddress, cn } from '@/lib/utils';

interface ErrorEntry {
  id: number;
  wallet: string;
  level: 'error' | 'warn' | 'info';
  message: string;
  context?: Record<string, unknown>;
  timestamp: number;
}

function formatTime(ts: number) {
  return new Date(ts).toLocaleString([], {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

const levelIcon = {
  error: <AlertCircle className="w-3.5 h-3.5 text-red-400" />,
  warn: <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />,
  info: <Info className="w-3.5 h-3.5 text-blue-400" />,
};

const levelBg = {
  error: 'bg-red-500/10 text-red-400',
  warn: 'bg-yellow-500/10 text-yellow-400',
  info: 'bg-blue-500/10 text-blue-400',
};

export default function AdminErrorsPage() {
  const [entries, setEntries] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletFilter, setWalletFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('');

  const fetchErrors = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (walletFilter) params.set('wallet', walletFilter);
      if (levelFilter) params.set('level', levelFilter);
      params.set('limit', '200');

      const res = await fetch(`${CHAIN.gatewayUrl}/api/admin/errors?${params}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (e) {
      console.error('Failed to fetch error logs:', e);
    } finally {
      setLoading(false);
    }
  }, [walletFilter, levelFilter]);

  useEffect(() => {
    fetchErrors();
    const interval = setInterval(fetchErrors, 10_000);
    return () => clearInterval(interval);
  }, [fetchErrors]);

  const errorCount = entries.filter(e => e.level === 'error').length;
  const warnCount = entries.filter(e => e.level === 'warn').length;
  const infoCount = entries.filter(e => e.level === 'info').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Agent Error Logs</h1>
            <p className="text-sm text-gray-500">Errors and logs reported by agents &middot; Auto-refreshes every 10s</p>
          </div>
        </div>
        <button
          onClick={fetchErrors}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white border border-chess-border rounded-lg px-3 py-1.5 transition-colors"
        >
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-chess-surface border border-chess-border rounded-lg p-3">
          <div className="text-2xl font-bold text-red-400">{errorCount}</div>
          <div className="text-xs text-gray-500 mt-1">Errors</div>
        </div>
        <div className="bg-chess-surface border border-chess-border rounded-lg p-3">
          <div className="text-2xl font-bold text-yellow-400">{warnCount}</div>
          <div className="text-xs text-gray-500 mt-1">Warnings</div>
        </div>
        <div className="bg-chess-surface border border-chess-border rounded-lg p-3">
          <div className="text-2xl font-bold text-blue-400">{infoCount}</div>
          <div className="text-xs text-gray-500 mt-1">Info</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="w-4 h-4 text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter by wallet address..."
            value={walletFilter}
            onChange={e => setWalletFilter(e.target.value)}
            className="w-full bg-chess-surface border border-chess-border rounded-lg pl-10 pr-4 py-2 text-sm placeholder:text-gray-600 focus:border-chess-accent outline-none"
          />
        </div>
        <select
          value={levelFilter}
          onChange={e => setLevelFilter(e.target.value)}
          className="bg-chess-surface border border-chess-border rounded-lg px-3 py-2 text-sm focus:border-chess-accent outline-none"
        >
          <option value="">All Levels</option>
          <option value="error">Errors</option>
          <option value="warn">Warnings</option>
          <option value="info">Info</option>
        </select>
      </div>

      {/* Log table */}
      <div className="bg-chess-surface border border-chess-border rounded-lg max-h-[600px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-chess-surface">
            <tr className="text-left text-gray-500 border-b border-chess-border">
              <th className="px-4 py-2 font-medium w-40">Time</th>
              <th className="px-4 py-2 font-medium w-16">Level</th>
              <th className="px-4 py-2 font-medium w-32">Agent</th>
              <th className="px-4 py-2 font-medium">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-chess-border/50">
            {entries.map(entry => (
              <tr key={entry.id} className="hover:bg-chess-border/10">
                <td className="px-4 py-2 text-gray-400 font-mono text-xs whitespace-nowrap">
                  {formatTime(entry.timestamp)}
                </td>
                <td className="px-4 py-2">
                  <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium', levelBg[entry.level])}>
                    {levelIcon[entry.level]}
                    {entry.level}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <Link
                    href={`/agents/${entry.wallet}`}
                    className="text-xs font-mono text-chess-accent-light hover:text-white transition-colors"
                  >
                    {shortenAddress(entry.wallet, 6)}
                  </Link>
                </td>
                <td className="px-4 py-2 text-gray-300 text-xs max-w-[400px] truncate" title={entry.message}>
                  {entry.message}
                  {entry.context && (
                    <span className="text-gray-600 ml-2">{JSON.stringify(entry.context)}</span>
                  )}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-gray-500">
                  {loading ? 'Loading...' : 'No error logs reported yet. Agents can POST to /api/agent/log.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
