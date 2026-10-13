// Classes: the school's shape for a year — class levels, their sections, who is class
// teacher, who teaches what, and the subjects each class studies.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { plural } from '../../lib/format';
import { classLabel, useStructure, useYears } from '../../lib/queries';
import type { Structure } from '../../lib/queries';
import { useSchool } from '../../lib/school';
import { Field } from '../../components/Field';
import { FormError } from '../../components/FormError';
import { Icon } from '../../components/Icon';
import { Card, ConfirmDialog, Dialog, EmptyState, ErrorState, Loading, Page, SelectField, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

type Section = Structure['grades'][number]['sections'][number];
type Grade = Structure['grades'][number];

export function Classes() {
  const school = useSchool();
  const years = useYears();
  const [yearId, setYearId] = useState<string | null>(null);
  const structure = useStructure(yearId);
  const [open, setOpen] = useState<null | { section: Section; grade: Grade } | { grade: Grade } | 'add-class' | 'subjects'>(null);
  const manage = school.can('school.manage');
  const data = structure.data;
  const totals = data?.grades.reduce((acc, g) => ({ sections: acc.sections + g.sections.length, students: acc.students + g.sections.reduce((s, x) => s + x.strength, 0) }), { sections: 0, students: 0 });

  return (
    <Page
      title="Classes"
      lead={data && totals ? `${data.year.name}: ${plural(data.grades.length, 'class', 'classes')}, ${plural(totals.sections, 'section')}, ${plural(totals.students, 'student')}.` : ' '}
      actions={
        <>
          {(years.data?.length ?? 0) > 1 && (
            <select className="input input-sm w-auto border-white/20 bg-white/10 text-white" value={yearId ?? data?.year.id ?? ''} onChange={(e) => setYearId(e.target.value)} aria-label="Academic year">
              {years.data!.map((y) => (
                <option key={y.id} value={y.id} className="text-ink-800">
                  {y.name}{y.isCurrent ? ' (current)' : ''}
                </option>
              ))}
            </select>
          )}
          {manage && (
            <>
              <button type="button" className="btn btn-sun btn-sm" onClick={() => setOpen('add-class')}>
                <Icon name="plus" size={16} /> Add a class
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen('subjects')}>
                Subjects
              </button>
            </>
          )}
          {school.can('students.edit') && (
            <Link to="/app/classes/promote" className="btn btn-ghost btn-sm">
              <Icon name="arrow-up" size={16} /> Promote to next year
            </Link>
          )}
        </>
      }
    >
      {structure.error && <ErrorState error={structure.error} retry={() => structure.refetch()} />}
      {structure.isPending && <Loading rows={6} />}

      {data && data.grades.length === 0 && (
        <Card>
          <EmptyState icon="classes" title="No classes yet" action={manage ? <button type="button" className="btn btn-ink btn-sm" onClick={() => setOpen('add-class')}>Add a class</button> : undefined}>
            Add class levels and their sections to start admitting students.
          </EmptyState>
        </Card>
      )}

      {data && data.grades.length > 0 && (
        <div className="space-y-2.5">
          {data.grades.map((g) => {
            const visible = g.sections.filter((s) => manage || s.mine || school.can('students.view.all'));
            if (!manage && visible.length === 0) return null;
            const strength = g.sections.reduce((s, x) => s + x.strength, 0);
            const subjects = data.subjects.filter((s) => g.subjectIds.includes(s.id));
            return (
              <section key={g.id} className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-stretch sm:p-4">
                <button
                  type="button"
                  disabled={!manage}
                  onClick={() => setOpen({ grade: g })}
                  className="flex shrink-0 items-center justify-between gap-3 text-left sm:w-44 sm:flex-col sm:items-start sm:justify-center sm:border-r sm:border-slate-100 sm:pr-4 enabled:hover:opacity-80"
                >
                  <span>
                    <span className="block text-[1.25rem] font-extrabold leading-tight text-ink-800" style={{ fontStretch: '118%' }}>{classLabel(g.name)}</span>
                    <span className="block text-[0.8125rem] text-slate-500">{plural(strength, 'student')}</span>
                  </span>
                  <span className="truncate text-[0.75rem] text-slate-400">{subjects.length ? `${subjects.length} subjects` : manage ? 'No subjects set' : ''}</span>
                </button>
                <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                  {visible.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setOpen({ section: s, grade: g })}
                      className={`flex flex-col rounded-xl border p-3 text-left transition-colors hover:border-ink-800 ${s.mine && !manage ? 'border-marigold-400 bg-marigold-50' : 'border-slate-200 bg-slate-50/50'}`}
                    >
                      <span className="flex items-baseline justify-between">
                        <span className="text-[1.0625rem] font-extrabold text-ink-800" style={{ fontStretch: '115%' }}>{s.label}</span>
                        <span className="num text-[0.8125rem] font-semibold text-slate-500">{s.strength}{s.capacity ? `/${s.capacity}` : ''}</span>
                      </span>
                      <span className="mt-1 truncate text-[0.8125rem] text-slate-600">{s.classTeacherName ?? <span className="text-slate-400">No class teacher</span>}</span>
                      {s.strength > 0 && (
                        <span className="mt-2 flex h-1 overflow-hidden rounded-full bg-slate-200" title={`${s.girls} girls, ${s.boys} boys`}>
                          <span className="bg-coral-500/70" style={{ width: `${(s.girls / s.strength) * 100}%` }} />
                          <span className="bg-cobalt-400" style={{ width: `${(s.boys / s.strength) * 100}%` }} />
                        </span>
                      )}
                    </button>
                  ))}
                  {manage && <AddSection grade={g} yearId={data.year.id} />}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {data && open && typeof open === 'object' && 'section' in open && <SectionDialog key={open.section.id} data={data} grade={open.grade} section={open.section} onClose={() => setOpen(null)} manage={manage} />}
      {data && open && typeof open === 'object' && !('section' in open) && <GradeDialog key={open.grade.id} data={data} grade={open.grade} onClose={() => setOpen(null)} />}
      {open === 'add-class' && <AddClassDialog onClose={() => setOpen(null)} />}
      {open === 'subjects' && data && <SubjectsDialog data={data} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function useInvalidateStructure() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['structure'] });
    queryClient.invalidateQueries({ queryKey: ['today'] });
  };
}

function AddSection({ grade, yearId }: { grade: Grade; yearId: string }) {
  const toast = useToast();
  const refresh = useInvalidateStructure();
  const next = String.fromCharCode(65 + grade.sections.length);
  const add = useMutation({
    mutationFn: () => api.post('/school/sections', { gradeId: grade.id, name: next, yearId }),
    onSuccess: () => {
      refresh();
      toast(`Added ${grade.name}-${next}`);
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  return (
    <button type="button" onClick={() => add.mutate()} disabled={add.isPending} className="flex min-h-[4.5rem] items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-300 text-[0.8125rem] font-semibold text-slate-500 hover:border-ink-800 hover:text-ink-800">
      {add.isPending ? <Spinner /> : <Icon name="plus" size={15} />} Section {next}
    </button>
  );
}

function SectionDialog({ data, grade, section, onClose, manage }: { data: Structure; grade: Grade; section: Section; onClose: () => void; manage: boolean }) {
  const toast = useToast();
  const refresh = useInvalidateStructure();
  const school = useSchool();
  const [form, setForm] = useState({ classTeacherId: section.classTeacherId ?? '', room: section.room ?? '', capacity: section.capacity ? String(section.capacity) : '' });
  const subjects = data.subjects.filter((s) => grade.subjectIds.includes(s.id));
  const [assign, setAssign] = useState<Record<string, string>>(Object.fromEntries(section.assignments.map((a) => [a.subjectId, a.staffId])));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      await api.patch(`/school/sections/${section.id}`, { classTeacherId: form.classTeacherId || null, room: form.room || null, capacity: form.capacity ? Number(form.capacity) : null });
      if (subjects.length) await api.put(`/school/sections/${section.id}/assignments`, { assignments: subjects.map((s) => ({ subjectId: s.id, staffId: assign[s.id] || null })) });
    },
    onSuccess: () => {
      refresh();
      toast(`Saved ${section.label}`);
      onClose();
    },
  });
  const renumber = useMutation({
    mutationFn: () => api.post(`/school/sections/${section.id}/roll-numbers`, { order: 'alphabetical' }),
    onSuccess: () => toast(`Roll numbers in ${section.label} now run A to Z`),
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/school/sections/${section.id}`),
    onSuccess: () => {
      refresh();
      toast(`Deleted ${section.label}`);
      onClose();
    },
    onError: (e) => {
      setConfirmDelete(false);
      toast(errorMessage(e), 'bad');
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={section.label}
      lead={`${plural(section.strength, 'student')}${section.strength ? `: ${section.girls} girls, ${section.boys} boys` : ''}`}
      wide
      footer={
        manage ? (
          <>
            {section.strength === 0 && (
              <button type="button" className="btn btn-quiet btn-sm mr-auto text-coral-700" onClick={() => setConfirmDelete(true)}>
                Delete section
              </button>
            )}
            <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-ink btn-sm" disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Spinner />} Save
            </button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-5">
        <div className="flex flex-wrap gap-2">
          <Link to={`/app/students?section=${section.id}`} className="btn btn-line btn-sm"><Icon name="students" size={15} /> Class list</Link>
          {school.can('attendance.view', 'attendance.mark.own', 'attendance.mark.all') && (
            <>
              <Link to={`/app/attendance/${section.id}`} className="btn btn-line btn-sm"><Icon name="attendance" size={15} /> Today’s register</Link>
              <Link to={`/app/attendance/${section.id}/month`} className="btn btn-line btn-sm"><Icon name="calendar" size={15} /> Month view</Link>
            </>
          )}
          {school.can('students.edit') && (
            <>
              <Link to={`/app/students/new?section=${section.id}`} className="btn btn-line btn-sm"><Icon name="plus" size={15} /> Admit here</Link>
              <button type="button" className="btn btn-line btn-sm" onClick={() => renumber.mutate()} disabled={renumber.isPending || section.strength === 0}>
                {renumber.isPending ? <Spinner /> : <Icon name="refresh" size={15} />} Roll numbers A to Z
              </button>
            </>
          )}
        </div>

        {manage ? (
          <>
            <FormError message={save.error ? errorMessage(save.error) : null} />
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Class teacher" value={form.classTeacherId} onChange={(e) => setForm({ ...form, classTeacherId: e.target.value })}>
                <option value="">None</option>
                {data.staff.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </SelectField>
              <Field id="room" label="Room" value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="Optional" />
              <Field id="cap" label="Seats" inputMode="numeric" value={form.capacity} onChange={(e) => setForm({ ...form, capacity: e.target.value.replace(/\D/g, '') })} placeholder="Optional" />
            </div>
            <div>
              <h3 className="mb-2">Who teaches what</h3>
              {subjects.length === 0 ? (
                <p className="text-[0.875rem] text-slate-500">Choose the subjects {classLabel(grade.name)} studies first (click the class name).</p>
              ) : (
                <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
                  {subjects.map((s) => (
                    <label key={s.id} className="flex items-center gap-3">
                      <span className="w-32 shrink-0 truncate text-[0.875rem] font-semibold text-ink-800">{s.name}</span>
                      <select className="input input-sm" value={assign[s.id] ?? ''} onChange={(e) => setAssign({ ...assign, [s.id]: e.target.value })}>
                        <option value="">Not assigned</option>
                        {data.staff.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <p className="input-hint">Class teachers and subject teachers can open these students’ records and take this register.</p>
            </div>
          </>
        ) : (
          <dl className="grid gap-3 text-[0.875rem] sm:grid-cols-3">
            <div><dt className="text-slate-500">Class teacher</dt><dd className="m-0 font-semibold text-ink-800">{section.classTeacherName ?? '—'}</dd></div>
            <div><dt className="text-slate-500">Room</dt><dd className="m-0 font-semibold text-ink-800">{section.room ?? '—'}</dd></div>
          </dl>
        )}
      </div>
      <ConfirmDialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title={`Delete ${section.label}?`} confirmLabel="Delete section" danger pending={remove.isPending} onConfirm={() => remove.mutate()}>
        It has no students, so nothing else is affected.
      </ConfirmDialog>
    </Dialog>
  );
}

function GradeDialog({ data, grade, onClose }: { data: Structure; grade: Grade; onClose: () => void }) {
  const toast = useToast();
  const refresh = useInvalidateStructure();
  const [name, setName] = useState(grade.name);
  const [subjectIds, setSubjectIds] = useState<string[]>(grade.subjectIds);
  const save = useMutation({
    mutationFn: async () => {
      if (name !== grade.name) await api.patch(`/school/grades/${grade.id}`, { name });
      await api.put(`/school/grades/${grade.id}/subjects`, { subjectIds });
    },
    onSuccess: () => {
      refresh();
      toast(`Saved ${classLabel(name)}`);
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/school/grades/${grade.id}`),
    onSuccess: () => {
      refresh();
      toast(`Deleted ${classLabel(grade.name)}`);
      onClose();
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title={classLabel(grade.name)}
      footer={
        <>
          <button type="button" className="btn btn-quiet btn-sm mr-auto text-coral-700" onClick={() => remove.mutate()} disabled={remove.isPending}>
            Delete class
          </button>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink btn-sm" onClick={() => save.mutate()} disabled={save.isPending || !name.trim()}>
            {save.isPending && <Spinner />} Save
          </button>
        </>
      }
    >
      <div className="space-y-5">
        <FormError message={save.error ? errorMessage(save.error) : null} />
        <Field id="grade-name" label="Name" value={name} onChange={(e) => setName(e.target.value)} hint="Numbers show as “Class 6”. Names like Nursery or LKG show as they are." />
        <div>
          <p className="input-label">Subjects studied</p>
          {data.subjects.length === 0 ? (
            <p className="text-[0.875rem] text-slate-500">Add subjects first, from the Subjects button.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.subjects.map((s) => {
                const on = subjectIds.includes(s.id);
                return (
                  <button key={s.id} type="button" aria-pressed={on} onClick={() => setSubjectIds(on ? subjectIds.filter((x) => x !== s.id) : [...subjectIds, s.id])} className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-[0.8125rem] font-semibold ${on ? 'border-ink-800 bg-ink-800 text-white' : 'border-slate-300 bg-white text-slate-600'}`}>
                    {on && <Icon name="check" size={13} />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function AddClassDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const refresh = useInvalidateStructure();
  const [name, setName] = useState('');
  const [sections, setSections] = useState('A');
  const add = useMutation({
    mutationFn: () => api.post('/school/grades', { name: name.trim(), sections: sections.split(/[\s,]+/).filter(Boolean) }),
    onSuccess: () => {
      refresh();
      toast(`Added ${classLabel(name.trim())}`);
      onClose();
    },
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Add a class"
      footer={
        <>
          <button type="button" className="btn btn-line btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-ink btn-sm" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
            {add.isPending && <Spinner />} Add class
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <FormError message={add.error ? errorMessage(add.error) : null} />
        <Field id="new-class" label="Class name" value={name} onChange={(e) => setName(e.target.value)} placeholder="11 Science, Pre-nursery, 4" autoFocus />
        <Field id="new-sections" label="Sections" value={sections} onChange={(e) => setSections(e.target.value.toUpperCase())} hint="Separated by commas: A, B, C" />
      </div>
    </Dialog>
  );
}

function SubjectsDialog({ data, onClose }: { data: Structure; onClose: () => void }) {
  const toast = useToast();
  const refresh = useInvalidateStructure();
  const [name, setName] = useState('');
  const add = useMutation({
    mutationFn: () => api.post('/school/subjects', { name: name.trim() }),
    onSuccess: () => {
      refresh();
      setName('');
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/school/subjects/${id}`),
    onSuccess: () => {
      refresh();
      toast('Subject removed');
    },
    onError: (e) => toast(errorMessage(e), 'bad'),
  });
  return (
    <Dialog open onClose={onClose} title="Subjects" lead="The subjects taught across the school. Each class picks its own from this list.">
      <FormError message={add.error ? errorMessage(add.error) : null} />
      <ul className="flex flex-wrap gap-1.5">
        {data.subjects.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-1 pl-3 pr-1 text-[0.875rem] font-semibold text-ink-800">
            {s.name}
            <button type="button" aria-label={`Remove ${s.name}`} className="grid size-6 place-items-center rounded-full text-slate-500 hover:bg-coral-100 hover:text-coral-700" onClick={() => remove.mutate(s.id)}>
              <Icon name="x" size={12} />
            </button>
          </li>
        ))}
      </ul>
      <form className="mt-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate(); }}>
        <input className="input input-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a subject" aria-label="Subject name" />
        <button type="submit" className="btn btn-ink btn-sm" disabled={add.isPending}>Add</button>
      </form>
    </Dialog>
  );
}
