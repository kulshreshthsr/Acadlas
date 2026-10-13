// Who is signed in, which school they are working in, and what their role lets them do.
// Loaded once by the app shell and shared with every screen through context, so a screen
// can ask `can('fees.collect')` without waiting on anything.
import { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Permission =
  | 'school.manage'
  | 'staff.manage'
  | 'students.view.all'
  | 'students.view.own'
  | 'students.edit'
  | 'attendance.mark.all'
  | 'attendance.mark.own'
  | 'attendance.view'
  | 'fees.view'
  | 'fees.collect'
  | 'fees.manage'
  | 'reports.fees'
  | 'reports.academic'
  | 'audit.view';

export type AcademicYear = {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  isCurrent: boolean;
};

export type Me = {
  school: {
    id: string;
    name: string;
    slug: string;
    board: string | null;
    city: string | null;
    state: string | null;
    workingDays: number;
    setupCompletedAt: string | null;
  };
  user: { id: string; name: string; email: string };
  roles: string[];
  roleLabel: string;
  permissions: Permission[];
  staffId: string | null;
  currentYear: AcademicYear | null;
  today: string;
};

export function useMeQuery() {
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/school/me'), staleTime: 60_000 });
}

type SchoolContextValue = Me & { can: (...anyOf: Permission[]) => boolean };

export const SchoolContext = createContext<SchoolContextValue | null>(null);

export function makeSchoolContext(me: Me): SchoolContextValue {
  const set = new Set(me.permissions);
  return { ...me, can: (...anyOf) => anyOf.some((p) => set.has(p)) };
}

/** The signed-in person's school context. Only usable inside the app shell. */
export function useSchool(): SchoolContextValue {
  const value = useContext(SchoolContext);
  if (!value) throw new Error('useSchool must be used inside the app shell.');
  return value;
}
