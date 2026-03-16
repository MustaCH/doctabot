import { useRef, useState, useCallback, useEffect } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => Promise<void>;
  /** The scrollable element ref. Pull triggers only when scrollTop ≈ 0 */
  scrollRef: React.RefObject<HTMLElement | null>;
  threshold?: number;
  disabled?: boolean;
}

export function usePullToRefresh({
  onRefresh,
  scrollRef,
  threshold = 80,
  disabled = false,
}: UsePullToRefreshOptions) {
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);

  const handleTouchStart = useCallback(
    (e: TouchEvent) => {
      if (disabled || refreshing) return;
      const el = scrollRef.current;
      if (!el || el.scrollTop > 5) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    },
    [disabled, refreshing, scrollRef]
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (!pulling.current || disabled || refreshing) return;
      const diff = e.touches[0].clientY - startY.current;
      if (diff > 0) {
        // Dampen the pull distance
        setPullDistance(Math.min(diff * 0.4, threshold * 1.5));
      } else {
        pulling.current = false;
        setPullDistance(0);
      }
    },
    [disabled, refreshing, threshold]
  );

  const handleTouchEnd = useCallback(async () => {
    if (!pulling.current || disabled) return;
    pulling.current = false;
    if (pullDistance >= threshold && !refreshing) {
      setRefreshing(true);
      setPullDistance(threshold * 0.5); // Keep a small indicator while refreshing
      try {
        await onRefresh();
      } finally {
        setRefreshing(false);
        setPullDistance(0);
      }
    } else {
      setPullDistance(0);
    }
  }, [pullDistance, threshold, refreshing, onRefresh, disabled]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("touchstart", handleTouchStart, { passive: true });
    el.addEventListener("touchmove", handleTouchMove, { passive: true });
    el.addEventListener("touchend", handleTouchEnd);
    return () => {
      el.removeEventListener("touchstart", handleTouchStart);
      el.removeEventListener("touchmove", handleTouchMove);
      el.removeEventListener("touchend", handleTouchEnd);
    };
  }, [scrollRef, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { pullDistance, refreshing };
}
