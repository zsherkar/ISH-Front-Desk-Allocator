import { useMemo, useState } from "react";
import { useParams } from "wouter";
import { addMonths, format, parseISO } from "date-fns";
import { Calendar, Clock, CheckCircle2, AlertCircle, CircleHelp } from "lucide-react";
import { useGetPublicSurvey, useSubmitResponse } from "@/hooks/use-public";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { clsx } from "clsx";

function formatTime12(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function PublicSurveyPage() {
  const { token } = useParams<{ token: string }>();
  const { data: survey, isLoading, error } = useGetPublicSurvey(token || "");
  const submitMutation = useSubmitResponse();

  const [fullName, setFullName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<"AFP" | "General">("General");
  const [selectedShifts, setSelectedShifts] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);

  const toggleShift = (id: number) => {
    const newSet = new Set(selectedShifts);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedShifts(newSet);
  };

  const disclaimer = useMemo(() => {
    if (!survey) return "";
    const monthDate = new Date(survey.year, survey.month - 1, 1);
    const nextMonthDate = addMonths(monthDate, 1);
    const month = format(monthDate, "MMMM");
    const nextMonth = format(nextMonthDate, "MMMM");
    return `If you would like to be considered for Front Desk shifts in ${month}, please submit your availability by the deadline listed in this survey. You must have a reservation for ${nextMonth} to continue working at the Front Desk, and your ${month} Front Desk credit will be applied to your ${nextMonth} statement. Your I-House account must remain in good standing. By submitting, you confirm your agreement to these terms.`;
  }, [survey]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !preferredName || selectedShifts.size === 0) return;
    const confirmSubmit = window.confirm(
      "Please confirm that your availability is accurate. If your availability changes before allocation, please notify the team."
    );
    if (!confirmSubmit) return;

    try {
      await submitMutation.mutateAsync({
        surveyToken: token || "",
        data: {
          name: fullName,
          email: email || null,
          selectedShiftIds: Array.from(selectedShifts),
          preferredName,
          category,
        } as any,
      } as any);
      setSubmitted(true);
    } catch (err) {
      console.error(err);
    }
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  if (error || !survey) {
    const isClosed = (error as any)?.response?.status === 410;
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="heritage-panel rounded-3xl p-8 max-w-md w-full text-center">
          <AlertCircle className="w-8 h-8 mx-auto mb-4" />
          <h2 className="text-3xl font-display font-bold">{isClosed ? "Survey Closed" : "Survey Not Found"}</h2>
        </div>
      </div>
    );
  }

  if (submitted) {
    return <div className="min-h-screen flex items-center justify-center">Thank you, {preferredName}.</div>;
  }

  const groupedShifts = survey.shifts.reduce((acc: any, shift) => {
    if (!acc[shift.dayType]) acc[shift.dayType] = {};
    if (!acc[shift.dayType][shift.date]) acc[shift.dayType][shift.date] = [];
    acc[shift.dayType][shift.date].push(shift);
    return acc;
  }, {});

  const weekdays = Object.keys(groupedShifts.weekday || {}).sort();
  const weekends = Object.keys(groupedShifts.weekend || {}).sort();

  return (
    <div className="min-h-screen relative pb-24 page-transition-enter">
      <div className="relative max-w-3xl mx-auto pt-12 px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-display font-bold">International House Washington DC</h1>
          <h2 className="text-xl font-semibold mt-2">Front Desk Shift Availability Survey</h2>
          <p className="text-muted-foreground mt-2">{format(new Date(survey.year, survey.month - 1), "MMMM yyyy")}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {step === 1 && (
            <div className="heritage-panel p-6 sm:p-8 rounded-3xl space-y-5">
              <p className="text-sm leading-relaxed text-muted-foreground">{disclaimer}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input required value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
                <Input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
                <div className="relative">
                  <Input required value={preferredName} onChange={(e) => setPreferredName(e.target.value)} placeholder="Preferred first name" />
                  <span className="absolute right-3 top-2.5 text-slate-500" title="Enter the preferred first name exactly as it should appear on the final schedule.">
                    <CircleHelp className="w-4 h-4" />
                  </span>
                </div>
                <select className="h-10 rounded-md border border-border bg-background px-3" value={category} onChange={(e) => setCategory(e.target.value as any)}>
                  <option value="General">Non-Ambassador Fellow</option>
                  <option value="AFP">Ambassador Fellow (AFP)</option>
                </select>
              </div>
              <Button type="button" onClick={() => setStep(2)} disabled={!fullName || !email || !preferredName}>Next</Button>
            </div>
          )}

          {step === 2 && (
            <>
              <div className="heritage-panel p-6 sm:p-8 rounded-3xl relative z-10">
                <h2 className="text-2xl font-display font-bold text-foreground mb-6 flex items-center"><Calendar className="w-5 h-5 mr-2" />Availability</h2>
                <div className="space-y-10">
                  {[{ key: "weekday", title: "Weekday Shifts", dates: weekdays }, { key: "weekend", title: "Weekend Shifts", dates: weekends }].map((group: any) => (
                    <div key={group.key}>
                      <h3 className="font-bold text-lg mb-4">{group.title}</h3>
                      <div className="space-y-4">
                        {group.dates.map((date: string) => (
                          <div key={date} className="rounded-xl border p-4">
                            <p className="font-semibold mb-3">{format(parseISO(date), "EEEE, MMMM do")}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {groupedShifts[group.key][date].map((shift: any) => (
                                <label key={shift.id} className={clsx("flex items-center p-3 rounded-xl border cursor-pointer", selectedShifts.has(shift.id) ? "border-primary bg-primary/10" : "border-border")}>
                                  <Checkbox checked={selectedShifts.has(shift.id)} onCheckedChange={() => toggleShift(shift.id)} />
                                  <div className="ml-3 flex-1">
                                    <p className="font-medium text-sm">{formatTime12(shift.startTime)} - {formatTime12(shift.endTime)}</p>
                                    <p className="text-xs text-muted-foreground mt-1 flex items-center"><Clock className="w-3 h-3 mr-1" /> {shift.durationHours} hours</p>
                                  </div>
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between bg-primary p-6 rounded-2xl text-primary-foreground">
                <p>{selectedShifts.size} shifts selected</p>
                <div className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => setStep(1)}>Back</Button>
                  <Button type="submit" disabled={selectedShifts.size === 0 || submitMutation.isPending}>{submitMutation.isPending ? "Submitting..." : "Submit Availability"}</Button>
                </div>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
