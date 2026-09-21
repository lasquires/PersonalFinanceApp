export function googleSignInOptions(origin: string) {
  return {
    provider: 'google' as const,
    options: { redirectTo: origin },
  };
}
