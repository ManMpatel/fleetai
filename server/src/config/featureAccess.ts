// Which accounts can see which restricted features. One list, in one place: add or remove an
// email here and redeploy. Matching is on the account's login email (the same email the Rent
// Tracker list matches on), ignoring upper/lower case.
//
//   ddr   - the "↓ DDR" button on a renter (the Direct Debit Request agreement PDF)
//   forms - the Forms page (claim-form templates that are sent to renters by link)
//
// /api/auth/status sends these answers to the dashboard (session.features) so the menu and
// buttons follow the list, and the Forms routes check the same list on the server, so a
// hidden page can never be reached by typing its address.
const FEATURE_EMAILS = {
  ddr: ['info@primeautobodyrepairs.com', 'manpatel1144@gmail.com'],
  forms: ['manpatel1144@gmail.com', 'kgncorp2014@gmail.com'],
} as const

export type FeatureKey = keyof typeof FEATURE_EMAILS

export function featureAllowed(feature: FeatureKey, email: string | null | undefined): boolean {
  if (typeof email !== 'string') return false
  const list: readonly string[] = FEATURE_EMAILS[feature]
  return list.includes(email.trim().toLowerCase())
}