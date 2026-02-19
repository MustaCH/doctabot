import { useRef, useState, useCallback, type TouchEvent } from "react";
import { Trash2, Pencil } from "lucide-react";

interface SwipeableConversationItemProps {
  children: React.ReactNode;
  onDelete?: () => void;
  onRename?: () => void;
}

const THRESHOLD = 70;
const ACTION_WIDTH = 120;

const SwipeableConversationItem = ({ children, onDelete, onRename }: SwipeableConversationItemProps) => {
  const startX = useRef(0);
  const currentX = useRef(0);
  const swiping = useRef(false);
  const [offset, setOffset] = useState(0);
  const [isOpen, setIsOpen] = useState(false);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    startX.current = e.touches[0].clientX;
    swiping.current = true;
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!swiping.current) return;
    currentX.current = e.touches[0].clientX;
    const diff = startX.current - currentX.current;

    if (isOpen) {
      // Already open: allow closing by swiping right
      const newOffset = Math.max(0, Math.min(ACTION_WIDTH, ACTION_WIDTH + (startX.current - currentX.current) * -1));
      setOffset(newOffset);
    } else {
      // Closed: only allow left swipe
      if (diff > 0) {
        setOffset(Math.min(diff, ACTION_WIDTH));
      }
    }
  }, [isOpen]);

  const handleTouchEnd = useCallback(() => {
    swiping.current = false;
    if (isOpen) {
      // If dragged past halfway closed, close it
      if (offset < ACTION_WIDTH / 2) {
        setOffset(0);
        setIsOpen(false);
      } else {
        setOffset(ACTION_WIDTH);
      }
    } else {
      if (offset > THRESHOLD) {
        setOffset(ACTION_WIDTH);
        setIsOpen(true);
      } else {
        setOffset(0);
      }
    }
  }, [offset, isOpen]);

  const close = useCallback(() => {
    setOffset(0);
    setIsOpen(false);
  }, []);

  return (
    <div className="relative overflow-hidden">
      {/* Action buttons behind */}
      <div className="absolute inset-y-0 right-0 flex">
        {onRename && (
          <button
            onClick={() => { close(); onRename(); }}
            className="flex w-[60px] items-center justify-center bg-primary text-primary-foreground"
          >
            <Pencil className="h-4 w-4" />
          </button>
        )}
        {onDelete && (
          <button
            onClick={() => { close(); onDelete(); }}
            className="flex w-[60px] items-center justify-center bg-destructive text-destructive-foreground"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Sliding content */}
      <div
        className="relative bg-card transition-transform duration-200 ease-out"
        style={{ transform: `translateX(-${offset}px)`, transitionDuration: swiping.current ? "0ms" : "200ms" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeableConversationItem;
