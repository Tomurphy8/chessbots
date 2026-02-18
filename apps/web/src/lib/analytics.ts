/**
 * ChessBots Internal Analytics
 *
 * Lightweight client-side event tracking for internal use.
 * Events are stored in sessionStorage and can be flushed to a backend endpoint.
 * NOT public-facing — only visible on /admin/analytics.
 */

export interface AnalyticsEvent {
  event: string;
  properties?: Record<string, string | number | boolean>;
  timestamp: number;
  page: string;
  sessionId: string;
}

// Generate a stable session ID
function getSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem('cb_session_id');
  if (!id) {
    id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem('cb_session_id', id);
  }
  return id;
}

// Get stored events
function getStoredEvents(): AnalyticsEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem('cb_analytics');
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// Store events (max 500 per session to prevent memory issues)
function storeEvents(events: AnalyticsEvent[]) {
  if (typeof window === 'undefined') return;
  const trimmed = events.slice(-500);
  sessionStorage.setItem('cb_analytics', JSON.stringify(trimmed));
}

/**
 * Track an analytics event.
 * Call from any component to record user actions.
 */
export function track(event: string, properties?: Record<string, string | number | boolean>) {
  if (typeof window === 'undefined') return;

  const entry: AnalyticsEvent = {
    event,
    properties,
    timestamp: Date.now(),
    page: window.location.pathname,
    sessionId: getSessionId(),
  };

  const events = getStoredEvents();
  events.push(entry);
  storeEvents(events);

  // Also log to console in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[analytics]', event, properties);
  }
}

/**
 * Get all tracked events for the current session.
 */
export function getEvents(): AnalyticsEvent[] {
  return getStoredEvents();
}

/**
 * Clear all stored events.
 */
export function clearEvents() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem('cb_analytics');
}

/**
 * Get event counts grouped by event name.
 */
export function getEventCounts(): Record<string, number> {
  const events = getStoredEvents();
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.event] = (counts[e.event] || 0) + 1;
  }
  return counts;
}

/**
 * Get page view counts.
 */
export function getPageViews(): Record<string, number> {
  const events = getStoredEvents().filter(e => e.event === 'page_view');
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.page] = (counts[e.page] || 0) + 1;
  }
  return counts;
}

// ── Pre-defined event names ──

export const Events = {
  PAGE_VIEW: 'page_view',
  WALLET_CONNECTED: 'wallet_connected',
  WALLET_DISCONNECTED: 'wallet_disconnected',
  TOURNAMENT_VIEWED: 'tournament_viewed',
  TOURNAMENT_JOINED: 'tournament_joined',
  GAME_VIEWED: 'game_viewed',
  BET_PLACED: 'bet_placed',
  MARKET_CREATED: 'market_created',
  AGENT_REGISTERED: 'agent_registered',
  DOCS_VIEWED: 'docs_viewed',
  TEMPLATE_CLICKED: 'template_clicked',
  STATUS_PAGE_VIEWED: 'status_page_viewed',
  DEMO_VIEWED: 'demo_viewed',
} as const;
