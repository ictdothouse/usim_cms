import { useRef } from "react";

/**
 * Wraps every function-valued property of `fns` in a permanently-stable
 * identity that always calls through to the latest version passed in on the
 * most recent render (the "useEvent"/stable-callback-ref pattern). Lets
 * React.memo bail out on components that receive these as props without
 * hand-tracking a useCallback dependency array per function — several of
 * Designer.tsx's mutators call through 2-3 layers of other unmemoized
 * functions (bumpStructural, isSectionLocked), where a missed transitive
 * dependency would silently reintroduce a stale closure. The wrapper is
 * built once and never changes identity for the lifetime of the component.
 */
type AnyFn = (...args: never[]) => unknown;

export function useStableFns<T extends Record<string, AnyFn>>(fns: T): T {
  const latest = useRef<Record<string, AnyFn>>(fns);
  latest.current = fns;

  const stableRef = useRef<T | null>(null);
  if (!stableRef.current) {
    const wrapped: Record<string, AnyFn> = {};
    for (const key of Object.keys(fns)) {
      wrapped[key] = (...args: never[]) => latest.current[key](...args);
    }
    stableRef.current = wrapped as T;
  }
  return stableRef.current;
}
