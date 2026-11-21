# forU setup

The application is wired to the Supabase project:

- Project: **ForU**
- Project ref: \`iugvmggulkauqdpdkrxd\`
- Region: \`ap-south-1\` (Mumbai)
- URL: \`https://iugvmggulkauqdpdkrxd.supabase.co\`

## 1. Configure the two login identities

Copy \`.env.example\` to \`.env.local\`.

Replace the example usernames and email addresses with the two intended accounts. The username is the login name shown in the UI; each username maps to an email address used internally by Supabase Auth. Do not put passwords in environment variables or the repository.

Create exactly two users in **Supabase Dashboard → Authentication → Users → Add user**. Use the exact email addresses from the environment file and set a strong password for each. Confirm the users in the dashboard.

## 2. Add the two members to the database

The chat schema and its RLS policies are already applied to the ForU Supabase project. Find each Auth user's UUID in Authentication → Users, then run this in **SQL Editor** (replace all four placeholders):

\`\`\`sql
insert into public.foru_members (user_id, username)
values
  ('ACCOUNT_ONE_AUTH_USER_UUID', 'ACCOUNT_ONE_USERNAME'),
  ('ACCOUNT_TWO_AUTH_USER_UUID', 'ACCOUNT_TWO_USERNAME');
\`\`\`

The database rejects a third member. Authenticated clients cannot add or remove members. The two usernames must match the values in \`.env.local\`.

## 3. Keep Realtime private

In **Project Settings → Realtime**, turn off **Allow public access** so the app uses its RLS-protected private channel. The application joins the private topic \`foru:private-chat\`. The database policies limit Broadcast and Presence access to the two rows in \`foru_members\`.

The \`messages\` table is enabled in the \`supabase_realtime\` publication. RLS restricts message history to members, message inserts to the signed-in sender, and read receipts to the recipient. A database trigger prevents editing a message after it has been sent.

## 4. Run locally

\`\`\`bash
npm install
npm run dev
\`\`\`

Open http://localhost:3000. Sign in with one of the two usernames and its Supabase Auth password.

## 5. Deploy

Import this GitHub repository into Vercel. Set the same environment variables from \`.env.local\` in the Vercel project settings, then deploy. Use HTTPS in production.

The Supabase publishable key is intended for browser use. Never add a Supabase secret or service-role key to any \`NEXT_PUBLIC_*\` variable or commit it to Git.

## Current scope

Implemented in this first release: username/password sign-in (two allowlisted accounts), persistent 1:1 text messages, live message updates, online presence, typing indicators, sent/read indicators, responsive desktop/mobile layouts, and sign-out. File attachments are not enabled yet.
