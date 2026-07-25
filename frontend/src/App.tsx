import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { onSessionExpired } from "./lib/session";
import PatientIntake from "./pages/PatientIntake";
import PatientResult from "./pages/PatientResult";
import ClinicianDashboard from "./pages/ClinicianDashboard";
import QRCard from "./pages/QRCard";
import VoiceAgent from "./pages/VoiceAgent";
import EHRCallback from "./pages/EHRCallback";
import PatientSchedule from "./pages/PatientSchedule";
import ClinicianLanding from "./pages/ClinicianLanding";
import AuthVerify from "./pages/AuthVerify";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";

// DEPS-006 / PERF-007: keep recharts and the heavy demo/clinician-tool pages out
// of the root bundle. These routes are off the patient critical path (intake →
// result) and the clinician's first paint (dashboard), so they load on demand.
// TrustReport is the only consumer of recharts; lazy-loading it pulls recharts
// into its own chunk instead of the eager main bundle.
const PatientPrintView = lazy(() => import("./pages/PatientPrintView"));
const WorkflowsAdmin = lazy(() => import("./pages/WorkflowsAdmin"));
const ClinicianScribe = lazy(() => import("./pages/ClinicianScribe"));
const ClinicianLetters = lazy(() => import("./pages/ClinicianLetters"));
const ClinicianInbox = lazy(() => import("./pages/ClinicianInbox"));
const ClinicianTools = lazy(() => import("./pages/ClinicianTools"));
const ClinicianOps = lazy(() => import("./pages/ClinicianOps"));
const PatientDetailPage = lazy(() => import("./pages/PatientDetailPage"));
const ShowcaseDemo = lazy(() => import("./pages/ShowcaseDemo"));
const MockupStudio = lazy(() => import("./pages/MockupStudio"));
const TrustReport = lazy(() => import("./pages/TrustReport"));

// Marketing site + onboarding entry. All lazy: none of these are on the
// patient or clinician critical paths, and they pull marketing-only motion UI.
const Landing = lazy(() => import("./pages/marketing/Landing"));
const ScribePage = lazy(() => import("./pages/marketing/ScribePage"));
const TriagePage = lazy(() => import("./pages/marketing/TriagePage"));
const CopilotPage = lazy(() => import("./pages/marketing/CopilotPage"));
const IntegrationsPage = lazy(() => import("./pages/marketing/IntegrationsPage"));
const SecurityPage = lazy(() => import("./pages/marketing/SecurityPage"));
const AboutPage = lazy(() => import("./pages/marketing/AboutPage"));
const ContactPage = lazy(() => import("./pages/marketing/ContactPage"));
const GetStarted = lazy(() => import("./pages/GetStarted"));
const EhrHub = lazy(() => import("./pages/EhrHub"));

// USAB-006: a lightweight, centered busy state covers the brief lazy-chunk fetch.
function RouteFallback() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center text-text-muted" role="status" aria-live="polite">
      <Loader2 size={20} className="animate-spin" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}

// Per-hospital routes. Rendered once under the bare `/:hospitalId` prefix
// (legacy, keeps `/demo` working) and once under `/h/:hospitalId` (provisioned
// hospital workspaces). Both bind the same `:hospitalId` param, so every page
// reads its workspace identically via useParams().
function hospitalRoutes(prefix: string) {
  return [
    <Route key={`${prefix}-intake`} path={`${prefix}/:hospitalId`} element={<PatientIntake />} />,
    <Route key={`${prefix}-verify`} path={`${prefix}/:hospitalId/auth/verify`} element={<AuthVerify />} />,
    <Route key={`${prefix}-qr`} path={`${prefix}/:hospitalId/qr`} element={<QRCard />} />,
    <Route key={`${prefix}-schedule`} path={`${prefix}/:hospitalId/schedule`} element={<PatientSchedule />} />,
    <Route key={`${prefix}-result`} path={`${prefix}/:hospitalId/result/:patientId`} element={<PatientResult />} />,
    <Route key={`${prefix}-clin`} path={`${prefix}/:hospitalId/clinician`} element={<ClinicianDashboard />} />,
    <Route key={`${prefix}-print`} path={`${prefix}/:hospitalId/clinician/print/:patientId`} element={<PatientPrintView />} />,
    <Route key={`${prefix}-wf`} path={`${prefix}/:hospitalId/clinician/workflows`} element={<WorkflowsAdmin />} />,
    <Route key={`${prefix}-scribe`} path={`${prefix}/:hospitalId/clinician/scribe`} element={<ClinicianScribe />} />,
    <Route key={`${prefix}-detail`} path={`${prefix}/:hospitalId/clinician/patient/:patientId`} element={<PatientDetailPage />} />,
    <Route key={`${prefix}-detail-scribe`} path={`${prefix}/:hospitalId/clinician/patient/:patientId/scribe`} element={<ClinicianScribe />} />,
    <Route key={`${prefix}-letters`} path={`${prefix}/:hospitalId/clinician/letters`} element={<ClinicianLetters />} />,
    <Route key={`${prefix}-inbox`} path={`${prefix}/:hospitalId/clinician/inbox`} element={<ClinicianInbox />} />,
    <Route key={`${prefix}-tools`} path={`${prefix}/:hospitalId/clinician/tools`} element={<ClinicianTools />} />,
    <Route key={`${prefix}-ops`} path={`${prefix}/:hospitalId/clinician/ops`} element={<ClinicianOps />} />,
    <Route key={`${prefix}-ehr`} path={`${prefix}/:hospitalId/clinician/ehr`} element={<EhrHub />} />,
  ];
}

/**
 * Routes to the sign-in screen when the api layer reports an expired session.
 *
 * Lives inside <Routes>' Router context so it can navigate. Clinician sign-in is
 * hosted by ClinicianDashboard at `.../:hospitalId/clinician`, so the login route
 * for any clinician sub-page is that page's path truncated at `/clinician` —
 * which works under both the bare `/:hospitalId` and `/h/:hospitalId` prefixes.
 */
function SessionExpiryRedirect() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    return onSessionExpired((reason) => {
      const marker = "/clinician";
      const at = pathname.indexOf(marker);
      // A 401 on a patient-facing page has no clinician login to fall back to,
      // and the page's own error UI is the right surface. Leave it alone.
      if (at === -1) return;
      const loginPath = pathname.slice(0, at + marker.length);
      // Already on the sign-in host: its own subscriber shows the message, so a
      // redundant navigation would only remount and discard local state.
      if (loginPath === pathname) return;
      navigate(loginPath, { replace: true, state: { authReason: reason } });
    });
  }, [navigate, pathname]);

  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SessionExpiryRedirect />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/scribe" element={<ScribePage />} />
          <Route path="/triage" element={<TriagePage />} />
          <Route path="/copilot" element={<CopilotPage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/security" element={<SecurityPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/get-started" element={<GetStarted />} />
          <Route path="/clinicians" element={<ClinicianLanding />} />
          {/* Standalone split-screen showcase: patient intake + live clinician dashboard. */}
          <Route path="/showcase" element={<ShowcaseDemo />} />
          {/* Presentation mockup studio: real app framed in iPhone + desktop, annotated, export-ready. */}
          <Route path="/mockups" element={<MockupStudio />} />
          {/* Public Solace Trust Report — aggregate transparency, no auth, no PHI. */}
          <Route path="/trust" element={<TrustReport />} />
          <Route path="/voice" element={<VoiceAgent />} />
          <Route path="/ehr/callback" element={<EHRCallback />} />
          {hospitalRoutes("")}
          {hospitalRoutes("/h")}
          <Route path="*" element={<Navigate to="/demo" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
