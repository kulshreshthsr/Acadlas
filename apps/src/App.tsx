// Every screen in the product, and who may see it. Product routes (students,
// attendance, fees) get added inside the signed-in branch as they are built.
import { Link, Route, Routes } from 'react-router-dom';
import { Login } from './routes/Login';
import { SignUp } from './routes/SignUp';
import { CreateSchool } from './routes/CreateSchool';
import { Dashboard } from './routes/Dashboard';
import { RequireAuth, RequireGuest, RouteHome } from './routes/guards';
import { Wordmark } from './components/Wordmark';
import { ContourField } from './components/ContourField';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<RouteHome />} />

      <Route
        path="/login"
        element={
          <RequireGuest>
            <Login />
          </RequireGuest>
        }
      />
      <Route
        path="/signup"
        element={
          <RequireGuest>
            <SignUp />
          </RequireGuest>
        }
      />

      <Route
        path="/new-school"
        element={
          <RequireAuth>
            <CreateSchool />
          </RequireAuth>
        }
      />
      <Route
        path="/app"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
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
