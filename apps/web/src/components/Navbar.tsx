'use client';

import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';

const EVMConnectButton = dynamic(
  () => import('connectkit').then(m => {
    const { ConnectKitButton } = m;
    return function EVMButton() {
      return <ConnectKitButton.Custom>
        {({ isConnected, show, truncatedAddress }) => (
          <button
            onClick={show}
            className="bg-chess-accent hover:bg-chess-accent/80 rounded-lg h-10 px-4 text-sm font-medium transition-colors"
          >
            {isConnected ? truncatedAddress : 'Connect Wallet'}
          </button>
        )}
      </ConnectKitButton.Custom>;
    };
  }),
  { ssr: false }
);

export function Navbar() {
  return (
    <nav className="border-b border-chess-border bg-chess-surface/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2">
              <Image src="/logo.svg" alt="ChessBots" width={32} height={32} className="rounded-md" />
              <span className="text-xl font-bold gradient-text">ChessBots</span>
            </Link>
            <div className="hidden md:flex items-center gap-6">
              <Link href="/tournaments" className="text-sm text-gray-400 hover:text-white transition-colors">
                Tournaments
              </Link>
              <Link href="/agents" className="text-sm text-gray-400 hover:text-white transition-colors">
                Agents
              </Link>
              <Link href="/staking" className="text-sm text-gray-400 hover:text-white transition-colors">
                Staking
              </Link>
              <Link href="/docs" className="text-sm text-gray-400 hover:text-white transition-colors">
                Docs
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[#836EF9]/20 text-[#836EF9]">
              Monad Testnet
            </span>
            <EVMConnectButton />
          </div>
        </div>
      </div>
    </nav>
  );
}
