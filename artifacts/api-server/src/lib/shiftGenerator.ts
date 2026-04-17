const WEEKDAY_SHIFTS = [
  { startTime: "09:00", endTime: "11:00", durationHours: 2 },
  { startTime: "11:00", endTime: "14:00", durationHours: 3 },
  { startTime: "14:00", endTime: "17:00", durationHours: 3 },
  { startTime: "17:00", endTime: "20:00", durationHours: 3 },
];

const WEEKEND_SHIFTS = [
  { startTime: "08:00", endTime: "12:00", durationHours: 4 },
  { startTime: "12:00", endTime: "16:00", durationHours: 4 },
  { startTime: "16:00", endTime: "20:00", durationHours: 4 },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface ShiftTemplate {
  date: string;
  dayType: "weekday" | "weekend";
  startTime: string;
  endTime: string;
  durationHours: number;
  label: string;
}

function formatTime12(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function generateShiftsForMonth(year: number, month: number): ShiftTemplate[] {
  const shifts: ShiftTemplate[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month - 1, day);
    const dayOfWeek = date.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const dayName = DAY_NAMES[dayOfWeek];
    const monthName = MONTH_NAMES[month - 1];
    const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dateLabel = `${dayName} ${monthName} ${day}`;

    const shiftTemplates = isWeekend ? WEEKEND_SHIFTS : WEEKDAY_SHIFTS;
    for (const shift of shiftTemplates) {
      shifts.push({
        date: dateStr,
        dayType: isWeekend ? "weekend" : "weekday",
        startTime: shift.startTime,
        endTime: shift.endTime,
        durationHours: shift.durationHours,
        label: `${dateLabel} | ${formatTime12(shift.startTime)}-${formatTime12(shift.endTime)}`,
      });
    }
  }

  return shifts;
}
