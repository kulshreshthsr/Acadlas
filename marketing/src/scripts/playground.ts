// The "Try it" prototype: attendance, fee payment and admission, running entirely in the browser
// on made-up sample data. Nothing is stored or sent, so none of it survives a reload, and every
// result it shows is labelled as a sample.

const rupees = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Counts a displayed rupee figure from its previous value to the next.
function countTo(el: HTMLElement, from: number, to: number) {
  if (reduceMotion() || from === to) {
    el.textContent = rupees.format(to);
    return;
  }
  const start = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - start) / 700);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = rupees.format(Math.round(from + (to - from) * eased));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------------------
// Tabs (WAI-ARIA tabs pattern with automatic activation)
// ---------------------------------------------------------------------------------------
function mountTabs(root: HTMLElement) {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const select = (tab: HTMLButtonElement, focus = false) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls')!);
      if (panel) panel.hidden = !on;
      if (on && panel && !reduceMotion()) {
        panel.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], {
          duration: 380,
          easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
        });
      }
    }
    if (focus) tab.focus();
  };

  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
      if (event.key in keys) {
        event.preventDefault();
        select(tabs[(i + keys[event.key] + tabs.length) % tabs.length], true);
      } else if (event.key === 'Home') {
        event.preventDefault();
        select(tabs[0], true);
      } else if (event.key === 'End') {
        event.preventDefault();
        select(tabs[tabs.length - 1], true);
      }
    });
  });
}

// ---------------------------------------------------------------------------------------
// Attendance
// ---------------------------------------------------------------------------------------
type Status = 'present' | 'absent' | 'late';
const nextStatus: Record<Status, Status> = { present: 'absent', absent: 'late', late: 'present' };
const statusLabel: Record<Status, string> = { present: 'Present', absent: 'Absent', late: 'Late' };

function mountAttendance(panel: HTMLElement) {
  const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[data-att-student]')];
  const open = panel.querySelector<HTMLElement>('[data-att-open]')!;
  const done = panel.querySelector<HTMLElement>('[data-att-done]')!;
  const live = panel.querySelector<HTMLElement>('[data-att-live]')!;
  const summary = panel.querySelector<HTMLElement>('[data-att-summary]')!;
  const list = panel.querySelector<HTMLElement>('[data-att-list]')!;

  const nameOf = (b: HTMLButtonElement) => b.querySelector('.truncate')?.textContent?.trim() ?? '';

  const apply = (b: HTMLButtonElement, status: Status) => {
    b.dataset.status = status;
    b.querySelector<HTMLElement>('[data-att-label]')!.textContent = statusLabel[status];
    b.setAttribute('aria-label', `${nameOf(b)}, ${statusLabel[status].toLowerCase()}. Activate to change.`);
  };

  const refresh = () => {
    const counts: Record<Status, number> = { present: 0, absent: 0, late: 0 };
    buttons.forEach((b) => counts[b.dataset.status as Status]++);
    (Object.keys(counts) as Status[]).forEach((k) => {
      panel.querySelector<HTMLElement>(`[data-att-count="${k}"]`)!.textContent = String(counts[k]);
      panel.querySelector<HTMLElement>(`[data-att-bar="${k}"]`)!.style.width = `${(counts[k] / buttons.length) * 100}%`;
    });
    return counts;
  };

  const setLocked = (locked: boolean) => buttons.forEach((b) => (b.disabled = locked));

  buttons.forEach((b) => {
    apply(b, 'present');
    b.addEventListener('click', () => {
      const status = nextStatus[b.dataset.status as Status];
      apply(b, status);
      refresh();
      live.textContent = `${nameOf(b)} marked ${statusLabel[status].toLowerCase()}.`;
    });
  });

  panel.querySelector('[data-att-all]')!.addEventListener('click', () => {
    buttons.forEach((b) => apply(b, 'present'));
    refresh();
    live.textContent = 'Everyone marked present.';
  });

  panel.querySelector('[data-att-submit]')!.addEventListener('click', () => {
    const counts = refresh();
    const marked = buttons.filter((b) => b.dataset.status !== 'present');
    summary.textContent = `${counts.present + counts.late} of ${buttons.length} in class in this sample register. Nothing was saved. In Acadlas School, ${
      marked.length ? 'these marks would be added to each student’s own record:' : 'full attendance would be recorded for the class.'
    }`;
    list.replaceChildren(
      ...marked.map((b) => {
        const li = el('li', 'flex items-center justify-between gap-3 rounded-lg bg-white/5 px-3 py-2');
        li.append(el('span', 'text-white', nameOf(b)));
        const s = b.dataset.status as Status;
        li.append(el('span', s === 'absent' ? 'font-semibold text-coral-100' : 'font-semibold text-marigold-300', statusLabel[s]));
        return li;
      }),
    );
    open.hidden = true;
    open.classList.add('hidden');
    done.classList.remove('hidden');
    setLocked(true);
    live.textContent = 'Register submitted.';
  });

  panel.querySelector('[data-att-edit]')!.addEventListener('click', () => {
    done.classList.add('hidden');
    open.classList.remove('hidden');
    open.hidden = false;
    setLocked(false);
    buttons[0]?.focus();
  });

  refresh();
}

// ---------------------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------------------
type Instalment = { name: string; amount: number; paid: number; due: string };
const startingPlan = (): Instalment[] => [
  { name: 'Admission and annual charges', amount: 6500, paid: 6500, due: 'April' },
  { name: 'Term 1', amount: 6500, paid: 6500, due: '15 July' },
  { name: 'Term 2', amount: 6500, paid: 0, due: '15 November' },
  { name: 'Term 3', amount: 6500, paid: 0, due: '15 February' },
];

function mountFees(panel: HTMLElement) {
  const rows = panel.querySelector<HTMLElement>('[data-fee-rows]')!;
  const dueEl = panel.querySelector<HTMLElement>('[data-fee-due]')!;
  const paidEl = panel.querySelector<HTMLElement>('[data-fee-paid]')!;
  const bar = panel.querySelector<HTMLElement>('[data-fee-bar]')!;
  const form = panel.querySelector<HTMLFormElement>('[data-fee-form]')!;
  const error = panel.querySelector<HTMLElement>('[data-fee-error]')!;
  const receipts = panel.querySelector<HTMLElement>('[data-fee-receipts]')!;
  const empty = panel.querySelector<HTMLElement>('[data-fee-empty]')!;
  const amountInput = form.elements.namedItem('amount') as HTMLInputElement;

  let plan = startingPlan();
  let receiptNo = 1188;
  const total = () => plan.reduce((s, i) => s + i.amount, 0);
  const paid = () => plan.reduce((s, i) => s + i.paid, 0);

  const render = (prevDue?: number, prevPaid?: number, changed: number[] = []) => {
    rows.replaceChildren(
      ...plan.map((inst, idx) => {
        const tr = el('tr', changed.includes(idx) ? 'bg-lagoon-50 transition-colors duration-1000' : '');
        const name = el('td', 'py-3 pr-3 font-medium text-ink-800', inst.name);
        const amount = el('td', 'py-3 pr-3 text-slate-600', rupees.format(inst.amount));
        const statusCell = el('td', 'py-3 text-right');
        let label = `Due ${inst.due}`;
        let tone = 'bg-marigold-100 text-marigold-700';
        if (inst.paid >= inst.amount) {
          label = 'Paid';
          tone = 'bg-lagoon-100 text-lagoon-700';
        } else if (inst.paid > 0) {
          label = `${rupees.format(inst.amount - inst.paid)} left`;
          tone = 'bg-cobalt-100 text-cobalt-600';
        }
        statusCell.append(el('span', `inline-block whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${tone}`, label));
        tr.append(name, amount, statusCell);
        if (changed.includes(idx)) setTimeout(() => tr.classList.remove('bg-lagoon-50'), 1400);
        return tr;
      }),
    );
    const due = total() - paid();
    countTo(dueEl, prevDue ?? due, due);
    countTo(paidEl, prevPaid ?? paid(), paid());
    bar.style.width = `${(paid() / total()) * 100}%`;
    amountInput.max = String(due);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const due = total() - paid();
    const amount = Math.round(Number(amountInput.value));
    const method = (form.elements.namedItem('method') as RadioNodeList).value;

    if (due === 0) {
      error.textContent = 'Nothing is due. Choose Start over to try again.';
      return;
    }
    if (!amount || amount < 1 || amount > due) {
      error.textContent = `Enter an amount between ₹1 and ${rupees.format(due)}, the balance still due.`;
      amountInput.focus();
      return;
    }
    error.textContent = '';

    const prevDue = due;
    const prevPaid = paid();
    let left = amount;
    const changed: number[] = [];
    const applied: string[] = [];
    plan.forEach((inst, idx) => {
      if (left <= 0) return;
      const open = inst.amount - inst.paid;
      if (open <= 0) return;
      const take = Math.min(open, left);
      inst.paid += take;
      left -= take;
      changed.push(idx);
      applied.push(inst.name);
    });
    render(prevDue, prevPaid, changed);

    // Issue a receipt that slides into the stack.
    empty.remove();
    const card = el('div', 'receipt-card relative mb-3 rounded-[var(--radius-lg)] border-t-4 border-marigold-500 bg-white p-4 shadow-lift ring-1 ring-slate-200');
    const top = el('div', 'flex items-start justify-between gap-3');
    const left1 = el('div');
    left1.append(el('p', 'text-xs font-semibold text-slate-500', `Sample receipt ${receiptNo}`));
    left1.append(el('p', 'text-2xl font-bold text-ink-800 [font-stretch:115%]', rupees.format(amount)));
    top.append(left1, el('span', 'rounded-full bg-lagoon-100 px-2.5 py-1 text-xs font-bold text-lagoon-700', method));
    card.append(top);
    card.append(el('p', 'mt-2 border-t border-dashed border-slate-200 pt-2 text-sm text-slate-600', `Aarav Sharma, Class 6-B. Towards ${applied.join(' and ')}. Demo only, no real payment.`));
    receipts.prepend(card);
    if (!reduceMotion()) {
      card.animate(
        [
          { transform: 'translateY(-40px) scale(0.96)', opacity: 0 },
          { transform: 'none', opacity: 1 },
        ],
        { duration: 520, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      );
    }
    receiptNo++;
    const remaining = total() - paid();
    amountInput.value = String(Math.min(6500, remaining) || '');
  });

  amountInput.addEventListener('input', () => (error.textContent = ''));

  panel.querySelector('[data-fee-reset]')!.addEventListener('click', () => {
    const prevDue = total() - paid();
    const prevPaid = paid();
    plan = startingPlan();
    receiptNo = 1188;
    receipts.replaceChildren(empty);
    amountInput.value = '6500';
    error.textContent = '';
    render(prevDue, prevPaid);
  });

  render();
}

// ---------------------------------------------------------------------------------------
// Admission
// ---------------------------------------------------------------------------------------
function mountAdmission(panel: HTMLElement) {
  const form = panel.querySelector<HTMLFormElement>('[data-admit-form]')!;
  const out = panel.querySelector<HTMLElement>('[data-admit-out]')!;
  const empty = panel.querySelector<HTMLElement>('[data-admit-empty]')!;
  const error = panel.querySelector<HTMLElement>('[data-admit-error]')!;
  let admissionNo = 419;

  const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value.trim();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const student = field('student');
    const guardian = field('guardian');
    if (!student) {
      error.textContent = "Enter the student's name to admit them.";
      (form.elements.namedItem('student') as HTMLInputElement).focus();
      return;
    }
    if (!guardian) {
      error.textContent = "Enter a guardian's name. Every student needs at least one.";
      (form.elements.namedItem('guardian') as HTMLInputElement).focus();
      return;
    }
    error.textContent = '';

    const klass = field('klass');
    const section = field('section');
    const relation = field('relation');
    const roll = 28 + ((student.length * 7 + section.charCodeAt(0)) % 9);
    const initials = student
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('');
    const no = `2026/${String(admissionNo).padStart(4, '0')}`;
    admissionNo++;

    const card = el('div', 'relative');
    card.append(el('p', 'mb-3 inline-flex rounded-full bg-marigold-500 px-3 py-1 text-xs font-bold text-night', 'Sample record, not saved'));
    const head = el('div', 'flex items-center gap-3 rounded-2xl bg-white p-3.5');
    head.append(el('span', 'grid size-12 shrink-0 place-items-center rounded-2xl bg-marigold-500 font-extrabold text-night [font-stretch:115%]', initials));
    const who = el('div', 'min-w-0');
    who.append(el('p', 'truncate text-lg font-bold text-ink-800 [font-stretch:115%]', student));
    who.append(el('p', 'text-sm text-slate-600', `Class ${klass}-${section}, roll no. ${roll}`));
    head.append(who);
    card.append(head);

    const links: [string, string][] = [
      ['Admission', `Sample no. ${no}`],
      ['Guardian', `${guardian}, ${relation.toLowerCase()}`],
      ['Class', `${klass}-${section} class list, roll no. ${roll}`],
      ['Fee plan', `Class ${klass}, quarterly instalments`],
      ['Attendance', `Linked to the ${klass}-${section} register`],
    ];
    const ul = el('ul', 'mt-3 space-y-2 border-l-2 border-dashed border-lagoon-400/40 pl-4');
    links.forEach(([k, v], i) => {
      const li = el('li', 'relative flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3.5 py-2.5 text-sm ring-1 ring-white/10');
      const dot = el('span', 'absolute -left-[1.4rem] top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-lagoon-400');
      li.append(dot, el('span', 'text-slate-400', k), el('span', 'text-right font-semibold text-white', v));
      if (!reduceMotion()) {
        li.animate(
          [
            { opacity: 0, transform: 'translateX(-12px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 420, delay: 250 + i * 140, fill: 'backwards', easing: 'cubic-bezier(0.2, 0.7, 0.2, 1)' },
        );
      }
      ul.append(li);
    });
    card.append(ul);

    const again = el('button', 'btn btn-ghost mt-5 w-full', 'Admit another student');
    again.type = 'button';
    again.addEventListener('click', () => {
      out.replaceChildren(empty);
      form.reset();
      (form.elements.namedItem('student') as HTMLInputElement).value = '';
      (form.elements.namedItem('guardian') as HTMLInputElement).value = '';
      (form.elements.namedItem('student') as HTMLInputElement).focus();
    });
    card.append(again);

    out.replaceChildren(card);
    if (!reduceMotion()) {
      head.animate(
        [
          { opacity: 0, transform: 'scale(0.9)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 480, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      );
    }
  });

  form.addEventListener('input', () => (error.textContent = ''));
}

export function mountPlayground(root: HTMLElement) {
  mountTabs(root);
  const attendance = root.querySelector<HTMLElement>('[data-panel="attendance"]');
  const fees = root.querySelector<HTMLElement>('[data-panel="fees"]');
  const admit = root.querySelector<HTMLElement>('[data-panel="admit"]');
  if (attendance) mountAttendance(attendance);
  if (fees) mountFees(fees);
  if (admit) mountAdmission(admit);
}
