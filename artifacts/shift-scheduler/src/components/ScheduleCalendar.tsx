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
  { startTime: "09:00", endTime: "11:00", label: "9:00 AM - 11:00 AM", duration: "2 hours" },
  { startTime: "11:00", endTime: "14:00", label: "11:00 AM - 2:00 PM", duration: "3 hours" },
  { startTime: "14:00", endTime: "17:00", label: "2:00 PM - 5:00 PM", duration: "3 hours" },
  { startTime: "17:00", endTime: "20:00", label: "5:00 PM - 8:00 PM", duration: "3 hours" },
];

const WEEKEND_SLOTS = [
  { startTime: "08:00", endTime: "12:00", label: "8:00 AM - 12:00 PM", duration: "4 hours" },
  { startTime: "12:00", endTime: "16:00", label: "12:00 PM - 4:00 PM", duration: "4 hours" },
  { startTime: "16:00", endTime: "20:00", label: "4:00 PM - 8:00 PM", duration: "4 hours" },
];

const DOW_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const PALETTE = {
  canvas: "#edf5f1",
  paper: "#ffffff",
  grid: "#31514d",
  ink: "#17211f",
  accent: "#31514d",
  week: "#d7e6df",
  weekInk: "#17211f",
  weekday: "#23675f",
  weekend: "#5a568f",
  nameCell: "#ffffff",
  time: "#e0f0eb",
  duration: "#eceefa",
  headerInk: "#ffffff",
};

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
  border: `1px solid ${PALETTE.grid}`,
  padding: 0,
  fontSize: 12,
  color: PALETTE.ink,
  textAlign: "center",
  verticalAlign: "middle",
  minWidth: 82,
  height: 46,
  whiteSpace: "normal",
  overflow: "visible",
  fontWeight: 600,
  boxSizing: "border-box",
};

const headerCellStyle: React.CSSProperties = {
  ...cellStyle,
  fontWeight: 700,
};

const timeCellStyle: React.CSSProperties = {
  ...cellStyle,
  backgroundColor: PALETTE.time,
  minWidth: 144,
};

const durationCellStyle: React.CSSProperties = {
  ...cellStyle,
  backgroundColor: PALETTE.duration,
  color: PALETTE.ink,
  fontWeight: 700,
  minWidth: 112,
};

const centeredCellContentStyle: React.CSSProperties = {
  minHeight: 46,
  height: "100%",
  padding: "7px 8px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  lineHeight: 1.18,
  fontWeight: 600,
  color: PALETTE.ink,
  boxSizing: "border-box",
  wordBreak: "break-word",
};

const headerContentStyle: React.CSSProperties = {
  ...centeredCellContentStyle,
  minHeight: 50,
  fontWeight: 800,
  color: PALETTE.headerInk,
};

const weekHeaderContentStyle: React.CSSProperties = {
  ...centeredCellContentStyle,
  minHeight: 42,
  fontWeight: 800,
  color: PALETTE.weekInk,
};

function TimeLabel({ label }: { label: string }) {
  const [start, end] = label.split(" - ");
  return (
    <div style={{ display: "grid", gap: 2, lineHeight: 1.12 }}>
      <span>{start}</span>
      {end ? <span>- {end}</span> : null}
    </div>
  );
}

function DateHeader({ date }: { date: string }) {
  const parsed = parseISO(date);
  const dow = getDay(parsed);
  return (
    <div style={{ display: "grid", gap: 3, lineHeight: 1.1 }}>
      <span style={{ fontSize: 11.5, fontWeight: 800 }}>{DOW_FULL[dow]}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700 }}>{formatDateHeader(date)}</span>
    </div>
  );
}

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
          backgroundColor: PALETTE.canvas,
          padding: 28,
          fontFamily: "'Segoe UI', Aptos, Verdana, sans-serif",
          display: "inline-block",
          minWidth: 980,
          color: PALETTE.ink,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <h2
            style={{
              display: "inline-block",
              borderBottom: `2px solid ${PALETTE.accent}`,
              margin: 0,
              paddingBottom: 7,
              fontSize: 23,
              fontWeight: 800,
              color: PALETTE.ink,
              letterSpacing: 0,
              whiteSpace: "nowrap",
            }}
          >
            Front Desk Schedule: {MONTH_NAMES[month - 1]} {year}
          </h2>
        </div>

        {weeks.map((week) => (
          <div key={week.weekNum} style={{ marginBottom: 20 }}>
            <table style={{ borderCollapse: "collapse", width: "auto", tableLayout: "auto" }}>
              <thead>
                <tr>
                  <td
                    colSpan={2 + week.weekdays.length + (week.weekends.length > 0 ? 2 + week.weekends.length : 0)}
                    style={{
                      ...headerCellStyle,
                      backgroundColor: PALETTE.week,
                      textAlign: "center",
                      fontSize: 13,
                    }}
                  >
                    <div style={weekHeaderContentStyle}>
                      Week {week.weekNum}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td
                    colSpan={2 + week.weekdays.length}
                    style={{
                      ...headerCellStyle,
                      backgroundColor: PALETTE.weekday,
                      color: PALETTE.headerInk,
                      textAlign: "center",
                      fontStyle: "italic",
                    }}
                  >
                    <div style={headerContentStyle}>Weekday</div>
                  </td>
                  {week.weekends.length > 0 && (
                    <td
                      colSpan={2 + week.weekends.length}
                      style={{
                        ...headerCellStyle,
                        backgroundColor: PALETTE.weekend,
                        color: PALETTE.headerInk,
                        textAlign: "center",
                        fontStyle: "italic",
                      }}
                    >
                      <div style={headerContentStyle}>Weekend</div>
                    </td>
                  )}
                </tr>
                <tr>
                  <td style={{ ...headerCellStyle, backgroundColor: PALETTE.weekday, color: PALETTE.headerInk, minWidth: 144 }}>
                    <div style={headerContentStyle}>Time</div>
                  </td>
                  <td style={{ ...headerCellStyle, backgroundColor: PALETTE.weekday, color: PALETTE.headerInk, minWidth: 112 }}>
                    <div style={headerContentStyle}>Duration</div>
                  </td>
                  {week.weekdays.map((date) => {
                    return (
                      <td key={date} style={{ ...headerCellStyle, backgroundColor: PALETTE.weekday, color: PALETTE.headerInk }}>
                        <div style={headerContentStyle}>
                          <DateHeader date={date} />
                        </div>
                      </td>
                    );
                  })}
                  {week.weekdays.length === 0 && (
                    <td colSpan={5} style={{ ...cellStyle, backgroundColor: PALETTE.weekday }}>
                      <div style={headerContentStyle}>&nbsp;</div>
                    </td>
                  )}
                  {week.weekends.length > 0 && (
                    <>
                      <td style={{ ...headerCellStyle, backgroundColor: PALETTE.weekend, color: PALETTE.headerInk, minWidth: 144 }}>
                        <div style={headerContentStyle}>Time</div>
                      </td>
                      <td style={{ ...headerCellStyle, backgroundColor: PALETTE.weekend, color: PALETTE.headerInk, minWidth: 112 }}>
                        <div style={headerContentStyle}>Duration</div>
                      </td>
                      {week.weekends.map((date) => {
                        return (
                          <td key={date} style={{ ...headerCellStyle, backgroundColor: PALETTE.weekend, color: PALETTE.headerInk }}>
                            <div style={headerContentStyle}>
                              <DateHeader date={date} />
                            </div>
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
                    <td style={timeCellStyle}>
                      <div style={centeredCellContentStyle}><TimeLabel label={slot.label} /></div>
                    </td>
                    <td style={durationCellStyle}>
                      <div style={centeredCellContentStyle}>{slot.duration}</div>
                    </td>
                    {week.weekdays.map((date) => {
                      const person = personMap.get(`${date}|${slot.startTime}`) ?? "";
                      return (
                        <td key={date} style={{ ...cellStyle, backgroundColor: PALETTE.nameCell }}>
                          <div style={centeredCellContentStyle}>{person || "\u00A0"}</div>
                        </td>
                      );
                    })}
                    {week.weekdays.length === 0 && (
                      Array.from({ length: 5 }).map((_, i) => (
                        <td key={i} style={{ ...cellStyle, backgroundColor: PALETTE.nameCell }}>
                          <div style={centeredCellContentStyle}>&nbsp;</div>
                        </td>
                      ))
                    )}
                    {week.weekends.length > 0 && idx < WEEKEND_SLOTS.length ? (
                      <>
                        <td style={timeCellStyle}>
                          <div style={centeredCellContentStyle}><TimeLabel label={WEEKEND_SLOTS[idx].label} /></div>
                        </td>
                        <td style={durationCellStyle}>
                          <div style={centeredCellContentStyle}>{WEEKEND_SLOTS[idx].duration}</div>
                        </td>
                        {week.weekends.map((date) => {
                          const person = personMap.get(`${date}|${WEEKEND_SLOTS[idx].startTime}`) ?? "";
                          return (
                            <td key={date} style={{ ...cellStyle, backgroundColor: PALETTE.nameCell }}>
                              <div style={centeredCellContentStyle}>{person || "\u00A0"}</div>
                            </td>
                          );
                        })}
                      </>
                    ) : week.weekends.length > 0 ? (
                      <td colSpan={2 + week.weekends.length} style={{ ...cellStyle, backgroundColor: PALETTE.nameCell }}>
                        <div style={centeredCellContentStyle}>&nbsp;</div>
                      </td>
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
