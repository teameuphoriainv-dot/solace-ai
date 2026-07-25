/**
 * Clinician session management.
 *
 * Token + metadata in localStorage so opening the printable patient note in a
 * new tab can re-use the same session. The 30-min absolute JWT expiry + 15-min
 * idle timeout below still enforce automatic logout — moving from sessionStorage
 * to localStorage trades "browser-close clears" for "multi-tab works", which
 * matches a real clinical workflow (clinician opens a chart in tab A, hits
 * Print, the print preview opens in tab B and just works).
 */

const STORAGE_KEY = "solace.session.v1";
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 min

export type Session = {
  token: string;
  clinician_id: string;
  name: string;
  role: string;
  hospital_id: string;
  expires_at: number; // unix seconds
  // Optional EHR provenance — present when the clinician signed in via SMART-on-FHIR.
  // Tells the dashboard which vendor to badge and where to issue live FHIR queries.
  ehr_vendor?: string;        // "epic" | "cerner" | "athena"
  ehr_label?: string;         // "Epic" | "Oracle Cerner" | "Athenahealth"
  ehr_color?: string;         // brand accent hex
  ehr_sandbox?: boolean;      // true = non-PHI demo / sandbox
  fhir_base_url?: string;
};

// Read from localStorage primarily; fall back to sessionStorage for any clinician
// who's still mid-session under the old storage model. Same-tab logic is unchanged.
function _read(key: string): string | null {
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

export function loadSession(): Session | null {
  try {
    const raw = _read(STORAGE_KEY);
    if (!raw) return null;
    const sess = JSON.parse(raw) as Session;
    if (!sess.token || !sess.expires_at) return null;
    if (sess.expires_at * 1000 < Date.now()) {
      clearSession();
      return null;
    }
    return sess;
  } catch {
    return null;
  }
}

export function saveSession(sess: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sess));
  // Drop any leftover sessionStorage copy from older builds so loadSession is unambiguous.
  sessionStorage.removeItem(STORAGE_KEY);
  bumpActivity();
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY + ".lastActivity");
  sessionStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY + ".lastActivity");
}

export function bumpActivity(): void {
  localStorage.setItem(STORAGE_KEY + ".lastActivity", String(Date.now()));
}

/**
 * True when a token is on disk, regardless of whether it is still valid.
 *
 * The 401 interceptor needs "was this request made as a signed-in clinician?",
 * which loadSession() cannot answer — it clears and returns null for an expired
 * token, exactly the case we care about.
 */
export function hasStoredSession(): boolean {
  return _read(STORAGE_KEY) !== null;
}

/**
 * Session-expiry fan-out.
 *
 * A 401 can surface from any page, but only the clinician shell knows how to
 * present a login form. The api layer clears the session and calls
 * notifySessionExpired(); the shell subscribes and routes. The listeners live
 * here rather than in the api layer so subscribing does not pull in axios.
 */
export type SessionExpiredListener = (reason: string) => void;

export const SESSION_EXPIRED_MESSAGE = "Session expired — please sign in again.";

const _expiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(fn: SessionExpiredListener): () => void {
  _expiredListeners.add(fn);
  return () => {
    _expiredListeners.delete(fn);
  };
}

export function notifySessionExpired(reason: string = SESSION_EXPIRED_MESSAGE): void {
  // Copy first: a listener that unsubscribes itself must not mutate the set
  // mid-iteration. A throwing listener must not stop the others from running.
  for (const fn of [..._expiredListeners]) {
    try {
      fn(reason);
    } catch {
      /* ignore */
    }
  }
}

export function isIdleExpired(): boolean {
  const last = Number(_read(STORAGE_KEY + ".lastActivity") || 0);
  if (!last) return false;
  return Date.now() - last > IDLE_TIMEOUT_MS;
}
