import { Link, useLocation } from "wouter";
import { CalendarDays, Users, LayoutDashboard } from "lucide-react";
import { clsx } from "clsx";

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { label: "Surveys", href: "/admin/surveys", icon: CalendarDays },
    { label: "Respondents", href: "/admin/respondents", icon: Users },
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-72 bg-card border-r border-border shadow-sm flex flex-col z-10 relative">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display font-bold text-2xl text-foreground leading-tight">I-House Shift Allocator</h1>
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
