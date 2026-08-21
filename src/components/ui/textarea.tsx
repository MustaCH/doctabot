import * as React from "react";

import { cn } from "@/lib/utils";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

// Misma piel de vidrio que `Input` (radio 14, borde/fondo rgba, foco con anillo azul).
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-4 py-3 text-base text-foreground ring-offset-background placeholder:text-muted-foreground focus-visible:border-[rgba(91,147,255,0.45)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(91,147,255,0.12)] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
