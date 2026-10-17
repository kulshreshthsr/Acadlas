// The parent app's side of the API (/api/parent). Each answer holds only what the child's
// school lets parents see; a section switched off arrives as null, or is refused.
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type Sections = {
  attendance: 'off' | 'summary' | 'daily';
  fees: boolean;
  receipts: 'off' | 'list' | 'full';
  studentDetails: boolean;
  classTeacher: boolean;
};

export type ParentMe = {
  parent: { name: string };
  children: { id: string; name: string; firstName: string; schoolId: string; schoolName: string; classLabel: string | null }[];
  schools: { id: string; name: string; sections: Sections }[];
};

export type Mark = 'P' | 'A' | 'L';

export const markLabel: Record<Mark, string> = { P: 'Present', L: 'Late', A: 'Absent' };

export type ChildSummary = {
  child: { id: string; name: string; firstName: string; admissionNo: string; classLabel: string | null; rollNo: number | null; yearName: string | null };
  school: { id: string; name: string; phone: string | null; email: string | null };
  sections: Sections;
  attendance: {
    thisYear: { present: number; late: number; absent: number; total: number; percent: number | null };
    today: { date: string; mark: Mark | null; holiday: string | null; workingDay: boolean };
  } | null;
  fees: { due: number; overdue: number; nextDue: { label: string; dueOn: string; balance: number } | null } | null;
  classTeacher: string | null;
  details: { dateOfBirth: string | null; bloodGroup: string | null; address: string | null } | null;
};

export type AttendanceMonth = {
  month: string;
  mode: 'summary' | 'daily';
  summary: { present: number; late: number; absent: number; total: number; percent: number | null };
  days: { date: string; future: boolean; working: boolean; holiday: string | null; mark: Mark | null }[] | null;
};

export type ParentFees = {
  yearName: string | null;
  charges: {
    id: string;
    label: string;
    instalment: string | null;
    lateFee: boolean;
    dueOn: string;
    amount: number;
    concession: number;
    net: number;
    paid: number;
    balance: number;
    overdue: boolean;
    earlierYear: boolean;
  }[];
  totals: { net: number; paid: number; due: number; overdue: number };
};

export type ParentReceipts = {
  canOpen: boolean;
  receipts: { id: string; receiptNo: string; amount: number; mode: string; modeLabel: string; paidOn: string; status: 'valid' | 'cancelled' | 'bounced' }[];
};

export type ParentReceipt = {
  receipt: {
    id: string;
    receiptNo: string;
    amount: number;
    amountInWords: string;
    mode: string;
    modeLabel: string;
    reference: string | null;
    paidOn: string;
    status: 'valid' | 'cancelled' | 'bounced';
    bouncedOn: string | null;
  };
  lines: { label: string; amount: number; dueOn: string }[];
  student: { name: string; admissionNo: string; classLabel: string | null };
  school: { name: string; address: string; phone: string | null; email: string | null; affiliationNo: string | null; board: string | null };
  balanceNow: number | null;
};

export function useParentMe() {
  return useQuery({ queryKey: ['parent', 'me'], queryFn: () => api.get<ParentMe>('/parent/me'), staleTime: 60_000 });
}

export function useChild(id: string) {
  return useQuery({ queryKey: ['parent', 'child', id], queryFn: () => api.get<ChildSummary>(`/parent/children/${id}`) });
}
