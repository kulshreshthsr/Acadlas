// Each guardian's way into the parent app, for one student. Shown on the student's record
// to staff who may invite parents (components/ParentAccess.tsx).
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useSchool } from './school';

export type ParentAccessState = {
  status: 'invited' | 'active' | 'revoked';
  invitedAt: string | null;
  invitedByName: string | null;
  linkExpiresAt: string | null;
  activatedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
};

export type ParentAccessData = {
  portalEnabled: boolean;
  hasDateOfBirth: boolean;
  guardians: { id: string; name: string; phone: string | null; access: ParentAccessState | null }[];
};

export type Issued = { url: string; expiresAt: string; phone: string; guardianName: string; reset: boolean };

export function useParentAccess(studentId: string) {
  const school = useSchool();
  return useQuery({
    queryKey: ['parent-access', studentId],
    queryFn: () => api.get<ParentAccessData>(`/school/students/${studentId}/parent-access`),
    enabled: school.can('parents.manage'),
  });
}

