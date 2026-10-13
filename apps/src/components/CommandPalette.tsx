// One box for everything: a student by name, admission number or a guardian's phone
// number (how parents actually identify themselves at the counter), a receipt number, a
// colleague — and the day's common jobs. Opens with "/" or Ctrl+K from anywhere.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { money, phone } from '../lib/format';
import { useSchool } from '../lib/school';
import type { Permission } from '../lib/school';
import type { IconName } from '../lib/icons';
import { Icon } from './Icon';
import { Avatar } from './ui';

type SearchResult = {
  students: { id: string; name: string; admissionNo: string; classLabel: string | null; status: string; guardianPhone: string | null }[];
  receipts: { id: string; receiptNo: string; amount: number; paidOn: string; status: string; studentName: string }[];
  staff: { id: string; name: string; designation: string | null }[];
};

type Item = { key: string; label: string; detail?: string; icon?: IconName; avatar?: string; to: string };

const actions: (Item & { anyOf: Permission[] })[] = [
  { key: 'a-admit', label: 'Admit a student', icon: 'admission', to: '/app/students/new', anyOf: ['students.edit'] },
  { key: 'a-att', label: 'Take attendance', icon: 'attendance', to: '/app/attendance', anyOf: ['attendance.mark.all', 'attendance.mark.own'] },
  { key: 'a-fee', label: 'Collect a fee', icon: 'fees', to: '/app/fees/collect', anyOf: ['fees.collect'] },
  { key: 'a-dues', label: 'Fees due', icon: 'alert', to: '/app/fees/dues', anyOf: ['fees.view'] },
  { key: 'a-staff', label: 'Add a staff member', icon: 'staff', to: '/app/staff?add=1', anyOf: ['staff.manage'] },
  { key: 'a-import', label: 'Import students from a spreadsheet', icon: 'upload', to: '/app/students/import', anyOf: ['students.edit'] },
  { key: 'a-reports', label: 'Reports', icon: 'reports', to: '/app/reports', anyOf: ['reports.academic', 'reports.fees'] },
  { key: 'a-settings', label: 'School settings', icon: 'settings', to: '/app/settings', anyOf: ['school.manage'] },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const school = useSchool();
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setQ('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(id);
  }, [q]);

  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api.get<SearchResult>(`/school/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
    placeholderData: (prev) => prev,
  });

  const items = useMemo<Item[]>(() => {
    const term = q.trim().toLowerCase();
    const shortcuts = actions.filter((a) => school.can(...a.anyOf) && (!term || a.label.toLowerCase().includes(term)));
    if (debounced.length < 2 || !search.data) return shortcuts;
    const r = search.data;
    return [
      ...r.students.map((s) => ({
        key: `s-${s.id}`,
        label: s.name,
        detail: [s.classLabel ?? (s.status !== 'active' ? 'Left' : 'No class'), s.admissionNo, s.guardianPhone ? phone(s.guardianPhone) : null].filter(Boolean).join(', '),
        avatar: s.name,
        to: `/app/students/${s.id}`,
      })),
      ...r.receipts.map((p) => ({
        key: `r-${p.id}`,
        label: `Receipt ${p.receiptNo}`,
        detail: `${p.studentName}, ${money(p.amount)}${p.status === 'cancelled' ? ' — cancelled' : ''}`,
        icon: 'receipt' as IconName,
        to: `/app/fees/receipts/${p.id}`,
      })),
      ...r.staff.map((p) => ({ key: `t-${p.id}`, label: p.name, detail: p.designation ?? 'Staff', icon: 'user' as IconName, to: `/app/staff#${p.id}` })),
      ...shortcuts,
    ];
  }, [q, debounced, search.data, school]);

  function go(item: Item) {
    onClose();
    navigate(item.to);
  }

  return (
    <dialog
      ref={dialogRef}
      className="dialog !mt-[12svh] max-sm:!mt-auto"
      aria-label="Find anything"
      onClose={onClose}
      onClick={(e) => e.target === dialogRef.current && onClose()}
    >
      <div className="flex items-center gap-3 border-b border-slate-100 px-4">
        <Icon name="search" size={19} className="shrink-0 text-slate-400" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              go(items[active]);
            }
          }}
          placeholder="Name, admission no., parent’s phone or receipt no."
          className="min-h-14 w-full bg-transparent text-[1rem] font-medium text-ink-800 outline-none placeholder:text-slate-400"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[active] ? `palette-${items[active].key}` : undefined}
        />
        {search.isFetching && <span className="size-2 shrink-0 animate-pulse rounded-full bg-marigold-500" aria-hidden="true" />}
      </div>

      <ul id="palette-list" role="listbox" className="max-h-[min(26rem,60svh)] overflow-y-auto p-2">
        {debounced.length >= 2 && search.data && items.length === 0 && (
          <li className="px-3 py-8 text-center text-[0.875rem] text-slate-500">Nothing in this school matches “{debounced}”.</li>
        )}
        {items.map((item, index) => (
          <li
            key={item.key}
            id={`palette-${item.key}`}
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => setActive(index)}
            onClick={() => go(item)}
            className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 ${index === active ? 'bg-slate-100' : ''}`}
          >
            {item.avatar ? (
              <Avatar name={item.avatar} size={32} />
            ) : (
              <span className="grid size-8 place-items-center rounded-xl bg-slate-100 text-slate-600">
                <Icon name={item.icon ?? 'arrow-right'} size={16} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[0.9375rem] font-semibold text-ink-800">{item.label}</span>
              {item.detail && <span className="block truncate text-[0.8125rem] text-slate-500">{item.detail}</span>}
            </span>
            {index === active && <Icon name="arrow-right" size={15} className="text-slate-400" />}
          </li>
        ))}
      </ul>
    </dialog>
  );
}
