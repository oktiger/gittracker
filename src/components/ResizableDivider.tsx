import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  ariaLabel: string;
  className?: string;
  onDrag: (deltaX: number) => void;
}

export function ResizableDivider({ ariaLabel, className, onDrag }: Props) {
  const [dragging, setDragging] = useState(false);
  const lastX = useRef(0);
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  useEffect(() => {
    if (!dragging) return;

    const onPointerMove = (event: PointerEvent) => {
      const deltaX = event.clientX - lastX.current;
      lastX.current = event.clientX;
      onDragRef.current(deltaX);
    };
    const stopDragging = () => setDragging(false);

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", stopDragging, { once: true });
    window.addEventListener("blur", stopDragging, { once: true });

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("blur", stopDragging);
    };
  }, [dragging]);

  return (
    <div
      role="separator"
      aria-label={ariaLabel}
      aria-orientation="vertical"
      className={cn(
        "group relative z-20 w-px shrink-0 cursor-col-resize bg-border",
        className,
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        lastX.current = event.clientX;
        setDragging(true);
      }}
    >
      <div
        className={cn(
          "absolute inset-y-0 -left-1.5 -right-1.5 transition-colors group-hover:bg-primary/15",
          dragging && "bg-primary/20",
        )}
      />
    </div>
  );
}
