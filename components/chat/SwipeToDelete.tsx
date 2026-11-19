import React, { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react';

/** Width of each button revealed behind the row. */
const BUTTON_WIDTH = 80;
/** Movement before we decide if it's a sideways swipe or a scroll. */
const LOCK_DISTANCE = 8;

type Props = {
  /** Shown to screen readers on the Delete button. */
  label: string;
  onDelete: () => void;
  /** Adds a gray Archive (or Unarchive) button beside Delete. */
  onArchive?: () => void;
  archived?: boolean;
  /** Only one row should be open at a time. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Briefly slide open and back to show members the row can be swiped. */
  peek?: boolean;
  onPeekDone?: () => void;
  children: React.ReactNode;
};

/**
 * Swipe a row left to reveal a red Delete button (like Messages / WhatsApp).
 * Vertical scrolling still works; a tap on an open row just closes it.
 */
export const SwipeToDelete: React.FC<Props> = ({
  label,
  onDelete,
  onArchive,
  archived,
  open,
  onOpenChange,
  peek,
  onPeekDone,
  children,
}) => {
  const ACTION_WIDTH = BUTTON_WIDTH * (onArchive ? 2 : 1);
  const OPEN_THRESHOLD = ACTION_WIDTH / 2;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const g = useRef<{ x: number; y: number; base: number; axis: 'x' | 'y' | null; moved: boolean }>({
    x: 0,
    y: 0,
    base: 0,
    axis: null,
    moved: false,
  });

  useEffect(() => {
    if (!dragging) setDx(open ? -ACTION_WIDTH : 0);
  }, [open, dragging]);

  // The hint: a gentle slide to show the red Delete, then back.
  const [peeking, setPeeking] = useState(false);
  useEffect(() => {
    if (!peek) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      onPeekDone?.();
      return;
    }
    const t1 = window.setTimeout(() => {
      setPeeking(true);
      setDx(-Math.min(ACTION_WIDTH * 0.75, 120));
    }, 700);
    const t2 = window.setTimeout(() => setDx(0), 1700);
    const t3 = window.setTimeout(() => {
      setPeeking(false);
      onPeekDone?.();
    }, 2100);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peek]);

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    g.current = { x: t.clientX, y: t.clientY, base: open ? -ACTION_WIDTH : 0, axis: null, moved: false };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const t = e.touches[0];
    const mx = t.clientX - g.current.x;
    const my = t.clientY - g.current.y;
    if (!g.current.axis) {
      if (Math.abs(mx) < LOCK_DISTANCE && Math.abs(my) < LOCK_DISTANCE) return;
      g.current.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (g.current.axis === 'x') setDragging(true);
    }
    if (g.current.axis !== 'x') return;
    g.current.moved = true;
    // Left only, with a little rubber-band past the button.
    let next = g.current.base + mx;
    if (next > 0) next = 0;
    if (next < -ACTION_WIDTH) next = -ACTION_WIDTH - (-ACTION_WIDTH - next) * 0.25;
    setDx(next);
  };

  const onTouchEnd = () => {
    if (g.current.axis === 'x') {
      const shouldOpen = dx < -OPEN_THRESHOLD;
      setDragging(false);
      setDx(shouldOpen ? -ACTION_WIDTH : 0);
      onOpenChange(shouldOpen);
    }
    g.current.axis = null;
  };

  const onClickCapture = (e: React.MouseEvent) => {
    // A swipe (or a tap on an open row) shouldn't open the chat.
    if (g.current.moved || open) {
      e.preventDefault();
      e.stopPropagation();
      g.current.moved = false;
      if (open) onOpenChange(false);
    }
  };

  const reveal = Math.min(1, Math.abs(dx) / ACTION_WIDTH);

  return (
    <div className="relative overflow-hidden rounded-2xl">
      <div
        className="absolute inset-y-0 right-0 flex items-stretch"
        style={{ width: ACTION_WIDTH, opacity: reveal }}
        aria-hidden={!open}
      >
        {onArchive ? (
          <button
            type="button"
            tabIndex={open ? 0 : -1}
            onClick={() => {
              onOpenChange(false);
              onArchive();
            }}
            className="flex-1 flex flex-col items-center justify-center gap-1 bg-slate-500 text-white text-xs font-bold active:bg-slate-600"
            aria-label={`${archived ? 'Unarchive' : 'Archive'} chat with ${label}`}
          >
            {archived ? <ArchiveRestore size={18} aria-hidden /> : <Archive size={18} aria-hidden />}
            {archived ? 'Unarchive' : 'Archive'}
          </button>
        ) : null}
        <button
          type="button"
          tabIndex={open ? 0 : -1}
          onClick={() => {
            onOpenChange(false);
            onDelete();
          }}
          className="flex-1 flex flex-col items-center justify-center gap-1 bg-rose-600 text-white text-xs font-bold rounded-r-2xl active:bg-rose-700"
          aria-label={`Delete chat with ${label}`}
        >
          <Trash2 size={18} aria-hidden />
          Delete
        </button>
      </div>
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        onClickCapture={onClickCapture}
        style={{
          transform: `translate3d(${dx}px,0,0)`,
          transition: dragging ? 'none' : peeking ? 'transform 420ms cubic-bezier(.3,.7,.2,1)' : 'transform 220ms cubic-bezier(.2,.8,.2,1)',
          touchAction: 'pan-y',
        }}
        className="relative"
      >
        {children}
      </div>
    </div>
  );
};
