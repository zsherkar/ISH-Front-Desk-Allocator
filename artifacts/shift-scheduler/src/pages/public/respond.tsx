import { useEffect, useMemo, useState } from "react";
import { useParams } from "wouter";
import { addMonths, format, parseISO } from "date-fns";
import { AlertCircle, Calendar, Check, CircleHelp, Clock, RefreshCcw, Search } from "lucide-react";
import type { Shift } from "@workspace/api-client-react";
import { useGetPublicSurvey, useSubmitResponse } from "@/hooks/use-public";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { clsx } from "clsx";

function formatTime12(time: string) {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

type RespondentCategory = "AFP" | "General";
type ShiftGroups = Record<"weekday" | "weekend", Record<string, Shift[]>>;
type StoredRespondentDetails = {
  firstName: string;
  lastName: string;
  email: string;
  preferredName: string;
  category: RespondentCategory;
  updatedAt: string;
};

const STORED_RESPONDENT_DETAILS_KEY = "fd-respondent-details";
const MONTHLY_WALL_QUOTES = [
  { quote: "I put cocoa butter all over my face and my iconic belly and my arms and legs. Why live rough? Live smooth.", by: "DJ Khaled" },
  { quote: "When I'm no longer rapping, I want to open up an ice cream parlor and call myself Scoop Dogg.", by: "Snoop Dogg" },
  { quote: "Congratulations, you played yourself.", by: "DJ Khaled" },
  { quote: "If you stop at general math, you're only going to make general math money.", by: "Snoop Dogg" },
  { quote: "I can't believe my grandmothers making me take out the garbage I'm rich f*** this I'm going home I don't need this s***.", by: "50 Cent" },
  { quote: "Sometimes I get emotional over fonts.", by: "Kanye West" },
  { quote: "Real Gs move in silence like lasagna.", by: "Lil Wayne" },
  { quote: "I don't cook, I don't clean... but let me tell you how I got this ring.", by: "Cardi B" },
  { quote: "I hate when I'm on a flight and I wake up with a water bottle next to me like oh great now I gotta be responsible for this water bottle.", by: "Kanye West" },
  { quote: "I don't even like going to the beach. The ocean is basically a toilet for fish.", by: "Vince Staples" },
  { quote: "I wear my pants so tight I can't even put my phone in my pocket. If I get a text, my leg vibrates.", by: "Danny Brown" },
  { quote: "Knock me down 9 times but I get up 10.", by: "Cardi B" },
];
const FIELD_HELP = {
  firstName: "If you do not remember this, you might be in need of medical help.",
  lastName: "Loud and Proud.",
  email: "Use the email you actually check. Ancient abandoned inboxes do not count.",
  preferredName: "As you would want your name to appear in the public schedule. No aspirational rapper names.",
  category: "AFP only if you are an Ambassador Fellow. Otherwise, Non-Ambassador Fellow it is.",
};

function normalizeSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function hasUsefulEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function FieldHelp({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          aria-label={`${label} help`}
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-60 text-center">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

function SurveyTextInput({
  label,
  help,
  error,
  inputProps,
}: {
  label: string;
  help: string;
  error?: string;
  inputProps: React.ComponentProps<typeof Input>;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        <FieldHelp label={label} text={help} />
      </div>
      <Input
        {...inputProps}
        aria-invalid={Boolean(error)}
        className={clsx(
          "h-11 bg-white",
          error && "border-destructive bg-rose-50/70 ring-1 ring-destructive",
          inputProps.className,
        )}
      />
      {error && <p className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
}

function FormWaiverNotice({
  text,
  accepted,
  onAcceptedChange,
  showCheckbox,
}: {
  text: string;
  accepted: boolean;
  onAcceptedChange?: (accepted: boolean) => void;
  showCheckbox: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50/90 px-4 py-4 text-sm leading-relaxed text-slate-600">
      <p className="font-semibold text-slate-800">Acknowledgment and Release</p>
      <p className="mt-2">{text}</p>
      {showCheckbox && onAcceptedChange ? (
        <label className="mt-4 flex items-start gap-3 text-sm text-slate-700">
          <Checkbox
            checked={accepted}
            onCheckedChange={(checked) => onAcceptedChange(checked === true)}
          />
          <span>I have read and agree to the acknowledgment and release above.</span>
        </label>
      ) : null}
    </div>
  );
}

function loadStoredRespondentDetails(): StoredRespondentDetails[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(STORED_RESPONDENT_DETAILS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (entry): entry is StoredRespondentDetails =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof entry.firstName === "string" &&
        typeof entry.lastName === "string" &&
        typeof entry.email === "string" &&
        typeof entry.preferredName === "string" &&
        (entry.category === "AFP" || entry.category === "General") &&
        typeof entry.updatedAt === "string",
    );
  } catch {
    return [];
  }
}

function saveStoredRespondentDetails(entry: StoredRespondentDetails) {
  if (typeof window === "undefined") return;

  const emailKey = entry.email.trim().toLowerCase();
  const next = [
    entry,
    ...loadStoredRespondentDetails().filter(
      (item) => item.email.trim().toLowerCase() !== emailKey,
    ),
  ].slice(0, 8);

  window.localStorage.setItem(
    STORED_RESPONDENT_DETAILS_KEY,
    JSON.stringify(next),
  );
}

export function PublicSurveyPage() {
  const { token } = useParams<{ token: string }>();
  const { data: survey, isLoading, isFetching, error, refetch } = useGetPublicSurvey(token || "");
  const submitMutation = useSubmitResponse();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState<RespondentCategory>("General");
  const [selectedShifts, setSelectedShifts] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedSuggestionEmail, setSelectedSuggestionEmail] = useState<string | null>(null);
  const [storedRespondents, setStoredRespondents] = useState<StoredRespondentDetails[]>([]);
  const [databaseRespondents, setDatabaseRespondents] = useState<StoredRespondentDetails[]>([]);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [waiverAccepted, setWaiverAccepted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setStoredRespondents(loadStoredRespondentDetails());
  }, []);

  const fullName = useMemo(
    () => [firstName.trim(), lastName.trim()].filter(Boolean).join(" "),
    [firstName, lastName],
  );
  const lookupQuery = fullName || firstName.trim() || email.trim();
  const fieldErrors = useMemo(() => {
    const trimmedFirstName = firstName.trim();
    return {
      firstName: !trimmedFirstName
        ? "First name is required."
        : /\s/.test(trimmedFirstName)
          ? "First name only here. Put the rest under Last name."
          : "",
      lastName: !lastName.trim() ? "Last name is required." : "",
      email: !email.trim()
        ? "Email is required."
        : !hasUsefulEmail(email)
          ? "Use a valid email address."
          : "",
      preferredName: !preferredName.trim() ? "Preferred name is required." : "",
    };
  }, [email, firstName, lastName, preferredName]);
  const hasFieldErrors = Object.values(fieldErrors).some(Boolean);

  useEffect(() => {
    const query = normalizeSearch(lookupQuery);
    if (!token || query.length < 3 || selectedSuggestionEmail !== null) {
      setDatabaseRespondents([]);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch(`/api/respond/${token}/respondents/lookup?q=${encodeURIComponent(lookupQuery)}`, {
        cache: "no-store",
        signal: controller.signal,
        headers: { "cache-control": "no-cache" },
      })
        .then((response) => (response.ok ? response.json() : []))
        .then((data: unknown) => {
          setDatabaseRespondents(Array.isArray(data) ? data as StoredRespondentDetails[] : []);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setDatabaseRespondents([]);
        });
    }, 180);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [lookupQuery, selectedSuggestionEmail, token]);

  const respondentMatches = useMemo(() => {
    const query = normalizeSearch(lookupQuery);
    if (query.length < 2) return [];

    const matches = new Map<string, StoredRespondentDetails>();
    const addIfMatch = (entry: StoredRespondentDetails) => {
      const name = normalizeSearch(`${entry.firstName} ${entry.lastName}`);
      const preferred = normalizeSearch(entry.preferredName);
      const savedEmail = normalizeSearch(entry.email);
      if (
        name.includes(query) ||
        preferred.includes(query) ||
        savedEmail.includes(query)
      ) {
        matches.set(entry.email.trim().toLowerCase(), entry);
      }
    };

    storedRespondents.forEach(addIfMatch);
    databaseRespondents.forEach(addIfMatch);
    return Array.from(matches.values());
  }, [databaseRespondents, lookupQuery, storedRespondents]);

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
    const deadline = survey.closesAt
      ? ` (${format(new Date(survey.closesAt), "EEEE, MMMM d, yyyy 'at' h:mm a")})`
      : "";
    return `If you would like to be considered for Front Desk shifts in ${month}, please submit your availability by the deadline${deadline}. You must have a reservation for ${nextMonth} to continue working at the Front Desk, and your ${month} Front Desk credit will be applied to your ${nextMonth} statement. Your I-House account must remain in good standing. By submitting, you confirm your agreement to these terms.`;
  }, [survey]);

  const groupedShifts = useMemo<ShiftGroups>(() => {
    if (!survey) return { weekday: {}, weekend: {} };
    return survey.shifts.reduce<ShiftGroups>(
      (acc, shift) => {
        if (!acc[shift.dayType][shift.date]) acc[shift.dayType][shift.date] = [];
        acc[shift.dayType][shift.date].push(shift);
        return acc;
      },
      { weekday: {}, weekend: {} },
    );
  }, [survey]);

  const waiverText = useMemo(() => {
    const monthLabel = survey
      ? format(new Date(survey.year, survey.month - 1, 1), "MMMM yyyy")
      : "this survey period";
    return `By submitting availability for ${monthLabel}, you acknowledge that this scheduling tool is provided solely as an internal administrative convenience on an "as is" and "as available" basis; submitted preferences do not guarantee any assignment; you remain responsible for confirming your eligibility, schedule, and ability to work any assigned shift; and, to the fullest extent permitted by applicable law, you agree to release and hold harmless International Student House, Washington DC, its affiliates, officers, employees, volunteers, administrators, and future operators from claims, losses, damages, liabilities, costs, or expenses arising from use of this form, scheduling outcomes, technical failures, delays, or data-entry errors.`;
  }, [survey]);

  const handleSuggestionSelect = (match: StoredRespondentDetails) => {
    setFirstName(match.firstName);
    setLastName(match.lastName);
    setEmail(match.email);
    setPreferredName(match.preferredName);
    setCategory(match.category);
    setSelectedSuggestionEmail(match.email);
  };

  const handleNext = () => {
    setValidationAttempted(true);
    if (hasFieldErrors) return;
    setStep(2);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    if (
      hasFieldErrors ||
      selectedShifts.size === 0 ||
      !waiverAccepted
    ) {
      setValidationAttempted(true);
      return;
    }
    const confirmSubmit = window.confirm(
      "Please confirm that your availability is accurate. If your availability changes before allocation, please notify the team."
    );
    if (!confirmSubmit) return;

    try {
      await submitMutation.mutateAsync({
        surveyToken: token || "",
        data: {
          name: fullName,
          email: email.trim(),
          selectedShiftIds: Array.from(selectedShifts),
          preferredName: preferredName.trim(),
          category,
          waiverAccepted,
        },
      });
      const savedEntry: StoredRespondentDetails = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        preferredName: preferredName.trim(),
        category,
        updatedAt: new Date().toISOString(),
      };
      saveStoredRespondentDetails(savedEntry);
      setStoredRespondents(loadStoredRespondentDetails());
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Unable to submit availability.");
    }
  };

  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading...</div>;

  if (error || !survey) {
    const isClosed = typeof error === "object" && error !== null && "status" in error && error.status === 410;
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="heritage-panel rounded-3xl p-8 max-w-md w-full text-center space-y-4">
          <AlertCircle className="w-8 h-8 mx-auto" />
          <div>
            <h2 className="text-3xl font-display font-bold">{isClosed ? "Survey Closed" : "Survey Not Found"}</h2>
            <p className="text-sm text-muted-foreground mt-2">
              {isClosed ? "If the admin has just reopened it, use the button below to check again." : "Please confirm you opened the correct survey link."}
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCcw className="w-4 h-4 mr-2" />
            {isFetching ? "Checking..." : "Check Again"}
          </Button>
        </div>
      </div>
    );
  }

  if (submitted) {
    return <div className="min-h-screen flex items-center justify-center">Thank you, {preferredName.trim()}.</div>;
  }

  const deadlineText = survey.closesAt
    ? format(new Date(survey.closesAt), "EEEE, MMMM d, yyyy 'at' h:mm a")
    : null;
  const wallQuote = MONTHLY_WALL_QUOTES[(survey.month - 1) % MONTHLY_WALL_QUOTES.length];
  const weekdays = Object.keys(groupedShifts.weekday).sort();
  const weekends = Object.keys(groupedShifts.weekend).sort();
  const showSuggestions =
    step === 1 &&
    selectedSuggestionEmail === null &&
    normalizeSearch(lookupQuery).length >= 2 &&
    respondentMatches.length > 0;

  return (
    <div className="min-h-screen relative pb-24 page-transition-enter">
      <div className="relative max-w-3xl mx-auto pt-12 px-4 sm:px-6">
        <div className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-display font-bold leading-tight tracking-normal text-foreground">International Student House, Washington DC</h1>
          <h2 className="text-xl font-semibold mt-2">Front Desk Shift Availability Survey</h2>
          <p className="text-muted-foreground mt-2">{format(new Date(survey.year, survey.month - 1), "MMMM yyyy")}</p>
          {deadlineText && (
            <p className="text-sm text-muted-foreground mt-2 flex items-center justify-center gap-2">
              <Clock className="w-4 h-4" />
              Submit by {deadlineText}
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          {step === 1 && (
            <>
              <div className="heritage-panel p-6 sm:p-8 rounded-3xl space-y-5">
                <p className="text-sm leading-relaxed text-muted-foreground">{disclaimer}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <SurveyTextInput
                    label="First name"
                    help={FIELD_HELP.firstName}
                    error={validationAttempted ? fieldErrors.firstName : ""}
                    inputProps={{
                      required: true,
                      value: firstName,
                      onChange: (e) => {
                        setFirstName(e.target.value);
                        setSelectedSuggestionEmail(null);
                      },
                      placeholder: "First name",
                      autoComplete: "given-name",
                    }}
                  />
                  <SurveyTextInput
                    label="Last name"
                    help={FIELD_HELP.lastName}
                    error={validationAttempted ? fieldErrors.lastName : ""}
                    inputProps={{
                      required: true,
                      value: lastName,
                      onChange: (e) => {
                        setLastName(e.target.value);
                        setSelectedSuggestionEmail(null);
                      },
                      placeholder: "Last name",
                      autoComplete: "family-name",
                    }}
                  />
                  <SurveyTextInput
                    label="Email"
                    help={FIELD_HELP.email}
                    error={validationAttempted ? fieldErrors.email : ""}
                    inputProps={{
                      required: true,
                      type: "email",
                      value: email,
                      onChange: (e) => {
                        setEmail(e.target.value);
                        setSelectedSuggestionEmail(null);
                      },
                      placeholder: "Email",
                      autoComplete: "email",
                    }}
                  />
                  <SurveyTextInput
                    label="Preferred first name"
                    help={FIELD_HELP.preferredName}
                    error={validationAttempted ? fieldErrors.preferredName : ""}
                    inputProps={{
                      required: true,
                      value: preferredName,
                      onChange: (e) => {
                        setPreferredName(e.target.value);
                        setSelectedSuggestionEmail(null);
                      },
                      placeholder: "Preferred first name",
                      autoComplete: "given-name",
                    }}
                  />
                  {showSuggestions && (
                    <div className="sm:col-span-2 rounded-2xl border border-slate-200 overflow-hidden">
                      <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 text-sm font-medium text-slate-700 border-b border-slate-200">
                        <Search className="w-4 h-4" />
                        Saved details
                      </div>
                      <div className="divide-y divide-slate-200">
                        {respondentMatches.slice(0, 5).map((match) => (
                          <button
                            key={match.email}
                            type="button"
                            className="w-full px-4 py-3 text-left hover:bg-slate-50 transition-colors"
                            onClick={() => handleSuggestionSelect(match)}
                          >
                            <div className="font-medium text-slate-900">
                              {match.firstName} {match.lastName}
                            </div>
                            <div className="text-sm text-slate-500">
                              {match.email} | Preferred name: {match.preferredName}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {selectedSuggestionEmail !== null && (
                    <div className="sm:col-span-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                      Saved details loaded. Review them and continue.
                    </div>
                  )}
                  <div className="space-y-1.5 sm:col-span-2">
                    <div className="flex items-center gap-1.5">
                      <label className="text-sm font-medium text-slate-700">Front Desk Category</label>
                      <FieldHelp label="Front Desk Category" text={FIELD_HELP.category} />
                    </div>
                    <select
                      className="h-11 w-full rounded-md border border-border bg-white px-3"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as RespondentCategory)}
                    >
                      <option value="General">Non-Ambassador Fellow</option>
                      <option value="AFP">Ambassador Fellow (AFP)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700">
                    All fields are required. First name means first name only; last name gets the rest. Preferred name is what appears on the schedule. Use the same email every month so your Front Desk history stays connected.
                  </div>
                </div>

              <Button
                type="button"
                onClick={handleNext}
              >
                Next
              </Button>

                {validationAttempted && hasFieldErrors && (
                  <p className="text-sm font-medium text-destructive">
                    Fill the highlighted fields before moving ahead.
                  </p>
                )}
              </div>
              <div className="mx-auto mt-6 max-w-3xl text-center font-display text-2xl sm:text-3xl italic leading-snug text-slate-700">
                <span className="rounded-md bg-white/45 px-5 py-3 shadow-sm">
                  "{wallQuote.quote}" ~ {wallQuote.by}
                </span>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div className="heritage-panel p-6 sm:p-8 rounded-3xl relative z-10">
                <h2 className="text-2xl font-display font-bold text-foreground mb-6 flex items-center"><Calendar className="w-5 h-5 mr-2" />Availability</h2>
                <div className="space-y-10">
                  {[{ key: "weekday" as const, title: "Weekday Shifts", dates: weekdays }, { key: "weekend" as const, title: "Weekend Shifts", dates: weekends }].map((group) => (
                    <div key={group.key}>
                      <h3 className="font-bold text-lg mb-4">{group.title}</h3>
                      <div className="space-y-4">
                        {group.dates.map((date) => (
                          <div key={date} className="rounded-xl border p-4">
                            <p className="font-semibold mb-3">{format(parseISO(date), "EEEE, MMMM do")}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {groupedShifts[group.key][date].map((shift) => (
                                <button
                                  key={shift.id}
                                  type="button"
                                  aria-pressed={selectedShifts.has(shift.id)}
                                  onClick={() => toggleShift(shift.id)}
                                  className={clsx(
                                    "flex w-full items-center p-3 rounded-xl border cursor-pointer text-left transition-colors",
                                    selectedShifts.has(shift.id)
                                      ? "border-primary bg-primary/10"
                                      : "border-border hover:bg-slate-50"
                                  )}
                                >
                                  <span
                                    aria-hidden="true"
                                    className={clsx(
                                      "flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border transition-colors",
                                      selectedShifts.has(shift.id)
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-primary/40 bg-white text-transparent",
                                    )}
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </span>
                                  <div className="ml-3 flex-1">
                                    <p className="font-medium text-sm">{formatTime12(shift.startTime)} - {formatTime12(shift.endTime)}</p>
                                    <p className="text-xs text-muted-foreground mt-1 flex items-center"><Clock className="w-3 h-3 mr-1" /> {shift.durationHours} hours</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4 rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <FormWaiverNotice
                  text={waiverText}
                  accepted={waiverAccepted}
                  onAcceptedChange={setWaiverAccepted}
                  showCheckbox
                />

                {submitError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    {submitError}
                  </div>
                )}

                <div className="flex items-center justify-between bg-primary p-6 rounded-2xl text-primary-foreground">
                  <p>{selectedShifts.size} shifts selected</p>
                  <div className="flex gap-2">
                    <Button type="button" variant="secondary" onClick={() => setStep(1)}>Back</Button>
                    <Button type="submit" variant="secondary" disabled={selectedShifts.size === 0 || !waiverAccepted || submitMutation.isPending}>{submitMutation.isPending ? "Submitting..." : "Submit Availability"}</Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
