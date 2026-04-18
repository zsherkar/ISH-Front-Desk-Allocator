import { useState, useRef, useMemo, useEffect } from "react";
import { useParams } from "wouter";
import { AdminLayout } from "@/components/AdminLayout";
import { ExcelScheduleCalendar } from "@/components/ExcelScheduleCalendar";
import { RespondentHistoryPanel } from "@/components/RespondentHistoryPanel";
import {
  useGetSurvey,
  useUpdateSurvey,
  useGetSurveyResponses,
  useGetSurveyStats,
  useDeleteSurveyResponse,
  useUpdateSurveyResponse,
} from "@/hooks/use-surveys";
import {
  useGetAllocations,
  useRunAllocation,
  useGetAllocationStats,
  useAdjustAllocation,
} from "@/hooks/use-allocations";
import { useGetRespondentFdHistory } from "@/hooks/use-respondents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
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
import { format, parseISO } from "date-fns";

function formatTime12(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

function formatShiftDisplay(shift: { date: string; startTime: string; endTime: string }) {
  return `${format(parseISO(shift.date), "EEE, MMM d")} - ${formatTime12(shift.startTime)} - ${formatTime12(shift.endTime)}`;
}

function formatShiftLabelText(label: string) {
  if (/\b(?:AM|PM)\b/i.test(label)) return label;
  return label.replace(/\b(\d{1,2}:\d{2})\b/g, (match) => formatTime12(match));
}

type AllocationStatSummary = {
  count: number;
  average: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
  total: number;
  maxDeviation: number;
};

function summarizeAllocationStats(stats: Array<{ totalHours: number }>): AllocationStatSummary {
  const hours = stats.map((s) => s.totalHours).sort((a, b) => a - b);
  const total = hours.reduce((sum, value) => sum + value, 0);
  const count = hours.length;
  const average = count > 0 ? total / count : 0;
  const midpoint = Math.floor(count / 2);
  const median = count === 0
    ? 0
    : count % 2 === 0
      ? (hours[midpoint - 1] + hours[midpoint]) / 2
      : hours[midpoint];
  const variance = count > 0
    ? hours.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) / count
    : 0;
  const stdDev = Math.sqrt(variance);
  const maxDeviation = count > 0
    ? Math.max(...hours.map((value) => Math.abs(value - average)))
    : 0;

  return {
    count,
    average,
    median,
    stdDev,
    min: count > 0 ? hours[0] : 0,
    max: count > 0 ? hours[hours.length - 1] : 0,
    total,
    maxDeviation,
  };
}

function AllocationSummaryPanel({
  title,
  note,
  summary,
}: {
  title: string;
  note: string;
  summary: AllocationStatSummary;
}) {
  const withinOneDeviation =
    summary.count <= 2 || summary.maxDeviation <= summary.stdDev + 0.01;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{note}</p>
        </div>
        <Badge
          variant="outline"
          className={clsx(
            "rounded-md",
            withinOneDeviation
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-amber-200 bg-amber-50 text-amber-700",
          )}
        >
          {summary.count} people
        </Badge>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-slate-500">Mean</p>
          <p className="text-lg font-bold text-slate-900">{summary.average.toFixed(1)} hrs</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-slate-500">Std Dev</p>
          <p className="text-lg font-bold text-slate-900">{summary.stdDev.toFixed(2)}</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-slate-500">Range</p>
          <p className="text-lg font-bold text-slate-900">{summary.min}-{summary.max} hrs</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-slate-500">Median</p>
          <p className="text-lg font-bold text-slate-900">{summary.median.toFixed(1)} hrs</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-slate-500">Total</p>
          <p className="text-lg font-bold text-slate-900">{summary.total.toFixed(1)} hrs</p>
        </div>
        <div className="rounded-xl bg-slate-50 p-3">
          <p className="text-slate-500">Max Gap</p>
          <p className="text-lg font-bold text-slate-900">{summary.maxDeviation.toFixed(1)} hrs</p>
        </div>
      </div>
    </div>
  );
}

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
  const adjustAllocationMutation = useAdjustAllocation();
  const updateResponseMutation = useUpdateSurveyResponse();

  const [afpIds, setAfpIds] = useState<Set<number>>(new Set());
  const [showCalendar, setShowCalendar] = useState(false);
  const [selectedRespondentId, setSelectedRespondentId] = useState<number | null>(null);
  const [selectedResponse, setSelectedResponse] = useState<any | null>(null);
  const [selectedShiftIds, setSelectedShiftIds] = useState<Set<number>>(new Set());
  const [selectedHasPenalty, setSelectedHasPenalty] = useState(false);
  const [selectedPenaltyHours, setSelectedPenaltyHours] = useState(0);
  const [selectedAfpHoursCap, setSelectedAfpHoursCap] = useState(10);
  const [includedRespondentIds, setIncludedRespondentIds] = useState<Set<number>>(new Set());
  const [statsShift, setStatsShift] = useState<{ id: number; label: string; names: string[] } | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<number | null>(null);
  const [adjustShiftIds, setAdjustShiftIds] = useState<Set<number>>(new Set());
  const deleteResponseMutation = useDeleteSurveyResponse();
  const calendarRef = useRef<HTMLDivElement>(null);
  const didInitializeIncludedIds = useRef(false);
  const didInitializeAfpIds = useRef(false);
  const { data: respondentHistory } = useGetRespondentFdHistory(selectedRespondentId ?? 0);
  const hasExistingAllocations = (allocations?.allocations.length ?? 0) > 0;
  const generalAllocationSummary = useMemo(
    () => summarizeAllocationStats(
      allocStats?.generalStats ??
      allocations?.allocations.filter((allocation) => allocation.category === "General") ??
      [],
    ),
    [allocStats?.generalStats, allocations?.allocations],
  );
  const afpAllocationSummary = useMemo(
    () => summarizeAllocationStats(
      allocStats?.afpStats ??
      allocations?.allocations.filter((allocation) => allocation.category === "AFP") ??
      [],
    ),
    [allocStats?.afpStats, allocations?.allocations],
  );

  useEffect(() => {
    if (!responses?.length) return;
    setIncludedRespondentIds((prev) => {
      const responseIds = new Set(responses.map((r) => r.respondentId));
      if (!didInitializeIncludedIds.current) {
        didInitializeIncludedIds.current = true;
        return responseIds;
      }
      return new Set(Array.from(prev).filter((id) => responseIds.has(id)));
    });
  }, [responses]);

  useEffect(() => {
    if (!responses?.length || didInitializeAfpIds.current) return;
    setAfpIds(new Set(responses.filter((r) => r.category === "AFP").map((r) => r.respondentId)));
    didInitializeAfpIds.current = true;
  }, [responses]);

  const toggleAfp = (id: number) => {
    const next = new Set(afpIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setAfpIds(next);
  };

  const toggleIncludedRespondent = (id: number) => {
    const next = new Set(includedRespondentIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setIncludedRespondentIds(next);
  };

  const toggleSelectedShift = (shiftId: number) => {
    const next = new Set(selectedShiftIds);
    if (next.has(shiftId)) next.delete(shiftId);
    else next.add(shiftId);
    setSelectedShiftIds(next);
  };

  const openResponseEditor = (response: NonNullable<typeof responses>[number]) => {
    setSelectedResponse(response);
    setSelectedShiftIds(new Set(response.selectedShiftIds));
    setSelectedHasPenalty(Boolean(response.hasPenalty));
    setSelectedPenaltyHours(Number(response.penaltyHours ?? 0));
    setSelectedAfpHoursCap(Number(response.afpHoursCap ?? 10));
  };

  const updateResponseSettings = async (
    response: NonNullable<typeof responses>[number],
    updates: { hasPenalty?: boolean; penaltyHours?: number; afpHoursCap?: number },
  ) => {
    const nextHasPenalty = updates.hasPenalty ?? Boolean(response.hasPenalty);
    const nextPenaltyHours = updates.penaltyHours ?? Number(response.penaltyHours ?? 0);
    const nextAfpHoursCap = updates.afpHoursCap ?? Number(response.afpHoursCap ?? 10);
    await updateResponseMutation.mutateAsync({
      surveyId,
      respondentId: response.respondentId,
      selectedShiftIds: response.selectedShiftIds,
      hasPenalty: nextHasPenalty,
      penaltyHours: nextHasPenalty ? nextPenaltyHours : 0,
      afpHoursCap: nextAfpHoursCap,
    });
  };

  const handleCloseSurvey = () => {
    if (confirm("Close this survey? Respondents will no longer be able to submit availability.")) {
      updateMutation.mutate({ id: surveyId, data: { status: "closed" } });
    }
  };

  const handleReopenSurvey = () => {
    if (confirm("Reopen this survey? Respondents will be able to submit availability again.")) {
      updateMutation.mutate({ id: surveyId, data: { status: "open", closesAt: null } });
    }
  };

  const handleRunAllocation = () => {
    if (survey?.status !== "closed") {
      alert("Survey must be closed before running allocation.");
      return;
    }
    if (includedRespondentIds.size === 0) {
      alert("Select at least one respondent to include in allocation.");
      return;
    }
    runAllocMutation.mutate(
      { id: surveyId, data: { afpRespondentIds: Array.from(afpIds), includedRespondentIds: Array.from(includedRespondentIds) } },
      { onSuccess: () => setShowCalendar(true) }
    );
  };

  const shiftStatsByShift = useMemo(() => {
    if (!survey?.shifts) return [];
    const responseList = responses ?? [];
    const respondentById = new Map(responseList.map((r) => [r.respondentId, r]));
    return survey.shifts.map((shift) => {
      const selectedBy = responseList
        .filter((r) => r.selectedShiftIds.includes(shift.id))
        .map((r) => r.preferredName || r.name);
      return {
        id: shift.id,
        label: formatShiftDisplay(shift),
        dayType: shift.dayType,
        totalSelections: selectedBy.length,
        selectionRate: respondentById.size > 0 ? selectedBy.length / respondentById.size : 0,
        selectedBy,
      };
    });
  }, [responses, survey?.shifts]);
  const editedSelectedHours = useMemo(
    () =>
      (survey?.shifts || [])
        .filter((shift) => selectedShiftIds.has(shift.id))
        .reduce((sum, shift) => sum + shift.durationHours, 0),
    [selectedShiftIds, survey?.shifts]
  );

  const renderCalendarCanvas = async () => {
    if (!calendarRef.current) return null;
    return html2canvas(calendarRef.current, {
      backgroundColor: "#ffffff",
      scale: 3,
      useCORS: true,
    });
  };

  const downloadPNG = async () => {
    const canvas = await renderCalendarCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `${survey?.title ?? "schedule"}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const downloadPDF = async () => {
    const canvas = await renderCalendarCanvas();
    if (!canvas) return;
    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "a4",
    });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const printableWidth = pageWidth - margin * 2;
    const printableHeight = pageHeight - margin * 2;
    const pageScale = printableWidth / canvas.width;
    const sliceHeight = Math.max(1, Math.floor(printableHeight / pageScale));

    let offsetY = 0;
    let pageIndex = 0;

    while (offsetY < canvas.height) {
      const currentSliceHeight = Math.min(sliceHeight, canvas.height - offsetY);
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvas.width;
      pageCanvas.height = currentSliceHeight;

      const context = pageCanvas.getContext("2d");
      if (!context) return;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      context.drawImage(
        canvas,
        0,
        offsetY,
        canvas.width,
        currentSliceHeight,
        0,
        0,
        pageCanvas.width,
        pageCanvas.height,
      );

      if (pageIndex > 0) {
        pdf.addPage("a4", "landscape");
      }

      pdf.addImage(
        pageCanvas.toDataURL("image/png"),
        "PNG",
        margin,
        margin,
        printableWidth,
        currentSliceHeight * pageScale,
        undefined,
        "FAST",
      );

      offsetY += currentSliceHeight;
      pageIndex += 1;
    }

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
          {hasExistingAllocations && allocStats && (
            <TabsTrigger value="alloc-stats" className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">Post-Alloc Stats</TabsTrigger>
          )}
        </TabsList>

        {/* Responses Tab */}
        <TabsContent value="responses" className="animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80 text-sm text-slate-600">
              Keep a respondent checked under <strong>Use</strong> to include their saved availability in allocation. Clicking a respondent lets you add or remove shifts from that saved availability before you run the schedule.
            </div>
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">Use</th>
                  <th className="px-6 py-4">Respondent</th>
                  <th className="px-6 py-4">Strike</th>
                  <th className="px-6 py-4">AFP Cap</th>
                  <th className="px-6 py-4">Shifts Selected</th>
                  <th className="px-6 py-4">Total Available Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!responses?.length ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-slate-500">No responses yet.</td>
                  </tr>
                ) : (
                  responses.map((r) => (
                    <tr key={r.respondentId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <Checkbox
                          checked={includedRespondentIds.has(r.respondentId)}
                          onCheckedChange={() => toggleIncludedRespondent(r.respondentId)}
                        />
                      </td>
                      <td className="px-6 py-4 font-medium text-slate-900">
                        <button
                          className="underline decoration-dotted underline-offset-4 hover:text-indigo-700"
                          onClick={() => {
                            openResponseEditor(r);
                          }}
                        >
                          {r.preferredName || r.name}
                        </button>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Checkbox
                            checked={Boolean(r.hasPenalty)}
                            onCheckedChange={(checked) => {
                              void updateResponseSettings(r, {
                                hasPenalty: checked === true,
                                penaltyHours: checked === true ? Math.max(1, Number(r.penaltyHours ?? 0)) : 0,
                              });
                            }}
                          />
                          <Input
                            type="number"
                            min={0}
                            step={0.5}
                            defaultValue={r.penaltyHours ?? 0}
                            disabled={!r.hasPenalty || updateResponseMutation.isPending}
                            className="h-8 w-20 rounded-md"
                            onBlur={(event) => {
                              const value = Math.max(0, Number(event.currentTarget.value || 0));
                              if (value !== Number(r.penaltyHours ?? 0)) {
                                void updateResponseSettings(r, { hasPenalty: value > 0, penaltyHours: value });
                              }
                            }}
                          />
                          <span className="text-xs text-slate-500">hrs</span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {r.category === "AFP" || afpIds.has(r.respondentId) ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              min={0}
                              step={0.5}
                              defaultValue={r.afpHoursCap ?? 10}
                              className="h-8 w-20 rounded-md"
                              onBlur={(event) => {
                                const value = Math.max(0, Number(event.currentTarget.value || 10));
                                if (value !== Number(r.afpHoursCap ?? 10)) {
                                  void updateResponseSettings(r, { afpHoursCap: value });
                                }
                              }}
                            />
                            <span className="text-xs text-slate-500">hrs</span>
                          </div>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
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

        {/* Stats Tab */}
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
                <h3 className="text-3xl font-display font-bold text-slate-900">+/-{stats.stdDevAvailableHours.toFixed(1)}</h3>
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
                    {shiftStatsByShift.map((s) => (
                      <tr key={s.id}>
                        <td className="px-6 py-3 font-medium text-slate-900">
                          <button
                            className="underline decoration-dotted underline-offset-4 hover:text-indigo-700"
                            onClick={() => setStatsShift({ id: s.id, label: s.label, names: s.selectedBy })}
                          >
                            {s.label}
                          </button>
                        </td>
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

        {/* Allocation Tab */}
        <TabsContent value="allocation" className="animate-in fade-in duration-300 space-y-6">
          {survey.status !== "closed" && !hasExistingAllocations && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-4 text-sm font-medium">
              Close the survey first to run allocation.
            </div>
          )}

          {survey.status === "closed" && !hasExistingAllocations && (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h3 className="font-bold text-slate-900 mb-1 text-lg">Select AFP Members</h3>
              <p className="text-sm text-slate-500 mb-4">
                AFP members are capped at <strong>10 hours</strong> each. Everyone else gets shifts distributed equitably.
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
                        <p className="font-medium text-slate-900 text-sm leading-tight">{r.preferredName || r.name}</p>
                        <p className="text-xs text-slate-400">{r.totalAvailableHours} hrs avail.</p>
                        {afpIds.has(r.respondentId) && (
                          <div className="mt-2 flex items-center gap-2">
                            <span className="text-xs text-slate-500">Cap</span>
                            <Input
                              type="number"
                              min={0}
                              step={0.5}
                              defaultValue={r.afpHoursCap ?? 10}
                              className="h-7 w-20 rounded-md bg-white"
                              onClick={(event) => event.stopPropagation()}
                              onBlur={(event) => {
                                const value = Math.max(0, Number(event.currentTarget.value || 10));
                                if (value !== Number(r.afpHoursCap ?? 10)) {
                                  void updateResponseSettings(r, { afpHoursCap: value });
                                }
                              }}
                            />
                            <span className="text-xs text-slate-500">hrs</span>
                          </div>
                        )}
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
                  {runAllocMutation.isPending ? "Allocating..." : "Run Allocation"}
                </Button>
                {afpIds.size > 0 && (
                  <span className="text-sm text-indigo-700 font-medium">
                    {afpIds.size} AFP member{afpIds.size !== 1 ? "s" : ""} selected
                  </span>
                )}
              </div>
            </div>
          )}

          {hasExistingAllocations && allocations && (
            <div className="space-y-6">
              <div className="flex flex-wrap justify-between items-center bg-indigo-50 p-4 rounded-xl border border-indigo-100 gap-3">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-indigo-600 shrink-0" />
                  <div>
                    <h3 className="font-bold text-indigo-900">Allocation Complete</h3>
                    <p className="text-sm text-indigo-700">
                      Non-AFP avg: {generalAllocationSummary.average.toFixed(1)} hrs | Non-AFP Std Dev: {generalAllocationSummary.stdDev.toFixed(2)} | AFP cap: 10 hrs
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
                      Run Allocation
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
                  <ExcelScheduleCalendar
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
                                {formatShiftLabelText(s.label)}
                              </span>
                            ))}
                            {a.allocatedShifts.length === 0 && <span className="text-slate-400 italic">None</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-700">{a.totalHours} hrs</td>
                        <td className="px-6 py-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50"
                            onClick={() => {
                              setAdjustTarget(a.respondentId);
                              setAdjustShiftIds(new Set(a.allocatedShifts.map((s) => s.shiftId)));
                            }}
                          >
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

        {/* Post-Alloc Stats Tab */}
        <TabsContent value="alloc-stats" className="animate-in fade-in duration-300">
          {hasExistingAllocations && allocStats && (
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
                  <p className="text-sm font-medium text-slate-500 mb-1">Overall Std Dev</p>
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
              <div className="grid gap-4 xl:grid-cols-2">
                <AllocationSummaryPanel
                  title="Non-AFP Allocation"
                  note="Fairness is measured here, after AFP shifts are capped and removed from the remaining pool."
                  summary={generalAllocationSummary}
                />
                <AllocationSummaryPanel
                  title="AFP Allocation"
                  note="AFP respondents are tracked separately so the 10-hour cap does not distort the main allocation stats."
                  summary={afpAllocationSummary}
                />
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
                Selected shifts: <strong>{selectedShiftIds.size}</strong> | Total available hours:{" "}
                <strong>{editedSelectedHours}</strong>
              </p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Checked shifts are this respondent&apos;s saved availability. Click any row to add or remove shifts, then save. If their <strong>Use</strong> box stays checked, allocation will use this saved set directly.
              </div>
              <div className="grid gap-3 rounded-lg border border-slate-200 p-4 sm:grid-cols-2">
                <label className="flex items-center gap-3 text-sm text-slate-700">
                  <Checkbox
                    checked={selectedHasPenalty}
                    onCheckedChange={(checked) => {
                      const enabled = checked === true;
                      setSelectedHasPenalty(enabled);
                      setSelectedPenaltyHours(enabled ? Math.max(1, selectedPenaltyHours) : 0);
                    }}
                  />
                  Strike penalty
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  Deduct
                  <Input
                    type="number"
                    min={0}
                    step={0.5}
                    value={selectedPenaltyHours}
                    disabled={!selectedHasPenalty}
                    onChange={(event) => setSelectedPenaltyHours(Math.max(0, Number(event.target.value || 0)))}
                    className="h-8 w-20 rounded-md"
                  />
                  hours
                </label>
                {(selectedResponse.category === "AFP" || afpIds.has(selectedResponse.respondentId)) && (
                  <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                    AFP cap
                    <Input
                      type="number"
                      min={0}
                      step={0.5}
                      value={selectedAfpHoursCap}
                      onChange={(event) => setSelectedAfpHoursCap(Math.max(0, Number(event.target.value || 0)))}
                      className="h-8 w-20 rounded-md"
                    />
                    hours for this survey
                  </label>
                )}
              </div>
              <div className="max-h-72 overflow-auto rounded-lg border border-slate-200 p-3">
                <div className="flex justify-end gap-2 pb-3 mb-3 border-b border-slate-200">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedShiftIds(new Set((survey.shifts || []).map((shift) => shift.id)))}>
                    Select all
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedShiftIds(new Set())}>
                    Clear all
                  </Button>
                </div>
                {(survey.shifts || [])
                  .map((shift) => (
                    <button
                      key={shift.id}
                      type="button"
                      onClick={() => toggleSelectedShift(shift.id)}
                      className={clsx(
                        "w-full text-sm py-2 px-2 border-b last:border-0 rounded-md flex items-center gap-3 text-left transition-colors",
                        selectedShiftIds.has(shift.id) ? "bg-primary/10" : "hover:bg-slate-50"
                      )}
                    >
                      <Checkbox checked={selectedShiftIds.has(shift.id)} className="pointer-events-none" />
                      <span>{formatShiftDisplay(shift)} ({shift.durationHours} hours)</span>
                    </button>
                  ))}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={async () => {
                    await updateResponseMutation.mutateAsync({
                      surveyId,
                      respondentId: selectedResponse.respondentId,
                      selectedShiftIds: Array.from(selectedShiftIds),
                      hasPenalty: selectedHasPenalty,
                      penaltyHours: selectedHasPenalty ? selectedPenaltyHours : 0,
                      afpHoursCap: selectedAfpHoursCap,
                    });
                    setSelectedResponse(null);
                  }}
                >
                  Save Shift Changes
                </Button>
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
        <DialogContent className="max-h-[86vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {respondentHistory
                ? `${respondentHistory.respondent.name} - Front Desk History`
                : "Respondent history"}
            </DialogTitle>
          </DialogHeader>

          {!respondentHistory ? (
            <div className="py-8 text-center text-slate-500">Loading history...</div>
          ) : (
            <RespondentHistoryPanel history={respondentHistory} />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={statsShift !== null} onOpenChange={(open) => !open && setStatsShift(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Selected Respondents: {statsShift?.label}</DialogTitle>
          </DialogHeader>
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 p-3">
            {statsShift?.names.length ? (
              statsShift.names.map((name) => (
                <div key={name} className="text-sm py-1 border-b last:border-0">
                  {name}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No respondents selected this shift.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={adjustTarget !== null} onOpenChange={(open) => !open && setAdjustTarget(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Adjust Allocated Shifts</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200 p-3">
              {(survey.shifts || []).map((shift) => (
                <label key={shift.id} className="text-sm py-2 border-b last:border-0 flex items-center gap-3">
                  <Checkbox
                    checked={adjustShiftIds.has(shift.id)}
                    onCheckedChange={() => {
                      const next = new Set(adjustShiftIds);
                      if (next.has(shift.id)) next.delete(shift.id);
                      else next.add(shift.id);
                      setAdjustShiftIds(next);
                    }}
                  />
                  <span>{formatShiftDisplay(shift)}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end">
              <Button
                onClick={async () => {
                  if (adjustTarget === null) return;
                  const existing = allocations?.allocations.find((a) => a.respondentId === adjustTarget);
                  const existingIds = new Set(existing?.allocatedShifts.map((s) => s.shiftId) ?? []);
                  const nextIds = Array.from(adjustShiftIds);
                  const shiftIdsToAdd = nextIds.filter((id) => !existingIds.has(id));
                  const shiftIdsToRemove = Array.from(existingIds).filter((id) => !adjustShiftIds.has(id));
                  await adjustAllocationMutation.mutateAsync({
                    id: surveyId,
                    data: { respondentId: adjustTarget, shiftIdsToAdd, shiftIdsToRemove },
                  });
                  setAdjustTarget(null);
                }}
              >
                Save Allocation Adjustments
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
	    </AdminLayout>
	  );
}
