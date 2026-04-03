import { useState, useRef } from "react";
import { useParams } from "wouter";
import { AdminLayout } from "@/components/AdminLayout";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import {
  useGetSurvey,
  useUpdateSurvey,
  useGetSurveyResponses,
  useGetSurveyStats,
  useDeleteSurveyResponse,
} from "@/hooks/use-surveys";
import {
  useGetAllocations,
  useRunAllocation,
  useGetAllocationStats,
} from "@/hooks/use-allocations";
import { useGetRespondentFdHistory } from "@/hooks/use-respondents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft, Lock, LockOpen, Calendar, Users, BarChart3,
  Clock, Settings, BrainCircuit, CheckCircle2, Download, Image,
} from "lucide-react";
import { Link } from "wouter";
import { clsx } from "clsx";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function AdminSurveyDetail() {
  const { id } = useParams<{ id: string }>();
  const surveyId = parseInt(id, 10);

  const { data: survey, isLoading: isSurveyLoading } = useGetSurvey(surveyId);
  const { data: responses } = useGetSurveyResponses(surveyId);
  const { data: stats } = useGetSurveyStats(surveyId);
  const { data: allocations } = useGetAllocations(surveyId);
  const { data: allocStats } = useGetAllocationStats(surveyId);

  const updateMutation = useUpdateSurvey();
  const runAllocMutation = useRunAllocation();

  const [afpIds, setAfpIds] = useState<Set<number>>(new Set());
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedRespondentId, setSelectedRespondentId] = useState<number | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<any | null>(null);
  const deleteResponseMutation = useDeleteSurveyResponse();
  const calendarRef = useRef<HTMLDivElement>(null);
  const { data: respondentHistory } = useGetRespondentFdHistory(selectedRespondentId ?? 0);

  const toggleAfp = (id: number) => {
    const next = new Set(afpIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAfpIds(next);
  };

  const handleCloseSurvey = () => {
    if (confirm("Close this survey? Respondents will no longer be able to submit availability.")) {
      updateMutation.mutate({ id: surveyId, data: { status: "closed" } });
    }
  };

  const handleReopenSurvey = () => {
    if (confirm("Reopen this survey? Respondents will be able to submit availability again.")) {
      updateMutation.mutate({ id: surveyId, data: { status: "open" } });
    }
  };

  const handleRunAllocation = () => {
    if (survey?.status !== "closed") {
      alert("Survey must be closed before running allocation.");
      return;
    }
    runAllocMutation.mutate(
      { id: surveyId, data: { afpRespondentIds: Array.from(afpIds) } },
      { onSuccess: () => setShowCalendar(true) }
    );
  };

  const downloadPNG = async () => {
    if (!calendarRef.current) return;
    const canvas = await html2canvas(calendarRef.current, { scale: 2, useCORS: true });
    const link = document.createElement("a");
    link.download = `${survey?.title ?? "schedule"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const downloadPDF = async () => {
    if (!calendarRef.current) return;
    const canvas = await html2canvas(calendarRef.current, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "px",
      format: [canvas.width / 2, canvas.height / 2],
    });
    pdf.addImage(imgData, "PNG", 0, 0, canvas.width / 2, canvas.height / 2);
    pdf.save(`${survey?.title ?? "schedule"}.pdf`);
  };

  if (isSurveyLoading || !survey)
    return (
      <AdminLayout>
        <div className="flex h-64 items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </AdminLayout>
    );

  return (
    <AdminLayout>
      <div className="mb-6">
        <Link
          href="/admin/surveys"
          className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Surveys
        </Link>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-display font-bold text-slate-900">{survey.title}</h1>
              <Badge
                variant={survey.status === "open" ? "default" : "secondary"}
                className="rounded-md"
              >
                {survey.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 font-medium">
              <span className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" /> {survey.shifts?.length || 0} Shifts
              </span>
              <span className="flex items-center gap-1.5">
                <Users className="w-4 h-4" /> {survey.responseCount || 0} Responses
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            {survey.status === "open" && (
              <Button
                variant="outline"
                onClick={handleCloseSurvey}
                disabled={updateMutation.isPending}
                className="rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50"
              >
                <Lock className="w-4 h-4 mr-2" /> Close Survey
              </Button>
            )}
            {survey.status === "closed" && (
              <Button
                variant="outline"
                onClick={handleReopenSurvey}
                disabled={updateMutation.isPending}
                className="rounded-xl border-emerald-200 text-emerald-700 hover:bg-emerald-50"
              >
                <LockOpen className="w-4 h-4 mr-2" /> Reopen Survey
              </Button>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="responses" className="w-full">
        <TabsList className="bg-slate-100/50 p-1 rounded-xl mb-6 inline-flex w-full overflow-x-auto justify-start">
          <TabsTrigger value="responses" className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">Responses</TabsTrigger>
          <TabsTrigger value="stats" className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">Availability Stats</TabsTrigger>
          <TabsTrigger value="allocation" className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">Allocation</TabsTrigger>
          {allocStats && (
            <TabsTrigger value="alloc-stats" className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">Post-Alloc Stats</TabsTrigger>
          )}
        </TabsList>

        {/* ── Responses Tab ───────────────────────────────── */}
        <TabsContent value="responses" className="animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">Respondent</th>
                  <th className="px-6 py-4">Shifts Selected</th>
                  <th className="px-6 py-4">Total Available Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!responses?.length ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-12 text-center text-slate-500">No responses yet.</td>
                  </tr>
                ) : (
                  responses.map((r) => (
                    <tr key={r.respondentId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900">
                        <button
                          className="underline decoration-dotted underline-offset-4 hover:text-indigo-700"
                          onClick={() => setSelectedResponse(r)}
                        >
                          {(r as any).preferredName || r.name}
                        </button>
                      </td>
                      <td className="px-6 py-4 text-slate-600">{r.selectedShiftIds.length} shifts</td>
                      <td className="px-6 py-4 font-semibold text-slate-700">{r.totalAvailableHours} hrs</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* ── Stats Tab ────────────────────────────────────── */}
        <TabsContent value="stats" className="animate-in fade-in duration-300">
          {stats ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-3">
                  <Clock className="w-6 h-6" />
                </div>
                <h3 className="text-3xl font-display font-bold text-slate-900">{stats.averageAvailableHours.toFixed(1)}</h3>
                <p className="text-sm font-medium text-slate-500">Avg Available Hours</p>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-500 rounded-full flex items-center justify-center mb-3">
                  <BarChart3 className="w-6 h-6" />
                </div>
                <h3 className="text-3xl font-display font-bold text-slate-900">±{stats.stdDevAvailableHours.toFixed(1)}</h3>
                <p className="text-sm font-medium text-slate-500">Standard Deviation</p>
              </div>
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col items-center justify-center text-center">
                <div className="w-12 h-12 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-3">
                  <Users className="w-6 h-6" />
                </div>
                <h3 className="text-3xl font-display font-bold text-slate-900">{stats.totalRespondents}</h3>
                <p className="text-sm font-medium text-slate-500">Total Respondents</p>
              </div>
              <div className="md:col-span-3 bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-2">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="font-bold text-slate-900">Shift Popularity</h3>
                </div>
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium">
                    <tr>
                      <th className="px-6 py-3">Shift</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3">Selections</th>
                      <th className="px-6 py-3">Selection Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {stats.shiftTypeStats.map((s, idx) => (
                      <tr key={idx}>
                        <td className="px-6 py-3 font-medium text-slate-900">{s.shiftLabel}</td>
                        <td className="px-6 py-3 capitalize">{s.dayType}</td>
                        <td className="px-6 py-3">{s.totalSelections}</td>
                        <td className="px-6 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-primary" style={{ width: `${s.selectionRate * 100}%` }} />
                            </div>
                            <span className="text-xs font-medium text-slate-500">{(s.selectionRate * 100).toFixed(0)}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-slate-500">Stats not available.</div>
          )}
        </TabsContent>

        {/* ── Allocation Tab ───────────────────────────────── */}
        <TabsContent value="allocation" className="animate-in fade-in duration-300 space-y-6">
          {survey.status !== "closed" && !allocations && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm font-medium">
              Close the survey first to run allocation.
            </div>
          )}

          {survey.status === "closed" && !allocations && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900 mb-1 text-lg">Select AFP Members</h3>
              <p className="text-sm text-slate-500 mb-4">
                AFP members will receive exactly <strong>10 hours</strong> each. Everyone else gets shifts distributed equitably.
              </p>
              {!responses?.length ? (
                <p className="text-slate-400 italic text-sm">No responses yet.</p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-6">
                  {responses.map((r) => (
                    <label
                      key={r.respondentId}
                      className={clsx(
                        "flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all",
                        afpIds.has(r.respondentId)
                          ? "border-indigo-400 bg-indigo-50"
                          : "border-slate-200 hover:border-indigo-200 hover:bg-slate-50"
                      )}
                    >
                      <Checkbox
                        checked={afpIds.has(r.respondentId)}
                        onCheckedChange={() => toggleAfp(r.respondentId)}
                        className="rounded data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                      />
                      <div>
                        <p className="font-medium text-slate-900 text-sm leading-tight">{r.name}</p>
                        <p className="text-xs text-slate-400">{r.totalAvailableHours} hrs avail.</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-4">
                <Button
                  onClick={handleRunAllocation}
                  disabled={runAllocMutation.isPending}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 h-12 text-base font-medium shadow-lg shadow-indigo-600/20"
                >
                  <BrainCircuit className="w-5 h-5 mr-2" />
                  {runAllocMutation.isPending ? "Allocating…" : "Make Allocation"}
                </Button>
                {afpIds.size > 0 && (
                  <span className="text-sm text-indigo-700 font-medium">
                    {afpIds.size} AFP member{afpIds.size !== 1 ? "s" : ""} selected
                  </span>
                )}
              </div>
            </div>
          )}

          {allocations && (
            <div className="space-y-6">
              <div className="flex flex-wrap justify-between items-center bg-indigo-50 p-4 rounded-xl border border-indigo-100 gap-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-indigo-600 shrink-0" />
                  <div>
                    <h3 className="font-bold text-indigo-900">Allocation Complete</h3>
                    <p className="text-sm text-indigo-700">
                      Average: {allocations.averageHours.toFixed(1)} hrs | Std Dev: {allocations.stdDev.toFixed(2)}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  {survey.status === "closed" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRunAllocation}
                      className="bg-white rounded-xl"
                    >
                      Re-run
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowCalendar((v) => !v)}
                    className="bg-white rounded-xl"
                  >
                    <Calendar className="w-4 h-4 mr-1" />
                    {showCalendar ? "Hide Calendar" : "Show Calendar"}
                  </Button>
                  {showCalendar && (
                    <>
                      <Button size="sm" variant="outline" onClick={downloadPNG} className="bg-white rounded-xl">
                        <Image className="w-4 h-4 mr-1" /> Download PNG
                      </Button>
                      <Button size="sm" variant="outline" onClick={downloadPDF} className="bg-white rounded-xl">
                        <Download className="w-4 h-4 mr-1" /> Download PDF
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {showCalendar && survey.shifts && (
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white p-4">
                  <ScheduleCalendar
                    ref={calendarRef}
                    title={survey.title}
                    month={survey.month}
                    year={survey.year}
                    allocations={allocations.allocations.map((a) => ({
                      respondentId: a.respondentId,
                      name: a.name,
                      category: a.category,
                      allocatedShifts: a.allocatedShifts,
                      totalHours: a.totalHours,
                    }))}
                    shifts={survey.shifts}
                  />
                </div>
              )}

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                    <tr>
                      <th className="px-6 py-4">Respondent</th>
                      <th className="px-6 py-4">Assigned Shifts</th>
                      <th className="px-6 py-4">Total Hours</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allocations.allocations.map((a) => (
                      <tr key={a.respondentId} className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-900">{a.name}</div>
                          <Badge
                            variant="outline"
                            className={clsx(
                              "mt-1 text-[10px] px-1.5 py-0 h-4",
                              a.category === "AFP"
                                ? "border-indigo-200 text-indigo-700 bg-indigo-50"
                                : "border-slate-200 text-slate-600 bg-slate-50"
                            )}
                          >
                            {a.category}
                          </Badge>
                          {a.isManuallyAdjusted && (
                            <Badge variant="secondary" className="mt-1 ml-1 bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0 h-4 border-none">
                              Adjusted
                            </Badge>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            {a.allocatedShifts.map((s) => (
                              <span key={s.shiftId} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                                {s.label}
                              </span>
                            ))}
                            {a.allocatedShifts.length === 0 && <span className="text-slate-400 italic">None</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-700">{a.totalHours} hrs</td>
                        <td className="px-6 py-4 text-right">
                          <Button variant="ghost" size="sm" className="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50">
                            <Settings className="w-4 h-4 mr-1" /> Adjust
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </TabsContent>

        {/* ── Post-Alloc Stats Tab ─────────────────────────── */}
        <TabsContent value="alloc-stats" className="animate-in fade-in duration-300">
          {allocStats && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
	                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
	                  <p className="text-sm font-medium text-slate-500 mb-1">Overall Average</p>
	                  <p className="text-2xl font-bold text-slate-900">{allocStats.averageHours.toFixed(1)} <span className="text-sm text-slate-400 font-normal">hrs</span></p>
	                </div>
	                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
	                  <p className="text-sm font-medium text-slate-500 mb-1">Median Hours</p>
	                  <p className="text-2xl font-bold text-slate-900">{allocStats.medianHours.toFixed(1)} <span className="text-sm text-slate-400 font-normal">hrs</span></p>
	                </div>
	                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
	                  <p className="text-sm font-medium text-slate-500 mb-1">Standard Deviation</p>
	                  <p className="text-2xl font-bold text-slate-900">{allocStats.stdDev.toFixed(2)}</p>
	                </div>
	                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
	                  <p className="text-sm font-medium text-slate-500 mb-1">Total Allocated</p>
	                  <p className="text-2xl font-bold text-slate-900">{allocStats.totalAllocatedHours.toFixed(1)} <span className="text-sm text-slate-400 font-normal">hrs</span></p>
	                </div>
	                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
	                  <p className="text-sm font-medium text-slate-500 mb-1">Min Hours</p>
	                  <p className="text-2xl font-bold text-slate-900">{allocStats.minHours} <span className="text-sm text-slate-400 font-normal">hrs</span></p>
	                </div>
	                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  <p className="text-sm font-medium text-slate-500 mb-1">Max Hours</p>
                  <p className="text-2xl font-bold text-slate-900">{allocStats.maxHours} <span className="text-sm text-slate-400 font-normal">hrs</span></p>
                </div>
              </div>
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden mt-4">
                <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                  <h3 className="font-bold text-slate-900">Per-Respondent Analysis</h3>
                </div>
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-500 font-medium">
                    <tr>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Category</th>
                      <th className="px-6 py-3">Total Hrs</th>
                      <th className="px-6 py-3">Weekday Shifts</th>
                      <th className="px-6 py-3">Weekend Shifts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {allocStats.respondentStats.map((s) => (
                      <tr key={s.respondentId}>
	                        <td className="px-6 py-3 font-medium text-slate-900">
                            <button
                              className="underline decoration-dotted underline-offset-4 hover:text-indigo-700"
                              onClick={() => setSelectedRespondentId(s.respondentId)}
                            >
                              {s.name}
                            </button>
                          </td>
	                        <td className="px-6 py-3">{s.category}</td>
	                        <td className="px-6 py-3 font-bold">{s.totalHours}</td>
	                        <td className="px-6 py-3 text-slate-600">{s.weekdayShifts}</td>
	                        <td className="px-6 py-3 text-slate-600">{s.weekendShifts}</td>
	                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
	        </TabsContent>
	      </Tabs>

      <Dialog
        open={selectedResponse !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedResponse(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Availability Details: {selectedResponse?.preferredName || selectedResponse?.name}</DialogTitle>
          </DialogHeader>
          {selectedResponse && (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                Selected shifts: <strong>{selectedResponse.selectedShiftIds.length}</strong> | Total available hours:{" "}
                <strong>{selectedResponse.totalAvailableHours}</strong>
              </p>
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 p-3">
                {(survey.shifts || [])
                  .filter((shift) => selectedResponse.selectedShiftIds.includes(shift.id))
                  .map((shift) => (
                    <div key={shift.id} className="text-sm py-1 border-b last:border-0">
                      {shift.date} — {shift.label} ({shift.durationHours} hours)
                    </div>
                  ))}
              </div>
              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  onClick={async () => {
                    await deleteResponseMutation.mutateAsync({
                      surveyId,
                      respondentId: selectedResponse.respondentId,
                    });
                    setSelectedResponse(null);
                  }}
                >
                  Delete This Response
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedRespondentId !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedRespondentId(null);
        }}
      >
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {respondentHistory
                ? `${respondentHistory.respondent.name} — Front Desk History`
                : "Respondent history"}
            </DialogTitle>
          </DialogHeader>

          {!respondentHistory ? (
            <div className="py-8 text-center text-slate-500">Loading history…</div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <p className="text-xs uppercase text-slate-500">Total Hours</p>
                  <p className="text-xl font-bold text-slate-900">
                    {respondentHistory.summary.totalAllocatedHours.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <p className="text-xs uppercase text-slate-500">Mean</p>
                  <p className="text-xl font-bold text-slate-900">
                    {respondentHistory.summary.meanHours.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <p className="text-xs uppercase text-slate-500">Median</p>
                  <p className="text-xl font-bold text-slate-900">
                    {respondentHistory.summary.medianHours.toFixed(1)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                          <p className="text-xs uppercase text-slate-500">Standard Deviation</p>
                  <p className="text-xl font-bold text-slate-900">
                    {respondentHistory.summary.stdDevHours.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">
                  Monthly Allocated Hours Trend
                </h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={respondentHistory.monthlyHistory.map((entry) => ({
                        ...entry,
                        label: `${entry.month}/${entry.year}`,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip />
                      <Line
                        type="monotone"
                        dataKey="totalHours"
                        name="Hours"
                        stroke="#4f46e5"
                        strokeWidth={3}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h4 className="text-sm font-semibold text-slate-700 mb-3">
                  Weekday vs Weekend Shift Mix
                </h4>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={respondentHistory.monthlyHistory.map((entry) => ({
                        ...entry,
                        label: `${entry.month}/${entry.year}`,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="weekdayShiftCount" name="Weekday shifts" fill="#14b8a6" />
                      <Bar dataKey="weekendShiftCount" name="Weekend shifts" fill="#f59e0b" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
	    </AdminLayout>
	  );
}
