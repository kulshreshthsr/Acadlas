# Acadlas apps

The browser app for Acadlas School: sign-up and sign-in, creating a school, first-time setup, and
everything inside — Today, students, classes, attendance, fees, staff, reports and settings.

React 19 + TypeScript + Vite, Tailwind CSS 4, React Router, TanStack Query, Better Auth's client.
It talks to the platform API (`../platform`).

## Setup

```powershell
npm install
Copy-Item .env.local.example .env.local   # only needed if the API is not on localhost:8787
npm run dev                               # http://localhost:5173
```

## What's here

```text
src/
├── App.tsx                 Every route, and which roles may open it.
├── components/
│   ├── AppShell.tsx        The masthead (the school's own contour map), navigation, school
│   │                       switcher, account menu and the phone tab bar.
│   ├── CommandPalette.tsx  "/" or Ctrl+K: find a student by name, admission no. or a parent's
│   │                       phone, a receipt, a colleague — or jump to a common job.
│   └── ui.tsx              Page, Card, Dialog, fields, toasts and the rest of the vocabulary.
├── lib/
│   ├── api.ts              fetch wrapper, errors, the query client.
│   ├── school.ts           Who is signed in, which school, what their role allows.
│   ├── format.ts           ₹ in lakh grouping, dates, phone numbers, WhatsApp links.
│   └── csv.ts              Excel-friendly export and import.
└── routes/
    ├── Login, SignUp, CreateSchool, PasswordReset, Invite
    └── app/                Today, Setup, Students, Admit, ImportStudents, StudentRecord,
                            LeavingCertificate, Classes, Promote, Attendance, Register,
                            AttendanceMonth, Fees, Collect, FeePlans, Receipt, Staff, Reports,
                            Settings
```

Each screen under `routes/app` is loaded the first time it is opened, so a teacher on a slow
phone connection downloads the register, not the fee plan editor.

## Commands

| Command           | Action                                  |
| :---------------- | :-------------------------------------- |
| `npm run dev`     | Dev server at `localhost:5173`          |
| `npm run build`   | Type-check and build to `dist/`         |
| `npm run lint`    | ESLint                                  |
| `npm run preview` | Serve the built app locally             |
