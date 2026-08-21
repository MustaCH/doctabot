import * as React from "react";

import { cn } from "@/lib/utils";

// Campo de vidrio del sistema "Carbón & Vidrio": 44 de alto, radio 14, borde/fondo rgba y foco con
// anillo azul (borde rgba(91,147,255,.45) + halo 3px), como en los artboards Perfil / AdminGate.
// `text-base` en mobile evita el zoom de iOS al enfocar; `md:text-sm` en escritorio.
const INPUT_GLASS_CLASSES =
  "flex h-11 w-full rounded-[14px] border border-white/[0.09] bg-white/[0.04] px-4 py-2 text-base text-foreground ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-[rgba(91,147,255,0.45)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(91,147,255,0.12)] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return <input type={type} className={cn(INPUT_GLASS_CLASSES, className)} ref={ref} {...props} />;
  },
);
Input.displayName = "Input";

export { Input };
