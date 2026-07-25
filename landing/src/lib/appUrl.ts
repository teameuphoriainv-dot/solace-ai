// Base URL of the Solace clinical app (frontend/). The marketing site links
// into the app's /get-started funnel from every primary CTA.
export const APP_URL: string =
  (import.meta.env.VITE_APP_URL as string | undefined) ?? 'https://solaceaidemo.vercel.app';

export const GET_STARTED_URL = `${APP_URL}/get-started`;
