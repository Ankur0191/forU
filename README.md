# forU — Private Chat

A premium, responsive one-to-one messenger for exactly two people.

## Stack

- Next.js App Router, React, and TypeScript
- Supabase Auth for password-based identity
- Supabase PostgreSQL for durable message history
- Supabase Realtime for live message changes, typing indicators, and presence
- PostgreSQL Row Level Security for the two-member allowlist

## Quick start

1. Copy \`.env.example\` to \`.env.local\`.
2. Set the two usernames and their corresponding Supabase Auth email addresses.
3. Create the two Auth users, then insert their user IDs into \`public.foru_members\`.
4. Run \`npm install\` and \`npm run dev\`.

See [supabase/SETUP.md](supabase/SETUP.md) for the step-by-step instructions.

## Security

- There is no public sign-up route.
- The browser only receives a Supabase publishable key.
- RLS restricts history and Realtime access to provisioned members.
- The database prevents provisioning a third member.
- Message bodies and sender IDs cannot be changed after a message is sent.
- Only the recipient can set a read receipt, and only once.
