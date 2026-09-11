import { useEffect, useState } from 'react';

/**
 * Minimal hash router. A dependency-free router keeps the options page free of
 * a routing library and its transitive packages — the smaller the dependency
 * tree, the smaller the supply-chain surface around the profile data.
 */
export function useHashRoute(fallback: string): [string, (next: string) => void] {
  const read = () => (location.hash.replace(/^#\/?/, '') || fallback).split('?')[0] ?? fallback;
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onChange = () => setRoute(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const navigate = (next: string) => {
    location.hash = `#/${next}`;
  };

  return [route, navigate];
}
