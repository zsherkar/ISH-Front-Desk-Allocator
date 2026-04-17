import { useState } from "react";
import { Link } from "wouter";
import { format } from "date-fns";
import { Plus, Search, Calendar, ChevronRight, Copy, CheckCircle2, Trash2, Clock } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { useListSurveys, useCreateSurvey, useDeleteSurvey } from "@/hooks/use-surveys";
import { usePublicConfig } from "@/hooks/use-public-config";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

function formatTime12(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

const DEADLINE_TIMES = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? "00" : "30";
  const value = `${String(hours).padStart(2, "0")}:${minutes}`;
  return { value, label: formatTime12(value) };
});

export function AdminSurveys() {
  const { data: surveys, isLoading } = useListSurveys();
  const { data: publicConfig } = usePublicConfig();
  const createMutation = useCreateSurvey();
  const deleteMutation = useDeleteSurvey();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [month, setMonth] = useState<string>(String(new Date().getMonth() + 1));
  const [year, setYear] = useState<string>(String(new Date().getFullYear()));
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [deadlineDate, setDeadlineDate] = useState<string>("");
  const [deadlineTime, setDeadlineTime] = useState<string>("17:00");
  const surveyList = Array.isArray(surveys) ? surveys : [];
  const hasUnexpectedSurveyPayload = Boolean(surveys) && !Array.isArray(surveys);
  const deadlinePreview = deadlineDate
    ? format(new Date(`${deadlineDate}T${deadlineTime}:00`), "EEEE, MMMM d, yyyy 'at' h:mm a")
    : null;

  const publicBaseUrl = publicConfig?.publicAppUrl?.trim() || null;

  const buildSurveyUrl = (token: string) => {
    const fallbackBase = `${window.location.origin}${import.meta.env.BASE_URL}`;
    const base = publicBaseUrl || fallbackBase;
    const normalizedBase = base.endsWith("/") ? base : `${base}/`;
    return new URL(`respond/${token}`, normalizedBase).toString();
  };

  const handleCreate = async () => {
    try {
      await createMutation.mutateAsync({
        data: {
          month: parseInt(month, 10),
          year: parseInt(year, 10),
          title: `Shift Schedule - ${format(new Date(parseInt(year), parseInt(month) - 1), 'MMMM yyyy')}`,
          closesAt: deadlineDate ? new Date(`${deadlineDate}T${deadlineTime}:00`).toISOString() : null,
        }
      });
      setIsCreateOpen(false);
      setDeadlineDate("");
      setDeadlineTime("17:00");
    } catch (err) {
      console.error(err);
    }
  };

  const copyLink = (token: string, id: number) => {
    const url = buildSurveyUrl(token);
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDeleteSurvey = async (surveyId: number) => {
    if (!confirm("Delete this survey and all associated responses and allocations?")) return;
    await deleteMutation.mutateAsync(surveyId);
  };

  return (
    <AdminLayout>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-display font-bold text-slate-900">Surveys</h1>
          <p className="text-slate-500 mt-1">Manage monthly shift availability surveys.</p>
          <p className="text-xs text-slate-500 mt-2">
            Copied survey links use{" "}
            <span className="font-medium text-slate-700">
              {publicBaseUrl || "the current site URL"}
            </span>
            .
          </p>
        </div>
        <Button 
          onClick={() => setIsCreateOpen(true)}
          className="bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/20 rounded-xl px-6"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Survey
        </Button>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex items-center bg-slate-50/50">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search surveys..." 
              className="pl-9 bg-white border-slate-200 rounded-xl"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-12 text-center text-slate-400 animate-pulse">Loading surveys...</div>
        ) : surveyList.length === 0 ? (
          <div className="p-16 text-center flex flex-col items-center">
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-slate-400">
              <Calendar className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">No surveys found</h3>
            <p className="text-slate-500 mt-1 mb-6">Create a survey to start collecting availability.</p>
            <Button onClick={() => setIsCreateOpen(true)} variant="outline" className="rounded-xl">
              Create First Survey
            </Button>
            {hasUnexpectedSurveyPayload && (
              <p className="text-xs text-amber-600 mt-2">
                API returned unexpected survey payload. Ensure API server is running and `/api` is reachable.
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {surveyList.map((survey) => (
              <div key={survey.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 text-primary flex items-center justify-center font-display font-bold text-lg">
                    {format(new Date(survey.year, survey.month - 1), 'MMM')}
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-900 text-lg">{survey.title}</h4>
                    <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                      <Badge variant={survey.status === 'open' ? 'default' : 'secondary'} className="rounded-md capitalize text-xs">
                        {survey.status}
                      </Badge>
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {survey.year}
                      </span>
                    </div>
                  </div>
                </div>
                
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.preventDefault();
                      copyLink(survey.token, survey.id);
                    }}
                    className="hidden sm:flex text-slate-500 hover:text-slate-900 rounded-lg"
                  >
                    {copiedId === survey.id ? <CheckCircle2 className="w-4 h-4 text-green-500 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                    {copiedId === survey.id ? "Copied!" : "Copy Link"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteSurvey(survey.id)}
                    className="text-rose-500 hover:text-rose-700 rounded-lg"
                  >
                    <Trash2 className="w-4 h-4 mr-1" /> Delete
                  </Button>
                  <Link href={`/admin/surveys/${survey.id}`} className="block">
                    <Button variant="outline" className="rounded-xl font-medium border-slate-200">
                      Manage <ChevronRight className="w-4 h-4 ml-1 opacity-50 group-hover:opacity-100" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">Create Survey</DialogTitle>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Month</label>
                <Select value={month} onValueChange={setMonth}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select month" />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <SelectItem key={m} value={String(m)}>
                        {format(new Date(2024, m - 1), 'MMMM')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700">Year</label>
                <Select value={year} onValueChange={setYear}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Select year" />
                  </SelectTrigger>
                  <SelectContent>
                    {[2024, 2025, 2026, 2027].map(y => (
                      <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="bg-blue-50 text-blue-800 p-4 rounded-xl text-sm leading-relaxed border border-blue-100">
              This will automatically generate all standard weekday and weekend shifts for <strong>{format(new Date(parseInt(year), parseInt(month)-1), 'MMMM yyyy')}</strong>.
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-700">Submission Deadline</label>
                <p className="text-xs text-slate-500 mt-1">Optional. Times are shown in Eastern Time.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_160px] gap-3">
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <Input
                    type="date"
                    value={deadlineDate}
                    onChange={(e) => setDeadlineDate(e.target.value)}
                    className="rounded-xl pl-9"
                  />
                </div>
                <Select value={deadlineTime} onValueChange={setDeadlineTime}>
                  <SelectTrigger className="rounded-xl">
                    <SelectValue placeholder="Time" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {DEADLINE_TIMES.map((time) => (
                      <SelectItem key={time.value} value={time.value}>
                        {time.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                {deadlinePreview ? `Closes ${deadlinePreview}` : "No deadline set"}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsCreateOpen(false)} className="rounded-xl">Cancel</Button>
            <Button 
              onClick={handleCreate} 
              disabled={createMutation.isPending}
              className="rounded-xl bg-primary hover:bg-primary/90 shadow-md shadow-primary/20"
            >
              {createMutation.isPending ? "Creating..." : "Create Survey"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
