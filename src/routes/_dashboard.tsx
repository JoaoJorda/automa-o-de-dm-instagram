import { createFileRoute, Outlet, Link, useRouterState, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Bot,
  Workflow,
  FileText,
  ScrollText,
  Settings,
  HelpCircle,
  Zap,
  LogOut,
  Sun,
  Moon,
  Loader2,
  Menu,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/_dashboard")({
  component: DashboardLayout,
});

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/automations", label: "Automações", icon: Bot },
  { to: "/flows", label: "Flows", icon: Workflow },
  { to: "/templates", label: "Templates", icon: FileText },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/settings", label: "Configurações", icon: Settings },
  { to: "/help", label: "Ajuda", icon: HelpCircle },
] as const;

function Logo() {
  return (
    <div className="flex items-center gap-2.5 px-3 py-3">
      <div className="flex size-8 items-center justify-center rounded-lg bg-primary/15">
        <Zap className="size-4 text-primary" />
      </div>
      <span className="bg-gradient-to-r from-primary to-accent-foreground bg-clip-text text-lg font-bold tracking-tight text-transparent">
        InstaDesbloqMe
      </span>
    </div>
  );
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { location } = useRouterState();
  return (
    <nav className="flex flex-1 flex-col gap-1.5">
      {navItems.map(({ to, label, icon: Icon }) => {
        const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`);
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className={cn(
              "group relative flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition-all",
              isActive
                ? "border-primary bg-primary/10 text-primary shadow-[0_0_20px_-2px] shadow-primary/40"
                : "border-transparent text-muted-foreground hover:bg-primary/5 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function DashboardLayout() {
  const { theme, setTheme } = useTheme();
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [mounted, setMounted] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [loading, session, navigate]);

  if (loading || !session) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="hidden w-60 shrink-0 border-r border-sidebar-border bg-sidebar lg:block">
        <div className="flex h-full flex-col p-4">
          <Logo />
          <div className="mx-3 my-3 h-px bg-primary/10" />
          <NavLinks />
          <div className="px-3 pt-4 text-xs text-muted-foreground/60 truncate">
            {session.user.email}
          </div>
        </div>
      </aside>

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-16 items-center gap-2 border-b border-border bg-card/80 backdrop-blur-sm px-4 lg:px-6">
          {/* Navegação mobile: hamburger + Sheet (a sidebar some abaixo de lg) */}
          <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                <Menu className="size-5" />
                <span className="sr-only">Abrir menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-4">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="flex h-full flex-col">
                <Logo />
                <div className="mx-3 my-3 h-px bg-primary/10" />
                <NavLinks onNavigate={() => setMobileNavOpen(false)} />
                <div className="px-3 pt-4 text-xs text-muted-foreground/60 truncate">
                  {session.user.email}
                </div>
              </div>
            </SheetContent>
          </Sheet>
          <span className="lg:hidden text-sm font-semibold">InstaDesbloqMe</span>

          <div className="ml-auto flex items-center gap-3">
            {mounted && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground hover:bg-muted/50"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                <span className="sr-only">Alternar tema</span>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-destructive"
              onClick={async () => {
                try {
                  await signOut();
                  navigate({ to: "/login" });
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Não foi possível sair da conta.",
                  );
                }
              }}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-10">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
