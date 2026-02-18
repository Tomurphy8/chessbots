'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { track, Events } from '@/lib/analytics';

/**
 * Hook to auto-track page views on route changes.
 * Place in the root layout or any component that should track navigation.
 */
export function usePageTracking() {
  const pathname = usePathname();

  useEffect(() => {
    track(Events.PAGE_VIEW, { path: pathname });
  }, [pathname]);
}

/**
 * Hook to track a specific event once on mount.
 */
export function useTrackOnMount(event: string, properties?: Record<string, string | number | boolean>) {
  useEffect(() => {
    track(event, properties);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
