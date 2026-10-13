// Calendar helpers. A school's day is an Indian day: "today" means today in IST, whatever
// time zone the server happens to run in (Cloudflare and most hosts run in UTC, where
// 8:30 am IST attendance would otherwise land on the previous day until 5:30 am).

export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Monday … 6 = Sunday, matching school_profile.working_days bits. */
export function weekdayIndex(isoDate: string): number {
  return (new Date(`${isoDate}T00:00:00Z`).getUTCDay() + 6) % 7;
}

export function isWorkingDay(isoDate: string, workingDaysMask: number): boolean {
  return (workingDaysMask & (1 << weekdayIndex(isoDate))) !== 0;
}

export function monthBounds(month: string): { from: string; to: string; days: string[] } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = Array.from({ length: last }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  return { from: days[0], to: days[days.length - 1], days };
}

export function formatDateIN(isoDate: string): string {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}
