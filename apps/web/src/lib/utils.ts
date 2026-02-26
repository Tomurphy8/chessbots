import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Format a USDC amount (in raw units with 6 decimals) to a human-readable string.
 * Accepts number, bigint, or string for safe BigInt handling.
 */
export function formatUSDC(rawAmount: number | bigint | string): string {
  return (Number(rawAmount) / 1_000_000).toFixed(2);
}

export function tierColor(tier: string): string {
  switch (tier) {
    case 'rookie': return 'text-green-400';
    case 'bronze': return 'text-chess-bronze';
    case 'silver': return 'text-chess-silver';
    case 'masters': return 'text-chess-gold';
    case 'legends': return 'text-red-400';
    case 'free': return 'text-cyan-400';
    default: return 'text-white';
  }
}

export function tierBorderColor(tier: string): string {
  switch (tier) {
    case 'rookie': return 'border-green-500';
    case 'bronze': return 'border-chess-bronze';
    case 'silver': return 'border-chess-silver';
    case 'masters': return 'border-chess-gold';
    case 'legends': return 'border-red-500';
    case 'free': return 'border-cyan-500';
    default: return 'border-chess-border';
  }
}

export function statusBadgeColor(status: string): string {
  switch (status) {
    case 'registration': return 'bg-green-500/20 text-green-400';
    case 'in_progress':
    case 'round_active': return 'bg-yellow-500/20 text-yellow-400';
    case 'round_complete': return 'bg-purple-500/20 text-purple-400';
    case 'completed': return 'bg-blue-500/20 text-blue-400';
    case 'cancelled': return 'bg-red-500/20 text-red-400';
    default: return 'bg-gray-500/20 text-gray-400';
  }
}

const STATUS_LABELS: Record<string, string> = {
  registration: 'Registration',
  in_progress: 'In Progress',
  round_active: 'Round Active',
  round_complete: 'Round Complete',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function formatStatus(status: string): string {
  return STATUS_LABELS[status] || status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
