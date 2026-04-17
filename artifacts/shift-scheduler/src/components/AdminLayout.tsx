import { Link, useLocation } from "wouter";
import { CalendarDays, Users, LayoutDashboard, LogOut } from "lucide-react";
import { clsx } from "clsx";
import { Button } from "@/components/ui/button";
import { useAdminLogout, useAdminSession } from "@/hooks/use-auth";

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const { data: session } = useAdminSession();
  const logoutMutation = useAdminLogout();

  const navItems = [
    { label: "Surveys", href: "/admin/surveys", icon: CalendarDays },
    { label: "Respondents", href: "/admin/respondents", icon: Users },
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-80 bg-card border-r border-border shadow-sm flex flex-col z-10 relative">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="font-display font-bold text-[1.55rem] text-foreground leading-snug">
              <span className="block">I-House Front Desk</span>
              <span className="block">Shift Allocator</span>
            </h1>
            <p className="text-xs font-medium text-muted-foreground tracking-[0.14em] uppercase">Admin Desk</p>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1.5">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-all duration-200",
                  isActive 
                    ? "bg-primary/15 text-primary shadow-sm border border-primary/20" 
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                )}
              >
                <item.icon className={clsx("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground")} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-border p-4">
          <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.14em] text-slate-500">Signed in as</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {session?.admin.name || session?.admin.email || "Admin"}
            </p>
            {session?.admin.email && (
              <p className="text-xs text-slate-500">{session.admin.email}</p>
            )}
          </div>
          <Button
            className="w-full justify-center"
            type="button"
            variant="outline"
            onClick={async () => {
              await logoutMutation.mutateAsync();
              setLocation("/admin/login");
            }}
          >
            <LogOut className="h-4 w-4" />
            {logoutMutation.isPending ? "Signing out..." : "Log Out"}
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-4 md:p-8">
          <div className="max-w-6xl mx-auto page-transition-enter">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
