import { useState } from "react";
import { useParams } from "wouter";
import { AdminLayout } from "@/components/AdminLayout";
import { 
  useGetSurvey, 
  useUpdateSurvey, 
  useGetSurveyResponses, 
  useGetSurveyStats 
} from "@/hooks/use-surveys";
import { 
  useGetAllocations, 
  useRunAllocation, 
  useGetAllocationStats 
} from "@/hooks/use-allocations";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Lock, Calendar, Users, BarChart3, Clock, Settings, BrainCircuit } from "lucide-react";
import { Link } from "wouter";
import { clsx } from "clsx";

export function AdminSurveyDetail() {
  const { id } = useParams<{ id: string }>();
  const surveyId = parseInt(id, 10);
  
  const { data: survey, isLoading: isSurveyLoading } = useGetSurvey(surveyId);
  const { data: responses } = useGetSurveyResponses(surveyId);
  const { data: stats } = useGetSurveyStats(surveyId);
  const { data: allocations } = useGetAllocations(surveyId, { query: { retry: false } });
  const { data: allocStats } = useGetAllocationStats(surveyId, { query: { retry: false, enabled: !!allocations } });
  
  const updateMutation = useUpdateSurvey();
  const runAllocMutation = useRunAllocation();

  const handleCloseSurvey = () => {
    if (confirm("Are you sure you want to close this survey? Respondents will no longer be able to submit availability.")) {
      updateMutation.mutate({ id: surveyId, data: { status: 'closed' } });
    }
  };

  const handleRunAllocation = () => {
    if (survey?.status !== 'closed') {
      alert("Survey must be closed before running allocation.");
      return;
    }
    runAllocMutation.mutate({
      id: surveyId,
      data: { afpCount: 5, afpMinHours: 3, afpMaxHours: 4 }
    });
  };

  if (isSurveyLoading || !survey) return (
    <AdminLayout>
      <div className="flex h-64 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    </AdminLayout>
  );

  return (
    <AdminLayout>
      <div className="mb-6">
        <Link href="/admin/surveys" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Surveys
        </Link>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-display font-bold text-slate-900">{survey.title}</h1>
              <Badge variant={survey.status === 'open' ? 'default' : 'secondary'} className="rounded-md">
                {survey.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 mt-2 text-sm text-slate-500 font-medium">
              <span className="flex items-center gap-1.5"><Calendar className="w-4 h-4" /> {survey.shifts?.length || 0} Shifts</span>
              <span className="flex items-center gap-1.5"><Users className="w-4 h-4" /> {survey.responseCount || 0} Responses</span>
            </div>
          </div>
          <div className="flex gap-3">
            {survey.status === 'open' && (
              <Button 
                variant="outline" 
                onClick={handleCloseSurvey}
                disabled={updateMutation.isPending}
                className="rounded-xl border-amber-200 text-amber-700 hover:bg-amber-50"
              >
                <Lock className="w-4 h-4 mr-2" /> Close Survey
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
          {allocStats && <TabsTrigger value="alloc-stats" className="rounded-lg px-4 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm">Post-Alloc Stats</TabsTrigger>}
        </TabsList>

        <TabsContent value="responses" className="animate-in fade-in duration-300">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                <tr>
                  <th className="px-6 py-4">Respondent</th>
                  <th className="px-6 py-4">Category</th>
                  <th className="px-6 py-4">Shifts Selected</th>
                  <th className="px-6 py-4">Total Available Hours</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {!responses?.length ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center text-slate-500">No responses yet.</td>
                  </tr>
                ) : (
                  responses.map(r => (
                    <tr key={r.respondentId} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-slate-900">{r.name}</td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className={clsx("rounded-md", r.category === 'AFP' ? 'border-indigo-200 text-indigo-700 bg-indigo-50' : 'border-slate-200 text-slate-600 bg-slate-50')}>
                          {r.category}
                        </Badge>
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
                              <div className="h-full bg-primary" style={{ width: `${s.selectionRate * 100}%` }}></div>
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

        <TabsContent value="allocation" className="animate-in fade-in duration-300">
          {!allocations ? (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-12 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4 text-indigo-500">
                <BrainCircuit className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-slate-900">Run Automatic Allocation</h3>
              <p className="text-slate-500 mt-2 mb-8 max-w-md">
                Our algorithm will prioritize AFP members with 3-4 hours each, then distribute remaining shifts to General members to maintain low standard deviation.
              </p>
              <Button 
                onClick={handleRunAllocation} 
                disabled={runAllocMutation.isPending || survey.status !== 'closed'}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 py-6 text-lg font-medium shadow-lg shadow-indigo-600/20"
              >
                {runAllocMutation.isPending ? "Allocating..." : "Execute Allocation Engine"}
              </Button>
              {survey.status !== 'closed' && <p className="text-sm text-amber-600 mt-4 font-medium">Survey must be closed first.</p>}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex justify-between items-center bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-indigo-600" />
                  <div>
                    <h3 className="font-bold text-indigo-900">Allocation Complete</h3>
                    <p className="text-sm text-indigo-700">Average: {allocations.averageHours.toFixed(1)} hrs | Std Dev: {allocations.stdDev.toFixed(2)}</p>
                  </div>
                </div>
                <Button variant="outline" onClick={handleRunAllocation} className="bg-white rounded-xl">
                  Re-run Algorithm
                </Button>
              </div>

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
                    {allocations.allocations.map(a => (
                      <tr key={a.respondentId} className="hover:bg-slate-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-900">{a.name}</div>
                          <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 h-4">
                            {a.category}
                          </Badge>
                          {a.isManuallyAdjusted && <Badge variant="secondary" className="mt-1 ml-1 bg-amber-100 text-amber-800 text-[10px] px-1.5 py-0 h-4 border-none">Adjusted</Badge>}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            {a.allocatedShifts.map(s => (
                              <span key={s.shiftId} className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700">
                                {s.label}
                              </span>
                            ))}
                            {a.allocatedShifts.length === 0 && <span className="text-slate-400 italic">None</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-700">
                          {a.totalHours} hrs
                        </td>
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

        <TabsContent value="alloc-stats" className="animate-in fade-in duration-300">
           {allocStats && (
             <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-sm font-medium text-slate-500 mb-1">Overall Average</p>
                    <p className="text-2xl font-bold text-slate-900">{allocStats.averageHours.toFixed(1)} <span className="text-sm text-slate-400 font-normal">hrs</span></p>
                  </div>
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                    <p className="text-sm font-medium text-slate-500 mb-1">Standard Deviation</p>
                    <p className="text-2xl font-bold text-slate-900">{allocStats.stdDev.toFixed(2)}</p>
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
                        <th className="px-6 py-3">Wkdy Shifts</th>
                        <th className="px-6 py-3">Wknd Shifts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {allocStats.respondentStats.map(s => (
                        <tr key={s.respondentId}>
                          <td className="px-6 py-3 font-medium text-slate-900">{s.name}</td>
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
    </AdminLayout>
  );
}
