const WEEKDAY_SHIFTS = [
  { startTime: "09:00", endTime: "11:00", durationHours: 2, label: "9:00-11:00" },
  { startTime: "11:00", endTime: "14:00", durationHours: 3, label: "11:00-14:00" },
  { startTime: "14:00", endTime: "17:00", durationHours: 3, label: "14:00-17:00" },
  { startTime: "17:00", endTime: "20:00", durationHours: 3, label: "17:00-20:00" },
];

const WEEKEND_SHIFTS = [
  { startTime: "08:00", endTime: "12:00", durationHours: 4, label: "8:00-12:00" },
  { startTime: "12:00", endTime: "16:00", durationHours: 4, label: "12:00-16:00" },
  { startTime: "16:00", endTime: "20:00", durationHours: 4, label: "16:00-20:00" },
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
        label: `${dateLabel} | ${shift.label}`,
      });
    }
  }

  return shifts;
}
