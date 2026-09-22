export const POLICY_PATHS: string[] = [
  '/privacy-policy',
  '/terms-and-conditions',
  '/community-guidelines',
  '/delete-account-policy',
  '/contact-us',
  '/refund-policy',
  '/cookie-policy',
  '/safety-tips',
  '/dmca-copyright-policy',
  '/content-moderation-policy'
];

export function isPolicyPath(pathname: string): boolean {
  return POLICY_PATHS.includes(pathname);
}

export function navigateToPolicyPath(path: string): void {
  if (typeof window !== 'undefined') {
    window.history.pushState({ isPolicy: true, policyPath: path }, '', path);
    // Dispatch custom event so App.tsx and other listeners update instantly
    window.dispatchEvent(new CustomEvent('anviotalk_navigate_policy', { detail: { path } }));
  }
}
