import { forwardRef } from "react";
import { format, parseISO } from "date-fns";

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

type CalendarWeek = {
  weekNum: number;
  weekdays: Array<string | null>;
  weekends: Array<string | null>;
};

const WEEKDAY_SLOTS = [
  { startTime: "09:00", label: "9am - 11am", duration: "2 hours" },
  { startTime: "11:00", label: "11am - 2pm", duration: "3 hours" },
  { startTime: "14:00", label: "2pm - 5pm", duration: "3 hours" },
  { startTime: "17:00", label: "5pm - 8pm", duration: "3 hours" },
];

const WEEKEND_SLOTS = [
  { startTime: "08:00", label: "8 am - 12 pm", duration: "4 hours" },
  { startTime: "12:00", label: "12 pm - 4 pm", duration: "4 hours" },
  { startTime: "16:00", label: "4 pm - 8 pm", duration: "4 hours" },
];

const WEEKDAY_NAMES = ["Mon", "Tues", "Wed", "Thurs", "Fri"];
const WEEKEND_NAMES = ["Sat", "Sun"];
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

const PALETTE = {
  week: "#9dc3e6",
  date: "#70ad47",
  day: "#f4b183",
  border: "#3f3f3f",
  red: "#c00000",
  ink: "#111111",
  white: "#ffffff",
};

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getCalendarWeeks(year: number, month: number): CalendarWeek[] {
  const monthIndex = month - 1;
  const first = new Date(year, monthIndex, 1);
  const last = new Date(year, month, 0);
  const cursor = new Date(first);
  const firstMondayOffset = (cursor.getDay() + 6) % 7;
  cursor.setDate(cursor.getDate() - firstMondayOffset);

  const end = new Date(last);
  const lastSundayOffset = 6 - ((end.getDay() + 6) % 7);
  end.setDate(end.getDate() + lastSundayOffset);

  const weeks: CalendarWeek[] = [];
  let weekNum = 1;
  while (cursor <= end) {
    const weekdays: Array<string | null> = [];
    const weekends: Array<string | null> = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(cursor);
      date.setDate(cursor.getDate() + offset);
      const value = date.getMonth() === monthIndex ? toDateString(date) : null;
      if (offset < 5) weekdays.push(value);
      else weekends.push(value);
    }
    weeks.push({ weekNum, weekdays, weekends });
    cursor.setDate(cursor.getDate() + 7);
    weekNum += 1;
  }
  return weeks;
}

function formatDateHeader(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = parseISO(dateStr);
  return `${date.getDate()}-${format(date, "MMM")}`;
}

function getPerson(personMap: Map<string, string>, date: string | null, startTime: string): string {
  return date ? personMap.get(`${date}|${startTime}`) ?? "" : "";
}

const scheduleWidth = 1130;

const baseCellStyle: React.CSSProperties = {
  border: `1.25px solid ${PALETTE.border}`,
  color: PALETTE.ink,
  backgroundColor: PALETTE.white,
  boxSizing: "border-box",
  height: 28,
  padding: "0 5px",
  textAlign: "center",
  verticalAlign: "middle",
  whiteSpace: "nowrap",
  overflow: "hidden",
  fontSize: 12.5,
  lineHeight: "28px",
};

const titleCellStyle: React.CSSProperties = {
  ...baseCellStyle,
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 12,
};

const nameCellStyle: React.CSSProperties = {
  ...baseCellStyle,
  fontFamily: "'Aptos', 'Aptos Semibold', Arial, sans-serif",
  fontSize: 12.5,
  fontWeight: 600,
};

const categoryCellStyle: React.CSSProperties = {
  ...titleCellStyle,
  color: "#ff0000",
  fontStyle: "italic",
  fontWeight: 700,
  height: 28,
  backgroundColor: PALETTE.white,
};

const weekCellStyle: React.CSSProperties = {
  ...titleCellStyle,
  backgroundColor: PALETTE.week,
  fontWeight: 700,
  height: 30,
};

const dateCellStyle: React.CSSProperties = {
  ...titleCellStyle,
  backgroundColor: PALETTE.date,
  fontWeight: 400,
};

const dayCellStyle: React.CSSProperties = {
  ...titleCellStyle,
  backgroundColor: PALETTE.day,
  fontWeight: 700,
};

const sideHeaderStyle: React.CSSProperties = {
  ...titleCellStyle,
  color: PALETTE.red,
  fontWeight: 400,
};

const bodyLabelStyle: React.CSSProperties = {
  ...titleCellStyle,
  fontFamily: "'Aptos', Arial, sans-serif",
};

export const ExcelScheduleCalendar = forwardRef<HTMLDivElement, ScheduleCalendarProps>(
  ({ month, year, allocations, shifts }, ref) => {
    const personMap = new Map<string, string>();
    const shiftInfoMap = new Map(shifts.map((shift) => [shift.id, shift]));

    for (const entry of allocations) {
      for (const shift of entry.allocatedShifts) {
        const startTime = shift.startTime ?? shiftInfoMap.get(shift.shiftId)?.startTime;
        if (!startTime) continue;
        personMap.set(`${shift.date}|${startTime}`, entry.name);
      }
    }

    const weeks = getCalendarWeeks(year, month);

    return (
      <div
        ref={ref}
        style={{
          width: scheduleWidth,
          backgroundColor: PALETTE.white,
          color: PALETTE.ink,
          padding: "6px 0 10px",
          fontFamily: "Arial, Helvetica, sans-serif",
          boxSizing: "border-box",
        }}
      >
        <h2
          style={{
            margin: "0 0 10px",
            textAlign: "center",
            textDecoration: "underline",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 22,
            lineHeight: "28px",
            fontWeight: 700,
          }}
        >
          Front Desk Schedule: {MONTH_NAMES[month - 1]} {year}
        </h2>

        {weeks.map((week) => (
          <table
            key={week.weekNum}
            style={{
              width: "100%",
              tableLayout: "fixed",
              borderCollapse: "collapse",
              marginBottom: 16,
            }}
          >
            <colgroup>
              <col style={{ width: 110 }} />
              <col style={{ width: 140 }} />
              {WEEKDAY_NAMES.map((day) => (
                <col key={day} style={{ width: 90 }} />
              ))}
              <col style={{ width: 110 }} />
              <col style={{ width: 140 }} />
              {WEEKEND_NAMES.map((day) => (
                <col key={day} style={{ width: 90 }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <td colSpan={11} style={weekCellStyle}>Week {week.weekNum}</td>
              </tr>
              <tr>
                <td colSpan={2} style={{ ...titleCellStyle, borderBottom: 0 }} />
                <td colSpan={5} style={categoryCellStyle}>Weekday</td>
                <td colSpan={4} style={categoryCellStyle}>Weekend</td>
              </tr>
              <tr>
                <td rowSpan={2} style={sideHeaderStyle}>Time</td>
                <td rowSpan={2} style={sideHeaderStyle}>Duration per shift</td>
                {week.weekdays.map((date, index) => (
                  <td key={`weekday-date-${index}`} style={dateCellStyle}>
                    {formatDateHeader(date)}
                  </td>
                ))}
                <td rowSpan={2} style={sideHeaderStyle}>Time</td>
                <td rowSpan={2} style={sideHeaderStyle}>Duration per shift</td>
                {week.weekends.map((date, index) => (
                  <td key={`weekend-date-${index}`} style={dateCellStyle}>
                    {formatDateHeader(date)}
                  </td>
                ))}
              </tr>
              <tr>
                {WEEKDAY_NAMES.map((day) => (
                  <td key={day} style={dayCellStyle}>{day}</td>
                ))}
                {WEEKEND_NAMES.map((day) => (
                  <td key={day} style={dayCellStyle}>{day}</td>
                ))}
              </tr>
            </thead>
            <tbody>
              {WEEKDAY_SLOTS.map((slot, index) => {
                const weekendSlot = WEEKEND_SLOTS[index] ?? null;
                return (
                  <tr key={slot.startTime}>
                    <td style={bodyLabelStyle}>{slot.label}</td>
                    <td style={bodyLabelStyle}>{slot.duration}</td>
                    {week.weekdays.map((date, dayIndex) => (
                      <td key={`weekday-person-${dayIndex}`} style={nameCellStyle}>
                        {getPerson(personMap, date, slot.startTime)}
                      </td>
                    ))}
                    <td style={bodyLabelStyle}>{weekendSlot?.label ?? ""}</td>
                    <td style={bodyLabelStyle}>{weekendSlot?.duration ?? ""}</td>
                    {week.weekends.map((date, dayIndex) => (
                      <td key={`weekend-person-${dayIndex}`} style={nameCellStyle}>
                        {weekendSlot ? getPerson(personMap, date, weekendSlot.startTime) : ""}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      </div>
    );
  },
);

ExcelScheduleCalendar.displayName = "ExcelScheduleCalendar";
