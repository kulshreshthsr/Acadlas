// All students: find one fast, filter to a class, export the list to Excel.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, withQuery } from '../../lib/api';
import { date, phone, plural } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { sectionOptions, useStructure } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { Icon } from '../../components/Icon';
import { Avatar, Card, EmptyState, ErrorState, Loading, Page, Seg } from '../../components/ui';
import { useToast } from '../../lib/toast';

export type StudentRow = {
  id: string;
  admissionNo: string;
  name: string;
  firstName: string;
  lastName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  status: 'active' | 'withdrawn' | 'graduated';
  isRte: boolean;
  consentRecordedAt: string | null;
  sectionId: string | null;
  classLabel: string | null;
  rollNo: number | null;
  guardianName: string | null;
  guardianPhone: string | null;
};

type ListResponse = { total: number; page: number; pageSize: number; rows: StudentRow[] };

export function Students() {
  const school = useSchool();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const sectionId = params.get('section') ?? '';
  const status = (params.get('status') ?? 'active') as 'active' | 'withdrawn' | 'graduated' | 'all';
  const page = Number(params.get('page') ?? 1);
  const [debounced, setDebounced] = useState(q);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);

  const structure = useStructure();
  const sections = sectionOptions(structure.data);

  const list = useQuery({
    queryKey: ['students', debounced, sectionId, status, page],
    queryFn: () => api.get<ListResponse>(withQuery('/school/students', { q: debounced, sectionId, status, page, pageSize: 50 })),
    placeholderData: keepPreviousData,
  });

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  async function exportCsv() {
    setExporting(true);
    try {
      const all: StudentRow[] = [];
      for (let p = 1; p < 50; p++) {
        const res = await api.get<ListResponse>(withQuery('/school/students', { q: debounced, sectionId, status, page: p, pageSize: 500 }));
        all.push(...res.rows);
        if (all.length >= res.total) break;
      }
      const label = sections.find((s) => s.id === sectionId)?.label;
      downloadCsv(`students${label ? `-${label}` : ''}.csv`, [
        ['Admission no.', 'Roll no.', 'First name', 'Last name', 'Class', 'Gender', 'Date of birth', 'Guardian', 'Guardian phone', 'RTE', 'Status'],
        ...all.map((s) => [s.admissionNo, s.rollNo, s.firstName, s.lastName, s.classLabel, s.gender, s.dateOfBirth, s.guardianName, s.guardianPhone, s.isRte ? 'Yes' : '', s.status]),
      ]);
      toast(`Exported ${plural(all.length, 'student')}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export failed', 'bad');
    } finally {
      setExporting(false);
    }
  }

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <Page
      title="Students"
      lead={data ? `${plural(data.total, status === 'active' ? 'student' : 'record')}${sectionId ? ` in ${sections.find((s) => s.id === sectionId)?.label ?? 'this section'}` : ''}${school.currentYear ? `, ${school.currentYear.name}` : ''}.` : ' '}
      actions={
        <>
          {school.can('students.edit') && (
            <>
              <Link to="/app/students/new" className="btn btn-sun btn-sm">
                <Icon name="plus" size={16} /> Admit a student
              </Link>
              <Link to="/app/students/import" className="btn btn-ghost btn-sm">
                <Icon name="upload" size={16} /> Import
              </Link>
            </>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv} disabled={exporting || !data?.total}>
            <Icon name="download" size={16} /> {exporting ? 'Exporting' : 'Export'}
          </button>
        </>
      }
    >
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search students</span>
          <Icon name="search" size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-10"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setParam('q', e.target.value);
            }}
            placeholder="Name, admission no. or parent’s phone"
            type="search"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto min-w-36" value={sectionId} onChange={(e) => setParam('section', e.target.value)} aria-label="Class">
            <option value="">All classes</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <Seg
            label="Status"
            value={status}
            onChange={(v) => setParam('status', v === 'active' ? '' : v)}
            options={[
              { value: 'active', label: 'Studying' },
              { value: 'withdrawn', label: 'Left' },
              { value: 'graduated', label: 'Passed out' },
            ]}
          />
        </div>
      </div>

      {list.error && <ErrorState error={list.error} retry={() => list.refetch()} />}
      {list.isPending && <Loading rows={8} />}

      {data && data.rows.length === 0 && (
        <Card>
          {debounced || sectionId || status !== 'active' ? (
            <EmptyState icon="search" title="No students match">
              Try a different name, or clear the filters.
            </EmptyState>
          ) : (
            <EmptyState
              icon="students"
              title="No students yet"
              action={
                school.can('students.edit') ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link to="/app/students/new" className="btn btn-ink btn-sm">Admit a student</Link>
                    <Link to="/app/students/import" className="btn btn-line btn-sm">Import a spreadsheet</Link>
                  </div>
                ) : undefined
              }
            >
              {school.can('students.edit') ? 'Admit them one at a time, or bring the whole school in from Excel.' : 'Students in your sections will appear here.'}
            </EmptyState>
          )}
        </Card>
      )}

      {data && data.rows.length > 0 && (
        <>
          {/* Phones: a list of people, not a squeezed table. */}
          <ul className="card divide-y divide-slate-100 md:hidden">
            {data.rows.map((s) => (
              <li key={s.id}>
                <Link to={`/app/students/${s.id}`} className="flex items-center gap-3 px-4 py-3 no-underline">
                  <Avatar name={s.name} size={38} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-semibold text-ink-800">{s.name}</span>
                      {s.isRte && <span className="tag tag-sun">RTE</span>}
                    </span>
                    <span className="block truncate text-[0.8125rem] text-slate-500">
                      {s.classLabel ?? 'No class'}
                      {s.rollNo ? `, roll ${s.rollNo}` : ''}, {s.admissionNo}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={16} className="text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>

          <div className="card hidden overflow-x-auto md:block">
            <table className="table">
              <thead>
                <tr>
                  <th className="w-14">Roll</th>
                  <th>Student</th>
                  <th>Class</th>
                  <th>Admission no.</th>
                  <th>Date of birth</th>
                  <th>Guardian</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={s.id} data-href onClick={() => navigate(`/app/students/${s.id}`)}>
                    <td className="num text-slate-500">{s.rollNo ?? '—'}</td>
                    <td>
                      <Link to={`/app/students/${s.id}`} className="flex items-center gap-2.5 font-semibold text-ink-800 no-underline" onClick={(e) => e.stopPropagation()}>
                        <Avatar name={s.name} size={30} />
                        <span>{s.name}</span>
                        {s.isRte && <span className="tag tag-sun">RTE</span>}
                        {s.status !== 'active' && <span className="tag tag-slate">{s.status === 'withdrawn' ? 'Left' : 'Passed out'}</span>}
                        {!s.consentRecordedAt && s.status === 'active' && school.can('students.edit') && (
                          <span className="tag tag-coral" title="Guardian consent has not been recorded">No consent</span>
                        )}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{s.classLabel ?? <span className="text-slate-400">No class</span>}</td>
                    <td className="num whitespace-nowrap text-slate-600">{s.admissionNo}</td>
                    <td className="whitespace-nowrap text-slate-600">{date(s.dateOfBirth)}</td>
                    <td>
                      <span className="block">{s.guardianName ?? '—'}</span>
                      <span className="num block text-[0.8125rem] text-slate-500">{phone(s.guardianPhone)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-between gap-3 text-[0.875rem]" aria-label="Pages">
              <button type="button" className="btn btn-line btn-sm" disabled={page <= 1} onClick={() => setParam('page', String(page - 1))}>
                <Icon name="chevron-left" size={15} /> Previous
              </button>
              <span className="text-slate-500">
                Page {page} of {pages}
              </span>
              <button type="button" className="btn btn-line btn-sm" disabled={page >= pages} onClick={() => setParam('page', String(page + 1))}>
                Next <Icon name="chevron-right" size={15} />
              </button>
            </nav>
          )}
        </>
      )}
    </Page>
  );
}
