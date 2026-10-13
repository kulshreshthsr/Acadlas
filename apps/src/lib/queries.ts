// Queries several screens share, so they share one cache entry too.
import { useQuery } from '@tanstack/react-query';
import { api, withQuery } from './api';

export type Structure = {
  year: { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean };
  grades: {
    id: string;
    name: string;
    position: number;
    subjectIds: string[];
    sections: {
      id: string;
      gradeId: string;
      name: string;
      label: string;
      room: string | null;
      capacity: number | null;
      classTeacherId: string | null;
      classTeacherName: string | null;
      strength: number;
      boys: number;
      girls: number;
      mine: boolean;
      assignments: { sectionId: string; subjectId: string; staffId: string }[];
    }[];
  }[];
  subjects: { id: string; name: string; code: string | null }[];
  staff: { id: string; name: string; designation: string | null }[];
};

export function useStructure(yearId?: string | null) {
  return useQuery({
    queryKey: ['structure', yearId ?? 'current'],
    queryFn: () => api.get<Structure>(withQuery('/school/structure', { yearId })),
  });
}

export type FeeHead = { id: string; name: string; position: number };

export function useFeeHeads(enabled = true) {
  return useQuery({ queryKey: ['fee-heads'], queryFn: () => api.get<FeeHead[]>('/school/fees/heads'), enabled });
}

export type Year = { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean; terms: { id: string; name: string; startsOn: string; endsOn: string }[] };

export function useYears() {
  return useQuery({ queryKey: ['years'], queryFn: () => api.get<Year[]>('/school/years') });
}

/** Every section as "6-B", in school order, for pickers. */
export function sectionOptions(structure: Structure | undefined) {
  return (structure?.grades ?? []).flatMap((g) => g.sections.map((s) => ({ id: s.id, label: s.label, gradeId: g.id, gradeName: g.name, strength: s.strength })));
}

export function classLabel(name: string) {
  return /^\d+$/.test(name) ? `Class ${name}` : name;
}

export type Family = {
  guardians: { id: string; name: string; phone: string | null; relation: string; isPrimary: boolean }[];
  /** Everyone who shares a guardian with the student, the student included, eldest first. */
  family: {
    id: string;
    name: string;
    status: string;
    classLabel: string | null;
    dateOfBirth: string | null;
    /** 1 = the eldest. */
    birthOrder: number;
    isSelf: boolean;
    isRte: boolean;
    /** What they owe in all; null when the viewer cannot see fees. */
    balance: number | null;
  }[];
};

export function useFamily(studentId: string) {
  return useQuery({ queryKey: ['family', studentId], queryFn: () => api.get<Family>(`/school/students/${studentId}/siblings`) });
}
