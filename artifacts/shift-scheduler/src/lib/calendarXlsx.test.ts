import test from "node:test";
import assert from "node:assert/strict";
import { buildCalendarWorkbook } from "./calendarXlsx.ts";

test("calendar XLSX workbook has editable calendar structure and placeholder marker", async () => {
  const workbook = await buildCalendarWorkbook({
    survey: {
      title: "May Front Desk",
      month: 5,
      year: 2026,
      shifts: [
        {
          id: 1,
          date: "2026-05-04",
          dayType: "weekday",
          startTime: "09:00",
          endTime: "11:00",
          durationHours: 2,
          label: "09:00-11:00",
        },
        {
          id: 2,
          date: "2026-05-09",
          dayType: "weekend",
          startTime: "08:00",
          endTime: "12:00",
          durationHours: 4,
          label: "08:00-12:00",
        },
      ],
    },
    responses: [{ respondentId: 1, email: "afp@example.com" }],
    allocations: [
      {
        respondentId: 1,
        name: "Asha",
        category: "AFP",
        totalHours: 6,
        allocatedShifts: [
          {
            shiftId: 1,
            date: "2026-05-04",
            label: "09:00-11:00",
            startTime: "09:00",
            endTime: "11:00",
            durationHours: 2,
            dayType: "weekday",
            assignmentSource: "engine_normal",
            isManual: false,
            isEmergency: false,
            explanationCodes: [],
          },
          {
            shiftId: 2,
            date: "2026-05-09",
            label: "08:00-12:00",
            startTime: "08:00",
            endTime: "12:00",
            durationHours: 4,
            dayType: "weekend",
            assignmentSource: "admin_no_availability_afp_placeholder",
            isManual: false,
            isEmergency: false,
            explanationCodes: ["NO_AVAILABILITY"],
          },
        ],
      },
    ],
    blankShiftExplanations: [],
    allocationAudit: [],
    allocStats: {
      respondentStats: [
        {
          name: "Asha",
          category: "AFP",
          totalHours: 6,
          shiftCount: 2,
          noAvailabilityPlaceholderHours: 4,
        },
      ],
      afpStats: [
        {
          name: "Asha",
          category: "AFP",
          totalHours: 6,
          shiftCount: 2,
          noAvailabilityPlaceholderHours: 4,
        },
      ],
      nonPenalizedGeneralMeanHours: 0,
      nonPenalizedGeneralStdDevHours: 0,
      fairnessRepairMoveCount: 0,
    },
  });

  assert.equal(workbook.worksheets[0].name, "Calendar");
  assert.ok(workbook.getWorksheet("Schedule List"));
  assert.ok(workbook.getWorksheet("Person Summary"));
  assert.ok(workbook.getWorksheet("Blank Shifts"));
  assert.ok(workbook.getWorksheet("Fairness Stats"));
  assert.ok(workbook.getWorksheet("Allocation Audit"));
  assert.ok(workbook.getWorksheet("AFP Analysis"));

  const calendar = workbook.getWorksheet("Calendar");
  assert.ok(calendar);
  assert.equal(calendar.getCell("A1").value, "Front Desk Schedule: May 2026");

  const values: string[] = [];
  calendar.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === "string") values.push(cell.value);
    });
  });

  assert.ok(values.includes("Week 1"));
  assert.ok(values.includes("Weekday"));
  assert.ok(values.includes("Weekend"));
  assert.ok(values.includes("Asha"));
  assert.ok(values.includes("Asha*"));
  assert.ok(values.some((value) => value.includes("No one submitted availability")));

  const placeholderCell = calendar
    .getRows(1, calendar.rowCount)
    ?.flatMap((row) => row.values as unknown[])
    .find((value) => value === "Asha*");
  assert.equal(placeholderCell, "Asha*");
  assert.equal(calendar.protection, undefined);

  const scheduleList = workbook.getWorksheet("Schedule List");
  const scheduleValues: string[] = [];
  scheduleList?.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === "string") scheduleValues.push(cell.value);
    });
  });
  assert.ok(scheduleValues.includes("admin_no_availability_afp_placeholder"));
});
