import { useState } from "react";
import { useParams } from "wouter";
import { format, parseISO } from "date-fns";
import { Calendar, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useGetPublicSurvey, useSubmitResponse } from "@/hooks/use-public";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { clsx } from "clsx";

export function PublicSurveyPage() {
  const { token } = useParams<{ token: string }>();
  const { data: survey, isLoading, error } = useGetPublicSurvey(token || "");
  const submitMutation = useSubmitResponse();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [selectedShifts, setSelectedShifts] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const toggleShift = (id: number) => {
    const newSet = new Set(selectedShifts);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedShifts(newSet);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || selectedShifts.size === 0) return;
    
    try {
      await submitMutation.mutateAsync({
        surveyToken: token || "",
        data: {
          name,
          email: email || null,
          selectedShiftIds: Array.from(selectedShifts)
        }
      });
      setSubmitted(true);
    } catch (err) {
      console.error(err);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center">
      <div className="animate-pulse flex flex-col items-center">
        <div className="w-12 h-12 rounded-full bg-secondary mb-4"></div>
        <div className="h-4 w-32 bg-secondary rounded"></div>
      </div>
    </div>;
  }

  if (error || !survey) {
    const isClosed = (error as any)?.response?.status === 410;
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="heritage-panel rounded-3xl p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto bg-accent/10 text-accent rounded-full flex items-center justify-center mb-6">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-3xl font-display font-bold text-foreground mb-2">
            {isClosed ? "Survey Closed" : "Survey Not Found"}
          </h2>
          <p className="text-muted-foreground">
            {isClosed 
              ? "This shift availability survey is no longer accepting responses. Thank you." 
              : "The link you followed appears to be invalid or expired."}
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 page-transition-enter">
        <div className="heritage-panel rounded-3xl p-8 max-w-md w-full text-center">
          <div className="w-20 h-20 mx-auto bg-primary/10 text-primary rounded-full flex items-center justify-center mb-6">
            <CheckCircle2 className="w-10 h-10" />
          </div>
          <h2 className="text-3xl font-display font-bold text-foreground mb-2">Response Recorded</h2>
          <p className="text-muted-foreground mb-8">Thank you, {name}. Your availability for {survey.title} has been saved securely.</p>
          <div className="bg-secondary/65 p-4 rounded-xl text-left border border-border">
            <p className="text-sm font-medium text-muted-foreground mb-1">Summary</p>
            <p className="font-bold text-foreground">{selectedShifts.size} shifts selected</p>
          </div>
        </div>
      </div>
    );
  }

  // Group shifts by dayType then date
  const groupedShifts = survey.shifts.reduce((acc: any, shift) => {
    if (!acc[shift.dayType]) acc[shift.dayType] = {};
    if (!acc[shift.dayType][shift.date]) acc[shift.dayType][shift.date] = [];
    acc[shift.dayType][shift.date].push(shift);
    return acc;
  }, {});

  // Sort dates
  const weekdays = Object.keys(groupedShifts.weekday || {}).sort();
  const weekends = Object.keys(groupedShifts.weekend || {}).sort();

  return (
    <div className="min-h-screen relative pb-24 page-transition-enter">
      {/* Decorative Header Background */}
      <div className="absolute top-0 left-0 right-0 h-64 bg-gradient-to-b from-primary/20 to-transparent pointer-events-none" />
      
      <div className="relative max-w-3xl mx-auto pt-12 px-4 sm:px-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary text-primary-foreground rounded-xl shadow-lg shadow-primary/20 mb-4">
            <Calendar className="w-6 h-6" />
          </div>
          <h1 className="text-4xl font-display font-extrabold text-foreground tracking-tight">{survey.title}</h1>
          <p className="text-lg text-muted-foreground mt-2 max-w-xl mx-auto">Please select all the shifts you are available to work below. The more you select, the better we can optimize the schedule.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          
          <div className="heritage-panel p-6 sm:p-8 rounded-3xl relative z-10">
            <h2 className="text-2xl font-display font-bold text-foreground mb-6 flex items-center">
              <span className="bg-primary/15 text-primary w-6 h-6 rounded-full flex items-center justify-center text-sm mr-3">1</span> 
              Your Information
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground/90">Full Name <span className="text-destructive">*</span></label>
                <Input 
                  required 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="e.g. Jane Doe" 
                  className="rounded-xl h-12 px-4 bg-secondary/55 border-border focus:bg-card"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground/90">Email Address <span className="text-muted-foreground font-normal">(Optional)</span></label>
                <Input 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  placeholder="e.g. jane@example.com" 
                  className="rounded-xl h-12 px-4 bg-secondary/55 border-border focus:bg-card"
                />
              </div>
            </div>
          </div>

          <div className="heritage-panel p-6 sm:p-8 rounded-3xl relative z-10">
            <h2 className="text-2xl font-display font-bold text-foreground mb-6 flex items-center">
              <span className="bg-primary/15 text-primary w-6 h-6 rounded-full flex items-center justify-center text-sm mr-3">2</span> 
              Availability
            </h2>
            
            <div className="space-y-10">
              {weekdays.length > 0 && (
                <div>
                  <h3 className="font-bold text-lg text-foreground mb-4 pb-2 border-b border-border">Weekday Shifts</h3>
                  <div className="space-y-6">
                    {weekdays.map(date => (
                      <div key={date} className="bg-secondary/50 rounded-2xl p-4 sm:p-5 border border-border">
                        <p className="font-semibold text-foreground/90 mb-3 flex items-center">
                          <Calendar className="w-4 h-4 mr-2 text-muted-foreground" />
                          {format(parseISO(date), 'EEEE, MMMM do')}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {groupedShifts.weekday[date].map((shift: any) => (
                            <label key={shift.id} className={clsx(
                              "flex items-center p-3 rounded-xl border cursor-pointer transition-all duration-200",
                              selectedShifts.has(shift.id) ? "border-primary bg-primary/10 shadow-sm ring-1 ring-primary/20" : "border-border bg-card hover:border-primary/40 hover:bg-secondary/40"
                            )}>
                              <Checkbox 
                                checked={selectedShifts.has(shift.id)} 
                                onCheckedChange={() => toggleShift(shift.id)}
                                className="rounded-md border-border data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                              />
                              <div className="ml-3 flex-1">
                                <p className={clsx("font-medium text-sm leading-none", selectedShifts.has(shift.id) ? "text-primary" : "text-foreground/90")}>
                                  {shift.startTime} - {shift.endTime}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1 flex items-center"><Clock className="w-3 h-3 mr-1" /> {shift.durationHours} hrs</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {weekends.length > 0 && (
                <div>
                  <h3 className="font-bold text-lg text-foreground mb-4 pb-2 border-b border-border mt-8">Weekend Shifts</h3>
                  <div className="space-y-6">
                    {weekends.map(date => (
                      <div key={date} className="bg-accent/8 rounded-2xl p-4 sm:p-5 border border-accent/20">
                        <p className="font-semibold text-foreground/90 mb-3 flex items-center">
                          <Calendar className="w-4 h-4 mr-2 text-accent/80" />
                          {format(parseISO(date), 'EEEE, MMMM do')}
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {groupedShifts.weekend[date].map((shift: any) => (
                            <label key={shift.id} className={clsx(
                              "flex items-center p-3 rounded-xl border cursor-pointer transition-all duration-200",
                              selectedShifts.has(shift.id) ? "border-accent bg-accent/10 shadow-sm ring-1 ring-accent/25" : "border-border bg-card hover:border-accent/40 hover:bg-accent/8"
                            )}>
                              <Checkbox 
                                checked={selectedShifts.has(shift.id)} 
                                onCheckedChange={() => toggleShift(shift.id)}
                                className="rounded-md border-border data-[state=checked]:bg-accent data-[state=checked]:border-accent"
                              />
                              <div className="ml-3 flex-1">
                                <p className={clsx("font-medium text-sm leading-none", selectedShifts.has(shift.id) ? "text-accent" : "text-foreground/90")}>
                                  {shift.startTime} - {shift.endTime}
                                </p>
                                <p className="text-xs text-muted-foreground mt-1 flex items-center"><Clock className="w-3 h-3 mr-1" /> {shift.durationHours} hrs</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between bg-primary p-6 sm:p-8 rounded-3xl shadow-2xl text-primary-foreground">
            <div className="mb-4 sm:mb-0 text-center sm:text-left">
              <p className="text-primary-foreground/70 text-sm font-medium mb-1">Selected Shifts</p>
              <p className="text-3xl font-display font-bold text-primary-foreground">{selectedShifts.size}</p>
            </div>
            <Button 
              type="submit" 
              size="lg"
              disabled={selectedShifts.size === 0 || !name || submitMutation.isPending}
              className="w-full sm:w-auto h-14 px-8 rounded-xl bg-accent hover:bg-accent/90 text-accent-foreground text-lg font-semibold shadow-lg shadow-black/20 transition-all active:scale-[0.98]"
            >
              {submitMutation.isPending ? "Submitting..." : "Submit Availability"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
