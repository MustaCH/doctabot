import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Escala del sistema "Carbón & Vidrio" (docs/design/redesign-premium/README.md §2):
// alturas 48 principal · 46 en tarjeta · 44 secundario · 38 compacto; radios 14 botón / 12 ícono.
// `default` es el gradiente de acción con sombra azul; `outline` es vidrio; `ghost` hover neutro.
// `xs`/`icon-xs` (36) existen solo para la densidad del Super Admin (`.admin-dense`).
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[14px] text-sm font-medium ring-offset-background transition-[background-color,border-color,color,opacity,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(150deg,hsl(var(--primary)),hsl(var(--primary-deep)))] font-semibold text-white shadow-[0_12px_28px_-14px_rgba(59,123,255,0.9)] hover:opacity-90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-white/[0.09] bg-white/[0.05] text-foreground hover:bg-white/10",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-white/10 hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-12 px-5", // 48 · principal
        lg: "h-12 px-8", // 48 · alias histórico
        card: "h-[46px] px-4", // 46 · en tarjeta
        md: "h-11 px-4", // 44 · secundario
        sm: "h-[38px] px-3 text-[13px]", // 38 · compacto
        xs: "h-9 rounded-[10px] px-3 text-xs", // 36 · denso (admin, .admin-dense espera 32–36)
        icon: "h-11 w-11 rounded-[12px]", // 44 · ícono
        "icon-sm": "h-[38px] w-[38px] rounded-[12px]", // 38 · ícono compacto
        "icon-xs": "h-9 w-9 rounded-[10px]", // 36 · ícono denso (admin)
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
