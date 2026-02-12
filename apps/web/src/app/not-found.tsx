import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-6">
      <div className="border border-chess-border rounded-xl p-8 bg-chess-surface max-w-md text-center">
        <h2 className="text-xl font-bold text-white mb-3">Page Not Found</h2>
        <p className="text-gray-400 text-sm mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/"
          className="px-6 py-2 bg-chess-accent hover:bg-chess-accent-light text-white rounded-lg transition-colors text-sm font-medium inline-block"
        >
          Back to Home
        </Link>
      </div>
    </div>
  );
}
