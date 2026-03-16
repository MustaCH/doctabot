import { Loader2 } from "lucide-react";

interface PullToRefreshIndicatorProps {
  pullDistance: number;
  refreshing: boolean;
  threshold?: number;
}

const PullToRefreshIndicator = ({ pullDistance, refreshing, threshold = 80 }: PullToRefreshIndicatorProps) => {
  if (pullDistance <= 0 && !refreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);
  const ready = progress >= 1 || refreshing;

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-[height] duration-150 ease-out"
      style={{ height: pullDistance > 0 ? pullDistance : refreshing ? 40 : 0 }}
    >
      <div
        className={`flex items-center gap-2 text-xs text-muted-foreground transition-opacity ${
          pullDistance > 10 || refreshing ? "opacity-100" : "opacity-0"
        }`}
      >
        <Loader2
          className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
          style={!refreshing ? { transform: `rotate(${progress * 360}deg)` } : undefined}
        />
        <span>{refreshing ? "Actualizando..." : ready ? "Soltá para actualizar" : "Arrastrá para actualizar"}</span>
      </div>
    </div>
  );
};

export default PullToRefreshIndicator;
