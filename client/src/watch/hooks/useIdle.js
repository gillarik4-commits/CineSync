import { useCallback, useEffect, useRef, useState } from 'react';

/** True while the user has interacted within `ms`. `poke()` resets the timer. */
export function useIdle(ms = 3000) {
  const [active, setActive] = useState(true);
  const timer = useRef(0);

  const poke = useCallback(() => {
    setActive(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setActive(false), ms);
  }, [ms]);

  useEffect(() => {
    poke();
    return () => window.clearTimeout(timer.current);
  }, [poke]);

  return [active, poke];
}
