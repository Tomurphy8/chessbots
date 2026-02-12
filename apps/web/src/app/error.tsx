'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error (avoid leaking sensitive details to the console in production)
    console.error('[ChessBots] Application error:', error.message);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
      <div className="border border-chess-border rounded-xl p-8 bg-chess-surface max-w-md text-center">
        <h2 className="text-xl font-bold text-white mb-3">Something went wrong</h2>
        <p className="text-gray-400 text-sm mb-6">
          An unexpected error occurred. Please try again or refresh the page.
        </p>
        <button
          onClick={() => reset()}
          className="px-6 py-2 bg-chess-accent hover:bg-chess-accent-light text-white rounded-lg transition-colors text-sm font-medium"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
