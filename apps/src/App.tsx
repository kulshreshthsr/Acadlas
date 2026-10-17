// Every screen in the product, and who may see it. Signed-out screens load with the app;
// each Acadlas School screen loads the first time it is opened, so a teacher on a slow
// phone connection downloads the register, not the fee plan editor.
import { Suspense, lazy } from 'react';
import type { ComponentType } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { Login } from './routes/Login';
import { SignUp } from './routes/SignUp';
import { CreateSchool } from './routes/CreateSchool';
import { ForgotPassword, ResetPassword } from './routes/PasswordReset';
import { Invite } from './routes/Invite';
import { Checking, RequireAuth, RequireGuest, RequireParent, RouteHome } from './routes/guards';
import { Wordmark } from './components/Wordmark';
import { ContourField } from './components/ContourField';
import { AppShell, RequirePermission } from './components/AppShell';
import type { Permission } from './lib/school';

/** React.lazy for a named export. */
function page<T>(load: () => Promise<T>, name: keyof T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return lazy(() => load().then((m) => ({ default: m[name] as ComponentType<any> })));
}

const Today = page(() => import('./routes/app/Today'), 'Today');
const Setup = page(() => import('./routes/app/Setup'), 'Setup');
const Students = page(() => import('./routes/app/Students'), 'Students');
const Admit = page(() => import('./routes/app/Admit'), 'Admit');
const ImportStudents = page(() => import('./routes/app/ImportStudents'), 'ImportStudents');
const StudentRecord = page(() => import('./routes/app/StudentRecord'), 'StudentRecord');
const LeavingCertificate = page(() => import('./routes/app/LeavingCertificate'), 'LeavingCertificate');
const Classes = page(() => import('./routes/app/Classes'), 'Classes');
const Promote = page(() => import('./routes/app/Promote'), 'Promote');
const Attendance = page(() => import('./routes/app/Attendance'), 'Attendance');
const Register = page(() => import('./routes/app/Register'), 'Register');
const AttendanceMonth = page(() => import('./routes/app/AttendanceMonth'), 'AttendanceMonth');
const Fees = page(() => import('./routes/app/Fees'), 'Fees');
const Collect = page(() => import('./routes/app/Collect'), 'Collect');
const FeePlans = page(() => import('./routes/app/FeePlans'), 'FeePlans');
const Receipt = page(() => import('./routes/app/Receipt'), 'Receipt');
const Staff = page(() => import('./routes/app/Staff'), 'Staff');
const Reports = page(() => import('./routes/app/Reports'), 'Reports');
const Settings = page(() => import('./routes/app/Settings'), 'Settings');

// The parent app: its own screens, loaded only by parents.
const ParentLogin = page(() => import('./routes/parent/ParentLogin'), 'ParentLogin');
const ParentWelcome = page(() => import('./routes/parent/ParentWelcome'), 'ParentWelcome');
const ParentShell = page(() => import('./routes/parent/ParentShell'), 'ParentShell');
const ParentHome = page(() => import('./routes/parent/ParentHome'), 'ParentHome');
const ParentChild = page(() => import('./routes/parent/ParentChild'), 'ParentChild');
const ParentReceipt = page(() => import('./routes/parent/ParentReceipt'), 'ParentReceipt');

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RouteHome />} />

      <Route path="/login" element={<RequireGuest><Login /></RequireGuest>} />
      <Route path="/signup" element={<RequireGuest><SignUp /></RequireGuest>} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/invite/:id" element={<Invite />} />

      <Route path="/new-school" element={<RequireAuth><CreateSchool /></RequireAuth>} />

      <Route
        path="/app"
        element={
          <RequireAuth>
            <AppShell />
          </RequireAuth>
        }
      >
        <Route index element={<Lazy><Today /></Lazy>} />
        <Route path="students" element={<Guard anyOf={['students.view.all', 'students.view.own']}><Lazy><Students /></Lazy></Guard>} />
        <Route path="students/new" element={<Guard anyOf={['students.edit']}><Lazy><Admit /></Lazy></Guard>} />
        <Route path="students/import" element={<Guard anyOf={['students.edit']}><Lazy><ImportStudents /></Lazy></Guard>} />
        <Route path="students/:id" element={<Lazy><StudentRecord /></Lazy>} />
        <Route path="students/:id/certificate" element={<Lazy><LeavingCertificate /></Lazy>} />
        <Route path="classes" element={<Lazy><Classes /></Lazy>} />
        <Route path="classes/promote" element={<Guard anyOf={['students.edit']}><Lazy><Promote /></Lazy></Guard>} />
        <Route path="attendance" element={<Guard anyOf={['attendance.view', 'attendance.mark.own', 'attendance.mark.all']}><Lazy><Attendance /></Lazy></Guard>} />
        <Route path="attendance/:sectionId" element={<Lazy><Register /></Lazy>} />
        <Route path="attendance/:sectionId/month" element={<Lazy><AttendanceMonth /></Lazy>} />
        <Route path="fees" element={<Guard anyOf={['fees.view']}><Lazy><Fees /></Lazy></Guard>} />
        <Route path="fees/dues" element={<Guard anyOf={['fees.view']}><Lazy><Fees tab="dues" /></Lazy></Guard>} />
        <Route path="fees/collections" element={<Guard anyOf={['fees.view']}><Lazy><Fees tab="collections" /></Lazy></Guard>} />
        <Route path="fees/daybook" element={<Guard anyOf={['fees.view']}><Lazy><Fees tab="daybook" /></Lazy></Guard>} />
        <Route path="fees/collect" element={<Guard anyOf={['fees.collect']}><Lazy><Collect /></Lazy></Guard>} />
        <Route path="fees/collect/:studentId" element={<Guard anyOf={['fees.collect']}><Lazy><Collect /></Lazy></Guard>} />
        <Route path="fees/plans" element={<Guard anyOf={['fees.view']}><Lazy><FeePlans /></Lazy></Guard>} />
        <Route path="fees/receipts/:id" element={<Guard anyOf={['fees.view']}><Lazy><Receipt /></Lazy></Guard>} />
        <Route path="staff" element={<Lazy><Staff /></Lazy>} />
        <Route path="reports" element={<Guard anyOf={['reports.academic', 'reports.fees', 'attendance.view']}><Lazy><Reports /></Lazy></Guard>} />
        <Route path="settings" element={<Guard anyOf={['school.manage', 'audit.view', 'fees.manage']}><Lazy><Settings /></Lazy></Guard>} />
      </Route>
      <Route path="/app/setup" element={<RequireAuth><Lazy full><Setup /></Lazy></RequireAuth>} />

      <Route path="/parent/login" element={<RequireGuest><Lazy full><ParentLogin /></Lazy></RequireGuest>} />
      <Route path="/parent/welcome" element={<Lazy full><ParentWelcome /></Lazy>} />
      <Route
        path="/parent"
        element={
          <RequireParent>
            <Lazy full>
              <ParentShell />
            </Lazy>
          </RequireParent>
        }
      >
        <Route index element={<Lazy><ParentHome /></Lazy>} />
        <Route path="child/:id" element={<Lazy><ParentChild /></Lazy>} />
        <Route path="receipts/:id" element={<Lazy><ParentReceipt /></Lazy>} />
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function Guard({ anyOf, children }: { anyOf: Permission[]; children: React.ReactNode }) {
  return <RequirePermission anyOf={anyOf}>{children}</RequirePermission>;
}

/** Inside the shell the masthead stays put while a screen loads; outside it, the full loading screen. */
function Lazy({ children, full }: { children: React.ReactNode; full?: boolean }) {
  return <Suspense fallback={full ? <Checking label="Loading" /> : <div className="flex-1" aria-busy="true" />}>{children}</Suspense>;
}

function NotFound() {
  return (
    <div data-surface="dark" className="relative grid min-h-svh place-items-center px-6">
      <ContourField />
      <div className="rise relative z-10 w-full max-w-sm text-center">
        <Wordmark tone="light" className="mx-auto h-6" />
        <h1 className="mt-6 text-white">This page does not exist</h1>
        <p className="mt-2.5 text-slate-400">The link may be out of date, or the address mistyped.</p>
        <Link className="btn btn-sun mt-6" to="/">
          Go to your school
        </Link>
      </div>
    </div>
  );
}
