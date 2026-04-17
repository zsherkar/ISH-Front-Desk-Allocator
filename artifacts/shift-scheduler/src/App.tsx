import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { AuthApiError, useAdminSession } from "@/hooks/use-auth";

// Import pages
import { AdminLoginPage } from "@/pages/admin/login";
import { AdminSurveys } from "@/pages/admin/surveys";
import { AdminSurveyDetail } from "@/pages/admin/surveys/[id]";
import { AdminRespondents } from "@/pages/admin/respondents";
import { PublicSurveyPage } from "@/pages/public/respond";

const queryClient = new QueryClient();

function HomeRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/admin");
  }, [setLocation]);
  return null;
}

function AdminEntryRedirect() {
  const [, setLocation] = useLocation();
  const { data, error, isLoading } = useAdminSession();

  useEffect(() => {
    if (isLoading) return;
    if (data?.authenticated) {
      setLocation("/admin/surveys");
      return;
    }
    if (error instanceof AuthApiError && error.status === 401) {
      setLocation("/admin/login");
    }
  }, [data, error, isLoading, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Checking admin access...</div>;
  }

  if (error instanceof AuthApiError && error.status !== 401) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h1 className="font-semibold">Admin access is not ready yet</h1>
              <p className="mt-2 text-sm">{error.message}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

function RequireAdmin({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { data, error, isLoading } = useAdminSession();

  useEffect(() => {
    if (error instanceof AuthApiError && error.status === 401) {
      const next = `${window.location.pathname}${window.location.search}`;
      setLocation(`/admin/login?next=${encodeURIComponent(next)}`);
    }
  }, [error, setLocation]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">Checking admin access...</div>;
  }

  if (error instanceof AuthApiError) {
    if (error.status === 401) return null;

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <h1 className="font-semibold">Admin access is not ready yet</h1>
              <p className="mt-2 text-sm">{error.message}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!data?.authenticated) return null;

  return <>{children}</>;
}

function ProtectedAdminSurveys() {
  return (
    <RequireAdmin>
      <AdminSurveys />
    </RequireAdmin>
  );
}

function ProtectedAdminSurveyDetail() {
  return (
    <RequireAdmin>
      <AdminSurveyDetail />
    </RequireAdmin>
  );
}

function ProtectedAdminRespondents() {
  return (
    <RequireAdmin>
      <AdminRespondents />
    </RequireAdmin>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/admin" component={AdminEntryRedirect} />
      <Route path="/admin/login" component={AdminLoginPage} />
      <Route path="/admin/surveys" component={ProtectedAdminSurveys} />
      <Route path="/admin/surveys/:id" component={ProtectedAdminSurveyDetail} />
      <Route path="/admin/respondents" component={ProtectedAdminRespondents} />
      <Route path="/respond/:token" component={PublicSurveyPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={150}>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
