import { useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { MessageSquare, Building2, Users, BarChart3, UserCircle } from "lucide-react";
import { useSwUpdate } from "@/hooks/use-sw-update";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/", icon: MessageSquare, label: "Chat" },
  { to: "/properties", icon: Building2, label: "Propiedades" },
  { to: "/clients", icon: Users, label: "Clientes" },
  { to: "/dashboard", icon: BarChart3, label: "Dashboard" },
  { to: "/profile", icon: UserCircle, label: "Perfil" },
] as const;

export default function BottomNav() {
  const { updateAvailable } = useSwUpdate();
  const location = useLocation();

  // Hide on non-main pages
  const mainPaths = ["/", "/properties", "/clients", "/dashboard", "/profile"];
  if (!mainPaths.includes(location.pathname)) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card safe-bottom md:hidden">
      <div className="flex items-center justify-around h-14">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className="flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-muted-foreground transition-colors"
            activeClassName="text-primary"
          >
            <div className="relative">
              <Icon className="h-5 w-5" />
              {label === "Perfil" && updateAvailable && (
                <span className="absolute -top-0.5 -right-1 h-2.5 w-2.5 rounded-full bg-destructive border-2 border-card" />
              )}
            </div>
            <span className="text-[10px] font-medium leading-tight">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
