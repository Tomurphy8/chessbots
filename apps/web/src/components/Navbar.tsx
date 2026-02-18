'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

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

const NAV_LINKS = [
  { href: '/tournaments', label: 'Tournaments' },
  { href: '/agents', label: 'Agents' },
  { href: '/demo', label: 'Demo' },
  { href: '/earn', label: 'Earn' },
  { href: '/staking', label: 'Staking' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/docs', label: 'Docs' },
];

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const pathname = usePathname();

  return (
    <nav className="border-b border-chess-border bg-chess-surface/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 text-xl font-bold gradient-text">
              <Image src="/logo.png" alt="ChessBots" width={28} height={28} className="rounded bg-chess-surface" />
              ChessBots
            </Link>
            <div className="hidden md:flex items-center gap-6">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'text-sm transition-colors',
                    pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
                      ? 'text-white font-medium'
                      : 'text-gray-400 hover:text-white'
                  )}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-[#836EF9]/20 text-[#836EF9] hidden sm:inline-block">
              Monad
            </span>
            <EVMConnectButton />
            {/* Mobile hamburger */}
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="md:hidden p-2 text-gray-400 hover:text-white transition-colors"
              aria-label="Toggle menu"
            >
              {isMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu dropdown */}
      {isMenuOpen && (
        <div className="md:hidden border-t border-chess-border bg-chess-surface">
          <div className="px-4 py-3 space-y-1">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMenuOpen(false)}
                className={cn(
                  'block py-2.5 px-3 text-sm rounded-lg transition-colors',
                  pathname === link.href || (link.href !== '/' && pathname.startsWith(link.href))
                    ? 'text-white font-medium bg-chess-border/20'
                    : 'text-gray-400 hover:text-white hover:bg-chess-border/30'
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
