import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useEffect } from "react";

// Import pages
import { AdminSurveys } from "@/pages/admin/surveys";
import { AdminSurveyDetail } from "@/pages/admin/surveys/[id]";
import { AdminRespondents } from "@/pages/admin/respondents";
import { PublicSurveyPage } from "@/pages/public/respond";

const queryClient = new QueryClient();

function HomeRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/admin/surveys");
  }, [setLocation]);
  return null;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/admin" component={HomeRedirect} />
      <Route path="/admin/surveys" component={AdminSurveys} />
      <Route path="/admin/surveys/:id" component={AdminSurveyDetail} />
      <Route path="/admin/respondents" component={AdminRespondents} />
      <Route path="/respond/:token" component={PublicSurveyPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
