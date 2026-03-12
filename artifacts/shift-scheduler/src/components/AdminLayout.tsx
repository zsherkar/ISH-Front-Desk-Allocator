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
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-white border-r border-slate-200 shadow-sm flex flex-col z-10 relative">
        <div className="p-6 border-b border-slate-100 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-blue-600 flex items-center justify-center text-white shadow-lg shadow-primary/20">
            <LayoutDashboard className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-display font-bold text-lg text-slate-900 leading-tight">Shift Sync</h1>
            <p className="text-xs font-medium text-slate-500">Admin Portal</p>
          </div>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.startsWith(item.href);
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={clsx(
                  "flex items-center gap-3 px-4 py-3 rounded-xl font-medium transition-all duration-200",
                  isActive 
                    ? "bg-primary/10 text-primary" 
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                )}
              >
                <item.icon className={clsx("w-5 h-5", isActive ? "text-primary" : "text-slate-400")} />
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
