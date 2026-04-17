import type { RespondentFdHistory } from "@workspace/api-client-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function formatMonthYear(value: string) {
  const [month, year] = value.split("/");
  const monthIndex = Number(month) - 1;
  if (!year || monthIndex < 0 || monthIndex >= MONTH_NAMES.length) return "May 2026";
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

export function RespondentHistoryPanel({ history }: { history: RespondentFdHistory }) {
  const monthlyHistory = history.monthlyHistory.map((entry) => ({
    ...entry,
    label: `${MONTH_NAMES[entry.month - 1].slice(0, 3)} ${entry.year}`,
  }));
  const weekdayShiftCount = history.monthlyHistory.reduce(
    (sum, entry) => sum + entry.weekdayShiftCount,
    0,
  );
  const weekendShiftCount = history.monthlyHistory.reduce(
    (sum, entry) => sum + entry.weekendShiftCount,
    0,
  );
  const slotPreferences = history.slotPreferences.length
    ? history.slotPreferences
    : [{ label: "No allocated shifts yet", shiftCount: 0, totalHours: 0, dayType: "weekday" as const }];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase text-slate-500">Working Since</p>
          <p className="text-xl font-bold text-slate-900">
            {formatMonthYear(history.summary.firstFrontDeskMonth)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase text-slate-500">Total Hours Ever</p>
          <p className="text-xl font-bold text-slate-900">
            {history.summary.totalAllocatedHours.toFixed(1)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase text-slate-500">Avg Monthly Hours</p>
          <p className="text-xl font-bold text-slate-900">
            {history.summary.averageHours.toFixed(1)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase text-slate-500">Weekday / Weekend</p>
          <p className="text-xl font-bold text-slate-900">
            {weekdayShiftCount} / {weekendShiftCount}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 p-4">
        <h4 className="mb-3 text-sm font-semibold text-slate-700">
          Hours Each Month
        </h4>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={monthlyHistory}>
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
        <h4 className="mb-3 text-sm font-semibold text-slate-700">
          Shift Slot Preferences
        </h4>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={slotPreferences} margin={{ bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" angle={-20} textAnchor="end" interval={0} height={70} />
              <YAxis />
              <Tooltip />
              <Bar dataKey="shiftCount" name="Shifts worked" fill="#0f766e" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
