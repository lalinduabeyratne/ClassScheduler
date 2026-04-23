# ClassScheduler

## Physics Tutor Manager (Next.js + Firebase)

Full-stack tuition management web app for a physics tutor.

### Features (implemented foundation + core flows)

- **Authentication**: tutor/admin login + separate login per student/parent (Firebase Auth)
- **Roles**: `admin` vs `student` stored in Firestore `users/{uid}`
- **Fees**: auto-calculated totals based on attendance rules:
  - Attended → 100%
  - Early cancel (≥ 24h) → 0%
  - Late cancel (< 24h) → 50%
  - No-show → 100%
- **Student portal**: shows **Total to date / Paid / Remaining** (from sessions + payments)
- **Ready for Vercel**: App Router, client Firebase SDK

### Prerequisites

- Install **Node.js 20+** (recommended) from `https://nodejs.org`
- A Firebase project (free tier works)

### 1) Install dependencies

```bash
npm install
```

### 2) Create Firebase project + web app

In Firebase Console:

- **Create project**
- **Add a Web App** → copy config values
- Enable products:
  - **Authentication** → Sign-in method → **Email/Password**
  - **Firestore Database**
  - **Storage** (for payment slips)

### 3) Configure environment variables

Create `.env.local` in the repo root (copy from `.env.example`) and fill:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

### 4) Set up Firestore + Storage rules

In Firebase Console:

- Firestore → Rules → paste from `firestore.rules`
- Storage → Rules → paste from `storage.rules`

### 5) Create users (admin + students)

In Firebase Console:

1. Authentication → Users → **Add user**
2. For each created user, copy their **UID**

Then in Firestore, create documents:

#### Admin user

`users/{ADMIN_UID}`

```json
{ "role": "admin" }
```

#### Student/parent user

1) Create a student record:

`students/{STUDENT_ID}`

```json
{
  "fullName": "Student Name",
  "parentName": "Parent Name",
  "authUid": "STUDENT_AUTH_UID",
  "feePerSessionCents": 250000,
  "sessionDurationMin": 90,
  "sessionType": "individual",
  "active": true,
  "createdAt": 1760000000000
}
```

2) Link the auth user to that student:

`users/{STUDENT_AUTH_UID}`

```json
{ "role": "student", "studentId": "STUDENT_ID" }
```

### 6) Run locally

```bash
npm run dev
```

Open `http://localhost:3000`.

### 7) Deploy to Vercel

- Push this repo to GitHub
- In Vercel: New Project → import repo
- Add the same env vars from `.env.local` to Vercel Project Settings
- Deploy

### Data model (Firestore collections)

- `users/{uid}`: `{ role: "admin"|"student", studentId? }`
- `students/{studentId}`: profile + pricing
- `timetableSlots/{slotId}`: weekly fixed slot definitions
- `sessions/{sessionId}`: each class occurrence with attendance + computed charge
- `payments/{paymentId}`: payment ledger + slip upload (student creates, admin verifies)
- `rescheduleRequests/{id}`: student request, admin approve/reject

### Fee formula used

\[
\text{Total Fee} =
(\text{attended} \times \text{full fee}) +
(\text{late cancel} \times 0.5 \times \text{full fee}) +
(\text{no-show} \times \text{full fee})
\]
