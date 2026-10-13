// Bringing a school's existing students in from Excel — the step that decides whether a
// school switches at all. It reads whatever columns the school's sheet already has
// ("Student Name", "Father's Name", "Mobile", "Class" as "6-B"...), matches them up,
// checks every row against the school before anything is saved, and then imports all of
// them in one go or none of them.
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, errorMessage } from '../../lib/api';
import { downloadCsv, parseCsv } from '../../lib/csv';
import { plural } from '../../lib/format';
import { useSchool } from '../../lib/school';
import { Icon } from '../../components/Icon';
import { BackLink, Card, ErrorState, Notice, Page, Spinner } from '../../components/ui';
import { useToast } from '../../lib/toast';

type Target =
  | 'ignore'
  | 'fullName'
  | 'firstName'
  | 'lastName'
  | 'gender'
  | 'dateOfBirth'
  | 'classAndSection'
  | 'className'
  | 'sectionName'
  | 'rollNo'
  | 'admissionNo'
  | 'admittedOn'
  | 'fatherName'
  | 'motherName'
  | 'guardianName'
  | 'guardianRelation'
  | 'guardianPhone'
  | 'guardianEmail'
  | 'address'
  | 'apaarId';

const targets: { value: Target; label: string; match: RegExp }[] = [
  { value: 'fullName', label: 'Full name', match: /^(student'?s?\s*)?(full\s*)?name$|^name of (the )?student/i },
  { value: 'firstName', label: 'First name', match: /first\s*name|given/i },
  { value: 'lastName', label: 'Last name', match: /last\s*name|surname/i },
  { value: 'gender', label: 'Gender', match: /gender|sex|boy.*girl/i },
  { value: 'dateOfBirth', label: 'Date of birth', match: /dob|birth/i },
  { value: 'classAndSection', label: 'Class and section together (6-B)', match: /^class\s*(&|and|\/|-)?\s*sec(tion)?$|^class$|^std$|^standard$/i },
  { value: 'className', label: 'Class', match: /^class\s*(name)?$|grade/i },
  { value: 'sectionName', label: 'Section', match: /^sec(tion)?$|division|^div$/i },
  { value: 'rollNo', label: 'Roll number', match: /roll/i },
  { value: 'admissionNo', label: 'Admission number', match: /adm(ission)?\.?\s*(no|number|#)|^sr\.?\s*no|registration|scholar|student\s*id/i },
  { value: 'admittedOn', label: 'Admission date', match: /adm(ission)?\s*date|date of adm|doa/i },
  { value: 'fatherName', label: 'Father’s name', match: /father/i },
  { value: 'motherName', label: 'Mother’s name', match: /mother/i },
  { value: 'guardianName', label: 'Guardian’s name', match: /guardian|parent'?s? name/i },
  { value: 'guardianRelation', label: 'Guardian’s relation (father, mother…)', match: /relation/i },
  { value: 'guardianPhone', label: 'Guardian’s mobile', match: /mobile|phone|contact|whatsapp/i },
  { value: 'guardianEmail', label: 'Guardian’s email', match: /e-?mail/i },
  { value: 'address', label: 'Address', match: /address|residence/i },
  { value: 'apaarId', label: 'APAAR ID', match: /apaar/i },
];

type ImportResult = {
  valid: number;
  errors: { row: number; field: string; message: string }[];
  /** Each class-and-section the sheet names that the school does not have, once, with how many rows use it. */
  missing: { className: string; sectionName: string; rows: number; classExists: boolean }[];
};

/** Turns "14/01/2015", "14-1-15", "2015-01-14" or "14.01.2015" into 2015-01-14. */
function toIsoDate(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (!m) return v; // let the server say what is wrong with it
  let year = Number(m[3]);
  if (year < 100) year += year > 50 ? 1900 : 2000;
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

/**
 * "6-B", "6B", "6 B" and "Class 6 B" are class 6, section B. A word on its own — "Nursery",
 * "UKG" — is a class, so its last letter is not a section; and a trailing letter only counts as
 * a section when it follows a separator or a digit.
 */
function splitClass(value: string): { className: string; sectionName: string } {
  const v = value.trim().replace(/^class\s+/i, '');
  const m = v.match(/^(.+?)(?:\s*[-/]\s*|\s+|(?<=\d))([A-Za-z])$/);
  if (m) return { className: m[1].trim(), sectionName: m[2].toUpperCase() };
  return { className: v, sectionName: '' };
}

const template = [
  ['First name', 'Last name', 'Gender', 'Date of birth', 'Class', 'Section', 'Roll no.', 'Admission no.', "Father's name", "Mother's name", 'Mobile', 'Email', 'Address', 'APAAR ID'],
  ['Aarav', 'Sharma', 'Boy', '14/01/2015', '6', 'B', '23', '', 'Rajesh Sharma', 'Neha Sharma', '9876543210', '', '12 Civil Lines, Kanpur', ''],
];

export function ImportStudents() {
  const school = useSchool();
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<string[][] | null>(null);
  const [mapping, setMapping] = useState<Target[]>([]);
  const [readError, setReadError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Whether classes and sections the sheet names, and the school lacks, should be added.
  const [createMissing, setCreateMissing] = useState(false);

  const headers = table?.[0] ?? [];
  const body = useMemo(() => table?.slice(1) ?? [], [table]);

  const rows = useMemo(
    () =>
      body.map((cells) => {
        const r: Record<string, string | number | null> = {};
        mapping.forEach((target, i) => {
          const value = (cells[i] ?? '').trim();
          if (target === 'ignore' || !value) return;
          if (target === 'fullName') {
            const parts = value.split(/\s+/);
            r.firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : value;
            if (parts.length > 1) r.lastName = parts[parts.length - 1];
          } else if (target === 'classAndSection') {
            const { className, sectionName } = splitClass(value);
            r.className = className;
            if (sectionName) r.sectionName = sectionName;
          } else if (target === 'dateOfBirth' || target === 'admittedOn') {
            r[target] = toIsoDate(value);
          } else if (target === 'className') {
            r.className = value.replace(/^class\s+/i, '');
          } else if (target === 'rollNo') {
            r.rollNo = Number(value.replace(/\D/g, '')) || null;
          } else {
            r[target] = value;
          }
        });
        if (!r.guardianName) {
          if (r.fatherName) {
            r.guardianName = r.fatherName;
            r.guardianRelation = 'father';
          } else if (r.motherName) {
            r.guardianName = r.motherName;
            r.guardianRelation = 'mother';
          }
        }
        delete r.fatherName;
        delete r.motherName;
        return r;
      }),
    [body, mapping],
  );

  const check = useMutation({
    mutationFn: (v: { dryRun: boolean; createMissing: boolean }) => api.post<ImportResult & { imported: number }>('/school/students/import', { rows, ...v }),
    onSuccess: (res, v) => {
      setResult(res);
      if (!v.dryRun && res.imported > 0) {
        queryClient.invalidateQueries();
        toast(`Imported ${plural(res.imported, 'student')}`);
        navigate('/app/students', { replace: true });
      }
    },
  });

  async function readFile(file: File) {
    setReadError(null);
    setResult(null);
    setCreateMissing(false);
    if (/\.xlsx?$/i.test(file.name)) {
      setReadError('That is an Excel workbook. In Excel, choose File → Save a copy → CSV UTF-8, then pick that file here.');
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setReadError('That file has no rows under its header row.');
      return;
    }
    setFileName(file.name);
    setTable(parsed);
    // Guess each column from its header; a header can only claim a target once, and a sheet has
    // one class column — a later "Grade" (an exam result, in many sheets) must not replace it.
    const used = new Set<Target>();
    const classTargets: Target[] = ['className', 'classAndSection'];
    setMapping(
      parsed[0].map((h) => {
        const hit = targets.find(
          (t) => !used.has(t.value) && !(classTargets.includes(t.value) && classTargets.some((c) => used.has(c))) && t.match.test(h.trim()),
        );
        if (hit) used.add(hit.value);
        return hit?.value ?? 'ignore';
      }),
    );
  }

  const mapped = new Set(mapping);
  const missing = [
    !mapped.has('firstName') && !mapped.has('fullName') ? 'the student’s name' : null,
    !mapped.has('className') && !mapped.has('classAndSection') ? 'the class' : null,
    !mapped.has('sectionName') && !mapped.has('classAndSection') ? 'the section' : null,
    !mapped.has('guardianName') && !mapped.has('fatherName') && !mapped.has('motherName') ? 'a parent or guardian’s name' : null,
  ].filter(Boolean);

  const newClasses = (result?.missing ?? []).filter((m, i, all) => !m.classExists && all.findIndex((o) => o.className.toLowerCase() === m.className.toLowerCase()) === i).length;

  const errorsByRow = new Map<number, string[]>();
  for (const e of result?.errors ?? []) errorsByRow.set(e.row, [...(errorsByRow.get(e.row) ?? []), e.message]);

  return (
    <Page title="Import students" lead={`From an Excel or Google Sheets file, into ${school.currentYear?.name ?? 'this year'}.`} back={<BackLink to="/app/students">Students</BackLink>}>
      {!table && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <Card>
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center hover:border-ink-800">
              <span className="grid size-12 place-items-center rounded-2xl bg-lagoon-100 text-lagoon-700">
                <Icon name="upload" size={22} />
              </span>
              <span className="mt-4 text-[1.0625rem] font-bold text-ink-800" style={{ fontStretch: '112%' }}>Choose a CSV file</span>
              <span className="mt-1 text-[0.875rem] text-slate-500">Your own columns are fine — you will match them up next.</span>
              <input type="file" accept=".csv,text/csv,.xlsx,.xls" className="sr-only" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
            </label>
            {readError && <div className="mt-4"><ErrorState error={new Error(readError)} /></div>}
          </Card>
          <Card title="Before you start">
            <ol className="space-y-3 text-[0.875rem] text-slate-600">
              <li className="flex gap-3"><Step n={1} />Make sure every class and section in the sheet exists in <Link className="link" to="/app/classes">Classes</Link>.</li>
              <li className="flex gap-3"><Step n={2} />In Excel, save the sheet with File → Save a copy → CSV UTF-8. In Google Sheets, File → Download → CSV.</li>
              <li className="flex gap-3"><Step n={3} />Students with the same mobile number are linked as one family.</li>
            </ol>
            <button type="button" className="btn btn-line btn-sm mt-5" onClick={() => downloadCsv('acadlas-students-template.csv', template)}>
              <Icon name="download" size={15} /> Download a template
            </button>
          </Card>
        </div>
      )}

      {table && (
        <div className="space-y-5">
          <Card
            title={<h2 className="text-[1rem]">Match the columns <span className="font-normal text-slate-500">from {fileName}, {plural(body.length, 'row')}</span></h2>}
            action={<button type="button" className="btn btn-quiet btn-sm" onClick={() => { setTable(null); setResult(null); setCreateMissing(false); }}>Choose another file</button>}
          >
            <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
              {headers.map((h, i) => (
                <label key={i} className="block">
                  <span className="mb-1 flex items-baseline justify-between gap-2 text-[0.8125rem]">
                    <span className="truncate font-semibold text-ink-800">{h || `Column ${i + 1}`}</span>
                    <span className="truncate text-[0.75rem] text-slate-400">{body[0]?.[i]}</span>
                  </span>
                  <select
                    className={`input input-sm ${mapping[i] === 'ignore' ? 'text-slate-400' : ''}`}
                    value={mapping[i]}
                    onChange={(e) => {
                      setResult(null);
                      setMapping(mapping.map((m, j) => (j === i ? (e.target.value as Target) : m)));
                    }}
                  >
                    <option value="ignore">Leave out</option>
                    {targets.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {missing.length > 0 && <div className="mt-4"><Notice tone="warn">Still needed: {missing.join(', ')}.</Notice></div>}
          </Card>

          <Card title="Preview" pad={false}>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="w-12">Row</th>
                    <th>Student</th>
                    <th>Class</th>
                    <th>Date of birth</th>
                    <th>Guardian</th>
                    <th>Mobile</th>
                    {result && <th>Check</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, result ? 500 : 12).map((r, i) => {
                    const errs = errorsByRow.get(i + 1);
                    if (result && !errs && rows.length > 12 && i >= 12) return null;
                    return (
                      <tr key={i} className={errs ? 'bg-coral-50/60' : ''}>
                        <td className="num text-slate-500">{i + 1}</td>
                        <td className="font-semibold">{[r.firstName, r.lastName].filter(Boolean).join(' ') || <span className="text-coral-700">Missing</span>}</td>
                        <td>{r.className ? `${r.className}-${r.sectionName ?? '?'}` : <span className="text-coral-700">Missing</span>}</td>
                        <td className="num">{r.dateOfBirth ?? '—'}</td>
                        <td>{r.guardianName ?? <span className="text-coral-700">Missing</span>}</td>
                        <td className="num">{r.guardianPhone ?? '—'}</td>
                        {result && <td className="text-[0.8125rem]">{errs ? <span className="text-coral-700">{errs.join(' ')}</span> : <span className="text-lagoon-700">Ready</span>}</td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!result && rows.length > 12 && <p className="border-t border-slate-100 px-5 py-2.5 text-[0.8125rem] text-slate-500">and {rows.length - 12} more rows</p>}
          </Card>

          {result && result.missing.length > 0 && (
            <Card title={<h2 className="text-[1rem]">{createMissing ? 'These will be added to your school' : 'Not in your school yet'}</h2>}>
              <p className="text-[0.875rem] text-slate-600">
                {createMissing
                  ? `Importing will first add ${plural(result.missing.length, 'section')}${newClasses > 0 ? ` and ${plural(newClasses, 'class', 'classes')}` : ''}, then place the students in them.`
                  : `${plural(result.missing.length, 'class-and-section pair')} in your sheet ${result.missing.length === 1 ? 'is' : 'are'} not set up in ${school.currentYear?.name ?? 'this year'}. If the sheet is right, add them here instead of fixing every row.`}
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {result.missing.map((m) => (
                  <li key={`${m.className}|${m.sectionName}`} className="rounded-full bg-slate-100 px-3 py-1 text-[0.8125rem] text-ink-800">
                    <b>{m.className}-{m.sectionName}</b>
                    <span className="text-slate-500"> · {plural(m.rows, 'student')}{m.classExists ? '' : ' · new class'}</span>
                  </li>
                ))}
              </ul>
              {!createMissing && (
                <div className="mt-4">
                  {school.can('school.manage') ? (
                    <button
                      type="button"
                      className="btn btn-line btn-sm"
                      disabled={check.isPending}
                      onClick={() => {
                        setCreateMissing(true);
                        check.mutate({ dryRun: true, createMissing: true });
                      }}
                    >
                      Add these and check again
                    </button>
                  ) : (
                    <Notice tone="warn">Only someone who manages the school can add classes. Ask them, or change the sheet.</Notice>
                  )}
                </div>
              )}
              {createMissing && (
                <button type="button" className="btn btn-quiet btn-sm mt-4" disabled={check.isPending} onClick={() => { setCreateMissing(false); check.mutate({ dryRun: true, createMissing: false }); }}>
                  Don’t add them
                </button>
              )}
            </Card>
          )}

          {check.error && <ErrorState error={new Error(errorMessage(check.error))} />}

          <div className="sticky bottom-20 z-20 flex flex-col gap-3 rounded-2xl bg-ink-800 p-4 text-white shadow-card sm:flex-row sm:items-center lg:bottom-4" data-surface="dark">
            <p className="flex-1 text-[0.9375rem]">
              {!result && 'Check every row against your classes before importing. Nothing is saved yet.'}
              {result && result.errors.length > 0 && (
                <>
                  <b className="text-coral-100">{plural(errorsByRow.size, 'row needs', 'rows need')} fixing</b> in your sheet ({result.valid} ready). Fix them and choose the file again — nothing has been imported.
                </>
              )}
              {result && result.errors.length === 0 && <><b>All {plural(result.valid, 'row')} are ready.</b> Import adds every one of them in one go.</>}
            </p>
            {(!result || result.errors.length > 0) && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={missing.length > 0 || check.isPending} onClick={() => check.mutate({ dryRun: true, createMissing })}>
                {check.isPending && <Spinner />} Check rows
              </button>
            )}
            {result && result.errors.length === 0 && (
              <button type="button" className="btn btn-sun btn-sm" disabled={check.isPending} onClick={() => check.mutate({ dryRun: false, createMissing })}>
                {check.isPending && <Spinner />} Import {plural(result.valid, 'student')}
              </button>
            )}
          </div>
        </div>
      )}
    </Page>
  );
}

function Step({ n }: { n: number }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink-800 text-[0.75rem] font-bold text-white">{n}</span>;
}
