// Every screen in the product, and who may see it. Product routes (students,
// attendance, fees) get added inside the signed-in branch as they are built.
import { Link, Route, Routes } from 'react-router-dom';
import { Login } from './routes/Login';
import { SignUp } from './routes/SignUp';
import { CreateSchool } from './routes/CreateSchool';
import { Dashboard } from './routes/Dashboard';
import { RequireAuth, RequireGuest, RouteHome } from './routes/guards';
import { Wordmark } from './components/Wordmark';

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
    <div className="grid min-h-svh place-items-center px-6">
      <div className="w-full max-w-sm">
        <Wordmark className="h-7" />
        <h1 className="mt-7">This page does not exist</h1>
        <p className="lead mt-3">The link may be out of date, or the address mistyped.</p>
        <Link className="btn btn-ink mt-7" to="/">
          Go to your school
        </Link>
      </div>
    </div>
  );
}
