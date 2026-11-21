const accounts = [
  { username: process.env.NEXT_PUBLIC_ACCOUNT_ONE_USERNAME, email: process.env.NEXT_PUBLIC_ACCOUNT_ONE_EMAIL },
  { username: process.env.NEXT_PUBLIC_ACCOUNT_TWO_USERNAME, email: process.env.NEXT_PUBLIC_ACCOUNT_TWO_EMAIL },
];

export function emailForUsername(username: string): string | null {
  const normalized = username.trim().toLocaleLowerCase();
  return accounts.find((account) => account.username?.toLocaleLowerCase() === normalized)?.email ?? null;
}

export function usernameForEmail(email?: string | null): string {
  return accounts.find((account) => account.email?.toLocaleLowerCase() === email?.toLocaleLowerCase())?.username ?? "you";
}

export function peerUsernameForEmail(email?: string | null): string {
  const normalized = email?.toLocaleLowerCase();
  return accounts.find((account) => account.email?.toLocaleLowerCase() !== normalized)?.username ?? "your person";
}