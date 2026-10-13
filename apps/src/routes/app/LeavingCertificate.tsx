// The two certificates every school office prints most: a bonafide certificate for a
// current student (bank accounts, scholarships, passports) and a leaving certificate for
// one who has left. Filled from the record; a few lines stay editable before printing.
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { date, todayISO } from '../../lib/format';
import { useSchool } from '../../lib/school';
import { Icon } from '../../components/Icon';
import { BackLink, ErrorState, Loading, Page } from '../../components/ui';

type Profile = { name: string; address: string | null; city: string | null; state: string | null; pincode: string | null; phone: string | null; email: string | null; affiliationNo: string | null; udiseCode: string | null; board: string | null; principalName: string | null };

type Rec = {
  student: { id: string; name: string; admissionNo: string; dateOfBirth: string | null; gender: string | null; admittedOn: string; status: string; leftOn: string | null; leftReason: string | null; apaarId: string | null; pen: string | null; category: string | null };
  guardians: { name: string; relation: string }[];
  current: { label: string; yearName: string } | null;
  history: { label: string; yearName: string }[];
  fees: { balance: number } | null;
};

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ordinal = (n: number) => {
  const words = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth', 'twentieth', 'twenty-first', 'twenty-second', 'twenty-third', 'twenty-fourth', 'twenty-fifth', 'twenty-sixth', 'twenty-seventh', 'twenty-eighth', 'twenty-ninth', 'thirtieth', 'thirty-first'];
  return words[n];
};
const yearWords = (y: number) => {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const two = (n: number) => (n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? `-${ones[n % 10]}` : ''));
  return y >= 2000 ? `two thousand${y % 100 ? ` ${two(y % 100)}` : ''}` : `nineteen hundred${y % 100 ? ` ${two(y % 100)}` : ''}`;
};
/** "Fourteenth January, two thousand fifteen" — Indian certificates give the birth date in words too. */
function dateInWords(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const s = `${ordinal(d)} ${months[m - 1]}, ${yearWords(y)}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function LeavingCertificate() {
  const { id = '' } = useParams();
  const school = useSchool();
  const rec = useQuery({ queryKey: ['student', id], queryFn: () => api.get<Rec>(`/school/students/${id}`) });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.get<Profile>('/school/profile') });
  const [conduct, setConduct] = useState('Good');
  const [remarks, setRemarks] = useState('');
  const [serial, setSerial] = useState('');

  if (rec.isPending || profile.isPending) return <Page title="Certificate"><Loading /></Page>;
  if (rec.error || profile.error || !rec.data || !profile.data) return <Page title="Certificate"><ErrorState error={rec.error ?? profile.error} /></Page>;

  const s = rec.data.student;
  const p = profile.data;
  const leaving = s.status !== 'active';
  const parent = rec.data.guardians.find((g) => g.relation === 'father') ?? rec.data.guardians[0];
  const mother = rec.data.guardians.find((g) => g.relation === 'mother');
  const lastClass = rec.data.current?.label ?? rec.data.history[0]?.label ?? '—';
  const ward = s.gender === 'female' ? 'daughter' : s.gender === 'male' ? 'son' : 'ward';
  const pronoun = s.gender === 'female' ? 'She' : s.gender === 'male' ? 'He' : 'They';

  const rows: [string, string][] = leaving
    ? [
        ['Name of student', s.name],
        ["Father's / guardian's name", parent?.name ?? '—'],
        ["Mother's name", mother?.name ?? '—'],
        ['Date of birth (in figures)', date(s.dateOfBirth)],
        ['Date of birth (in words)', s.dateOfBirth ? dateInWords(s.dateOfBirth) : '—'],
        ['Nationality', 'Indian'],
        ['Admission number', s.admissionNo],
        ['Date of admission', date(s.admittedOn)],
        ['Class in which last studied', lastClass],
        ['Date of leaving', date(s.leftOn)],
        ['Reason for leaving', s.leftReason ?? '—'],
        ['All dues paid', rec.data.fees ? (rec.data.fees.balance > 0 ? 'No' : 'Yes') : '—'],
        ['APAAR ID / PEN', [s.apaarId, s.pen].filter(Boolean).join(' / ') || '—'],
      ]
    : [];

  return (
    <Page
      title={leaving ? 'Leaving certificate' : 'Bonafide certificate'}
      lead="Check the details, fill in what is left, then print on the school’s letterhead or plain paper."
      back={<BackLink to={`/app/students/${s.id}`}>{s.name}</BackLink>}
      actions={
        <button type="button" className="btn btn-sun btn-sm" onClick={() => window.print()}>
          <Icon name="printer" size={16} /> Print
        </button>
      }
    >
      <div className="no-print mb-5 grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="input-label">Certificate number</span>
          <input className="input input-sm" value={serial} onChange={(e) => setSerial(e.target.value)} placeholder="Optional" />
        </label>
        {leaving && (
          <label className="block">
            <span className="input-label">Conduct</span>
            <input className="input input-sm" value={conduct} onChange={(e) => setConduct(e.target.value)} />
          </label>
        )}
        <label className="block">
          <span className="input-label">Remarks</span>
          <input className="input input-sm" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" />
        </label>
      </div>

      <article className="print-plain mx-auto max-w-[48rem] bg-white px-6 py-8 text-[0.9375rem] leading-relaxed text-ink-800 shadow-lift ring-1 ring-slate-200 sm:px-12 sm:py-12">
        <header className="border-b-2 border-ink-800 pb-4 text-center">
          <h2 className="text-[1.5rem]" style={{ fontStretch: '118%' }}>{p.name}</h2>
          <p className="text-[0.8125rem] text-slate-600">{[p.address, p.city, p.state, p.pincode].filter(Boolean).join(', ')}</p>
          <p className="text-[0.8125rem] text-slate-600">
            {[p.board && `${p.board}`, p.affiliationNo && `Affiliation no. ${p.affiliationNo}`, p.udiseCode && `UDISE ${p.udiseCode}`, p.phone].filter(Boolean).join(', ')}
          </p>
        </header>

        <div className="mt-6 flex justify-between text-[0.8125rem] text-slate-600">
          <span>{serial ? `No. ${serial}` : ''}</span>
          <span>Date: {date(todayISO())}</span>
        </div>

        <h3 className="mt-6 text-center text-[1.25rem] underline decoration-2 underline-offset-4" style={{ fontStretch: '115%' }}>
          {leaving ? 'School Leaving Certificate' : 'Bonafide Certificate'}
        </h3>

        {leaving ? (
          <table className="mt-6 w-full text-[0.9375rem]">
            <tbody>
              {rows.map(([k, v], i) => (
                <tr key={k} className="align-top">
                  <td className="w-8 py-1.5 text-slate-500">{i + 1}.</td>
                  <td className="w-[45%] py-1.5 pr-4">{k}</td>
                  <td className="py-1.5 font-semibold">{v}</td>
                </tr>
              ))}
              <tr className="align-top">
                <td className="py-1.5 text-slate-500">{rows.length + 1}.</td>
                <td className="py-1.5 pr-4">General conduct</td>
                <td className="py-1.5 font-semibold">{conduct}</td>
              </tr>
              {remarks && (
                <tr className="align-top">
                  <td className="py-1.5 text-slate-500">{rows.length + 2}.</td>
                  <td className="py-1.5 pr-4">Remarks</td>
                  <td className="py-1.5 font-semibold">{remarks}</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <p className="mt-8 text-[1rem] leading-loose">
            This is to certify that <b>{s.name}</b>, {ward} of <b>{parent?.name ?? '—'}</b>, is a bonafide student of this school, studying in class{' '}
            <b>{lastClass}</b> in the academic session <b>{rec.data.current?.yearName ?? school.currentYear?.name}</b>. {pronoun} {pronoun === 'They' ? 'were' : 'was'} admitted on{' '}
            <b>{date(s.admittedOn)}</b> under admission number <b>{s.admissionNo}</b>.
            {s.dateOfBirth && (
              <>
                {' '}According to the school’s records, {pronoun === 'They' ? 'their' : s.gender === 'female' ? 'her' : 'his'} date of birth is <b>{date(s.dateOfBirth)}</b> ({dateInWords(s.dateOfBirth)}).
              </>
            )}
            {remarks && <> {remarks}</>}
          </p>
        )}

        <footer className="mt-20 flex justify-between text-[0.875rem]">
          <span className="border-t border-slate-400 pt-1.5">Prepared by</span>
          <span className="border-t border-slate-400 pt-1.5 text-right">
            Principal{p.principalName ? <><br />{p.principalName}</> : null}
          </span>
        </footer>
      </article>
    </Page>
  );
}
