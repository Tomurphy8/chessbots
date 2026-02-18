'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getEvents, getEventCounts, getPageViews, clearEvents, type AnalyticsEvent } from '@/lib/analytics';
import { ArrowLeft, Trash2, RefreshCw, BarChart3, Eye, MousePointerClick, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tab = 'overview' | 'events' | 'pages';

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function AdminAnalyticsPage() {
  const [events, setEvents] = useState<AnalyticsEvent[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [pageViews, setPageViews] = useState<Record<string, number>>({});
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  function refresh() {
    setEvents(getEvents());
    setCounts(getEventCounts());
    setPageViews(getPageViews());
  }

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, []);

  const totalEvents = events.length;
  const sessionId = events[0]?.sessionId || '—';
  const firstEvent = events[0]?.timestamp;
  const lastEvent = events[events.length - 1]?.timestamp;
  const sessionDuration = firstEvent && lastEvent ? lastEvent - firstEvent : 0;

  // Top metrics
  const walletConnects = counts['wallet_connected'] || 0;
  const betsPlaced = counts['bet_placed'] || 0;
  const marketsCreated = counts['market_created'] || 0;
  const agentsRegistered = counts['agent_registered'] || 0;
  const tournamentsJoined = counts['tournament_joined'] || 0;
  const uniquePages = Object.keys(pageViews).length;

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'events', label: 'Event Log', icon: <MousePointerClick className="w-4 h-4" /> },
    { id: 'pages', label: 'Page Views', icon: <Eye className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Analytics Dashboard</h1>
            <p className="text-sm text-gray-500">Internal session analytics &middot; Not public-facing</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white border border-chess-border rounded-lg px-3 py-1.5 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
          <button
            onClick={() => { clearEvents(); refresh(); }}
            className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-300 border border-red-900/50 rounded-lg px-3 py-1.5 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Clear
          </button>
        </div>
      </div>

      {/* Session info bar */}
      <div className="bg-chess-surface border border-chess-border rounded-lg px-4 py-3 flex items-center gap-6 text-sm text-gray-400">
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Session: <span className="text-white font-mono text-xs">{sessionId}</span>
        </div>
        <div>Duration: <span className="text-white">{formatDuration(sessionDuration)}</span></div>
        <div>Events: <span className="text-white">{totalEvents}</span></div>
      </div>

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Page Views', value: counts['page_view'] || 0, color: 'text-blue-400' },
          { label: 'Wallet Connects', value: walletConnects, color: 'text-purple-400' },
          { label: 'Bets Placed', value: betsPlaced, color: 'text-green-400' },
          { label: 'Markets Created', value: marketsCreated, color: 'text-yellow-400' },
          { label: 'Agents Registered', value: agentsRegistered, color: 'text-pink-400' },
          { label: 'Tournaments Joined', value: tournamentsJoined, color: 'text-orange-400' },
        ].map(m => (
          <div key={m.label} className="bg-chess-surface border border-chess-border rounded-lg p-3">
            <div className={cn('text-2xl font-bold', m.color)}>{m.value}</div>
            <div className="text-xs text-gray-500 mt-1">{m.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-chess-border">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              activeTab === tab.id
                ? 'border-chess-accent text-white'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">Event Breakdown</h3>
          <div className="bg-chess-surface border border-chess-border rounded-lg divide-y divide-chess-border">
            {Object.entries(counts)
              .sort((a, b) => b[1] - a[1])
              .map(([event, count]) => (
                <div key={event} className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-sm text-gray-300 font-mono">{event}</span>
                  <div className="flex items-center gap-3">
                    <div className="w-32 bg-chess-dark rounded-full h-2 overflow-hidden">
                      <div
                        className="h-full bg-chess-accent rounded-full transition-all"
                        style={{ width: `${Math.min((count / totalEvents) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-sm text-white font-medium w-8 text-right">{count}</span>
                  </div>
                </div>
              ))}
            {Object.keys(counts).length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500 text-sm">No events recorded yet. Navigate around to generate data.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'events' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Recent Events ({events.length})
          </h3>
          <div className="bg-chess-surface border border-chess-border rounded-lg max-h-[600px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-chess-surface">
                <tr className="text-left text-gray-500 border-b border-chess-border">
                  <th className="px-4 py-2 font-medium">Time</th>
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-4 py-2 font-medium">Page</th>
                  <th className="px-4 py-2 font-medium">Properties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-chess-border/50">
                {[...events].reverse().map((e, i) => (
                  <tr key={i} className="hover:bg-chess-border/10">
                    <td className="px-4 py-2 text-gray-400 font-mono text-xs whitespace-nowrap">{formatTime(e.timestamp)}</td>
                    <td className="px-4 py-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-chess-accent/10 text-chess-accent-light">
                        {e.event}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-400 text-xs font-mono">{e.page}</td>
                    <td className="px-4 py-2 text-gray-500 text-xs font-mono truncate max-w-[200px]">
                      {e.properties ? JSON.stringify(e.properties) : '—'}
                    </td>
                  </tr>
                ))}
                {events.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-gray-500">No events recorded yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'pages' && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wide">
            Page Views ({uniquePages} pages)
          </h3>
          <div className="bg-chess-surface border border-chess-border rounded-lg divide-y divide-chess-border">
            {Object.entries(pageViews)
              .sort((a, b) => b[1] - a[1])
              .map(([page, count]) => {
                const maxCount = Math.max(...Object.values(pageViews));
                return (
                  <div key={page} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-sm text-gray-300 font-mono">{page}</span>
                    <div className="flex items-center gap-3">
                      <div className="w-32 bg-chess-dark rounded-full h-2 overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all"
                          style={{ width: `${(count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm text-white font-medium w-8 text-right">{count}</span>
                    </div>
                  </div>
                );
              })}
            {Object.keys(pageViews).length === 0 && (
              <div className="px-4 py-8 text-center text-gray-500 text-sm">No page views recorded yet.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
