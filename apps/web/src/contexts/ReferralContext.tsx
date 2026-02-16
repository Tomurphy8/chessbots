'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';

interface ReferralContextType {
  referrer: string;
  setReferrer: (address: string) => void;
  hasUrlReferrer: boolean;
}

const ReferralContext = createContext<ReferralContextType>({
  referrer: '',
  setReferrer: () => {},
  hasUrlReferrer: false,
});

export function useReferrer() {
  return useContext(ReferralContext);
}

export function ReferralProvider({ children }: { children: ReactNode }) {
  const searchParams = useSearchParams();
  const [referrer, setReferrer] = useState('');
  const [hasUrlReferrer, setHasUrlReferrer] = useState(false);

  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref && ref.startsWith('0x') && ref.length === 42) {
      setReferrer(ref);
      setHasUrlReferrer(true);
    }
  }, [searchParams]);

  return (
    <ReferralContext.Provider value={{ referrer, setReferrer, hasUrlReferrer }}>
      {children}
    </ReferralContext.Provider>
  );
}
