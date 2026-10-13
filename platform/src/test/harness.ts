// Test harness: a fresh in-memory Postgres per suite, the real app on top of it, and a
// small client that signs people up and carries their cookies like a browser would.
import { createApp } from '../app';
import { createAuth } from '../auth';
import { openLocalDatabase } from '../db';
import type { Db } from '../db';

const ORIGIN = 'http://localhost:5173';

export async function startTestApp() {
  const db = await openLocalDatabase();
  const auth = createAuth({ db, secret: 'test-secret-test-secret-test-secret-123', baseURL: 'http://localhost:8787', trustedOrigins: [ORIGIN] });
  const app = createApp({ db, auth, origins: [ORIGIN] });
  return { db, auth, app };
}

type App = Awaited<ReturnType<typeof startTestApp>>['app'];

export class Client {
  private cookies = new Map<string, string>();
  constructor(private app: App) {}

  async request(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Origin: ORIGIN };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await this.app.request(`http://localhost:8787${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      if (value === '' || /max-age=0/i.test(line)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: res.status, body: json };
  }

  get = (path: string) => this.request('GET', path);
  post = (path: string, body: unknown = {}) => this.request('POST', path, body);
  put = (path: string, body: unknown = {}) => this.request('PUT', path, body);
  patch = (path: string, body: unknown = {}) => this.request('PATCH', path, body);
  del = (path: string) => this.request('DELETE', path);

  async signUp(name: string, email: string) {
    const res = await this.post('/api/auth/sign-up/email', { name, email, password: 'password-12345' });
    if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async createSchool(name: string, slug: string) {
    const res = await this.post('/api/auth/organization/create', { name, slug });
    if (res.status !== 200) throw new Error(`create school failed: ${res.status} ${JSON.stringify(res.body)}`);
    await this.post('/api/auth/organization/set-active', { organizationId: res.body.id });
    return res.body as { id: string };
  }
}

/** Signs up an owner, creates a school, and runs first-time setup with two classes. */
export async function ownerWithSchool(app: App, tag: string) {
  const owner = new Client(app);
  await owner.signUp(`Owner ${tag}`, `owner-${tag}@example.com`);
  const school = await owner.createSchool(`School ${tag}`, `school-${tag}`);
  const setup = await owner.post('/api/school/setup', {
    profile: { name: `School ${tag}`, board: 'CBSE', city: 'Kanpur', state: 'Uttar Pradesh' },
    year: { name: '2026–27', startsOn: '2026-04-01', endsOn: '2027-03-31', terms: [] },
    classes: [
      { name: '5', sections: ['A'] },
      { name: '6', sections: ['A', 'B'] },
    ],
    subjects: ['English', 'Mathematics'],
    feeHeads: ['Tuition', 'Transport'],
  });
  if (setup.status !== 201) throw new Error(`setup failed: ${setup.status} ${JSON.stringify(setup.body)}`);
  const structure = await owner.get('/api/school/structure');
  const sections: Record<string, string> = {};
  for (const g of structure.body.grades) for (const s of g.sections) sections[s.label] = s.id;
  const grades: Record<string, string> = Object.fromEntries(structure.body.grades.map((g: any) => [g.name, g.id]));
  return { owner, schoolId: school.id, sections, grades };
}

export async function admit(client: Client, sectionId: string, firstName: string, phone = '9876543210') {
  const res = await client.post('/api/school/students', {
    student: { firstName, lastName: 'Test', gender: 'male', dateOfBirth: '2015-01-14' },
    guardians: [{ name: `Parent of ${firstName}`, relation: 'mother', phone, isPrimary: true }],
    sectionId,
    consentMethod: 'paper',
  });
  if (res.status !== 201) throw new Error(`admit failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { id: string; admissionNo: string };
}

export type { Db };
