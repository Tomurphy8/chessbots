'use client';

import { usePageTracking } from '@/lib/hooks/useAnalytics';

/**
 * Client component that auto-tracks page views on route changes.
 * Wrap around children in the root layout.
 */
export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  usePageTracking();
  return <>{children}</>;
}
