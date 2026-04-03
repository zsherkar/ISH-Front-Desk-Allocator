import { forwardRef } from "react";
import { format, parseISO, getDay } from "date-fns";

interface AllocatedShift {
  shiftId: number;
  date: string;
  label: string;
  durationHours: number;
  dayType: "weekday" | "weekend";
  startTime?: string;
  endTime?: string;
}

interface AllocationEntry {
  respondentId: number;
  name: string;
  category: "AFP" | "General";
  allocatedShifts: AllocatedShift[];
  totalHours: number;
}

interface ScheduleCalendarProps {
  title: string;
  month: number;
  year: number;
  allocations: AllocationEntry[];
  shifts: Array<{
    id: number;
    date: string;
    dayType: string;
    startTime: string;
    endTime: string;
    durationHours: number;
    label: string;
  }>;
}

const WEEKDAY_SLOTS = [
  { startTime: "09:00", endTime: "11:00", label: "9am - 11am", duration: "2 hours" },
  { startTime: "11:00", endTime: "14:00", label: "11am - 2pm", duration: "3 hours" },
  { startTime: "14:00", endTime: "17:00", label: "2pm - 5pm", duration: "3 hours" },
  { startTime: "17:00", endTime: "20:00", label: "5pm - 8pm", duration: "3 hours" },
];

const WEEKEND_SLOTS = [
  { startTime: "08:00", endTime: "12:00", label: "8 am - 12 pm", duration: "4 hours" },
  { startTime: "12:00", endTime: "16:00", label: "12 pm - 4 pm", duration: "4 hours" },
  { startTime: "16:00", endTime: "20:00", label: "4 pm - 8 pm", duration: "4 hours" },
];

const DOW_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function getCalendarWeeks(year: number, month: number): Array<{ weekNum: number; weekdays: string[]; weekends: string[] }> {
  const weeks: Array<{ weekNum: number; weekdays: string[]; weekends: string[] }> = [];
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0);

  let weekNum = 1;
  let currentWeek: { weekNum: number; weekdays: string[]; weekends: string[] } | null = null;

  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    const isNewWeek = dow === 1 || (currentWeek === null);

    if (isNewWeek && currentWeek !== null) {
      weeks.push(currentWeek);
      weekNum++;
    }

    if (isNewWeek || currentWeek === null) {
      currentWeek = { weekNum, weekdays: [], weekends: [] };
    }

    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (dow === 0 || dow === 6) {
      currentWeek.weekends.push(dateStr);
    } else {
      currentWeek.weekdays.push(dateStr);
    }
  }

  if (currentWeek) weeks.push(currentWeek);
  return weeks;
}

function formatDateHeader(dateStr: string): string {
  const d = parseISO(dateStr);
  return `${d.getDate()}-${format(d, "MMM")}`;
}

const cellStyle: React.CSSProperties = {
  border: "1px solid #5f6b7a",
  padding: "3px 5px",
  fontSize: 11,
  color: "#1f2937",
  textAlign: "center",
  verticalAlign: "middle",
  minWidth: 52,
  height: 22,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: "bold",
};

const timeCellStyle: React.CSSProperties = {
  ...cellStyle,
  backgroundColor: "#fef9c3",
  textAlign: "center",
  minWidth: 90,
};

const durationCellStyle: React.CSSProperties = {
  ...cellStyle,
  backgroundColor: "#fde68a",
  color: "#7c2d12",
  fontWeight: "bold",
  minWidth: 80,
};

export const ScheduleCalendar = forwardRef<HTMLDivElement, ScheduleCalendarProps>(
  ({ title, month, year, allocations, shifts }, ref) => {
    const personMap = new Map<string, string>();
    const shiftInfoMap = new Map(shifts.map((s) => [s.id, s]));

    for (const entry of allocations) {
      for (const shift of entry.allocatedShifts) {
        const st = shift.startTime ?? shiftInfoMap.get(shift.shiftId)?.startTime;
        if (!st) continue;
        const key = `${shift.date}|${st}`;
        personMap.set(key, entry.name);
      }
    }

    const weeks = getCalendarWeeks(year, month);
    const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

    return (
      <div
        ref={ref}
        style={{
          backgroundColor: "#ffffff",
          padding: 24,
          fontFamily: "Arial, Helvetica, sans-serif",
          display: "inline-block",
          minWidth: 860,
        }}
      >
        <h2 style={{ textAlign: "center", textDecoration: "underline", marginBottom: 20, fontSize: 18, fontWeight: "bold" }}>
          Front Desk Schedule: {MONTH_NAMES[month - 1]} {year}
        </h2>

        {weeks.map((week) => (
          <div key={week.weekNum} style={{ marginBottom: 18 }}>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <td
                    colSpan={2 + week.weekdays.length + (week.weekends.length > 0 ? 2 + week.weekends.length : 0)}
                    style={{
                      ...headerCellStyle,
                      backgroundColor: "#aed6f1",
                      textAlign: "center",
                      fontSize: 13,
                      padding: "5px 8px",
                    }}
                  >
                    Week {week.weekNum}
                  </td>
                </tr>
                <tr>
                  <td
                    colSpan={2 + week.weekdays.length}
                    style={{
                      ...headerCellStyle,
                      backgroundColor: "#f39c12",
                      color: "#fff",
                      textAlign: "center",
                      padding: "3px 6px",
                      fontStyle: "italic",
                    }}
                  >
                    Weekday
                  </td>
                  {week.weekends.length > 0 && (
                    <td
                      colSpan={2 + week.weekends.length}
                      style={{
                        ...headerCellStyle,
                        backgroundColor: "#27ae60",
                        color: "#fff",
                        textAlign: "center",
                        padding: "3px 6px",
                        fontStyle: "italic",
                      }}
                    >
                      Weekend
                    </td>
                  )}
                </tr>
                <tr>
                  <td style={{ ...headerCellStyle, backgroundColor: "#f39c12", color: "#fff", minWidth: 90, textAlign: "left" }}>Time</td>
                  <td style={{ ...headerCellStyle, backgroundColor: "#f39c12", color: "#fff", minWidth: 80 }}>Duration per shift</td>
                  {week.weekdays.map((date) => {
                    const dow = getDay(parseISO(date));
                    return (
                      <td key={date} style={{ ...headerCellStyle, backgroundColor: "#f39c12", color: "#fff" }}>
                        <div>{DOW_ABBR[dow]}</div>
                        <div style={{ fontSize: 10, fontWeight: "normal" }}>{formatDateHeader(date)}</div>
                      </td>
                    );
                  })}
                  {week.weekdays.length === 0 && <td colSpan={5} style={{ ...cellStyle, backgroundColor: "#f39c12" }} />}
                  {week.weekends.length > 0 && (
                    <>
                      <td style={{ ...headerCellStyle, backgroundColor: "#27ae60", color: "#fff", minWidth: 90, textAlign: "left" }}>Time</td>
                      <td style={{ ...headerCellStyle, backgroundColor: "#27ae60", color: "#fff", minWidth: 80 }}>Duration per shift</td>
                      {week.weekends.map((date) => {
                        const dow = getDay(parseISO(date));
                        return (
                          <td key={date} style={{ ...headerCellStyle, backgroundColor: "#27ae60", color: "#fff" }}>
                            <div>{DOW_ABBR[dow]}</div>
                            <div style={{ fontSize: 10, fontWeight: "normal" }}>{formatDateHeader(date)}</div>
                          </td>
                        );
                      })}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {WEEKDAY_SLOTS.map((slot, idx) => (
                  <tr key={slot.startTime}>
                    <td style={timeCellStyle}>{slot.label}</td>
                    <td style={durationCellStyle}>{slot.duration}</td>
                    {week.weekdays.map((date) => {
                      const person = personMap.get(`${date}|${slot.startTime}`) ?? "";
                      return (
                        <td key={date} style={{ ...cellStyle, backgroundColor: "#fff" }}>
                          {person}
                        </td>
                      );
                    })}
                    {week.weekdays.length === 0 && (
                      Array.from({ length: 5 }).map((_, i) => (
                        <td key={i} style={{ ...cellStyle }} />
                      ))
                    )}
                    {week.weekends.length > 0 && idx < WEEKEND_SLOTS.length ? (
                      <>
                        <td style={timeCellStyle}>{WEEKEND_SLOTS[idx].label}</td>
                        <td style={durationCellStyle}>{WEEKEND_SLOTS[idx].duration}</td>
                        {week.weekends.map((date) => {
                          const person = personMap.get(`${date}|${WEEKEND_SLOTS[idx].startTime}`) ?? "";
                          return (
                            <td key={date} style={{ ...cellStyle, backgroundColor: "#fff8ee" }}>
                              {person}
                            </td>
                          );
                        })}
                      </>
                    ) : week.weekends.length > 0 ? (
                      <td colSpan={2 + week.weekends.length} style={{ ...cellStyle }} />
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    );
  }
);

ScheduleCalendar.displayName = "ScheduleCalendar";
