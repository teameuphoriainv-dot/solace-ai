import axios from "axios";
import { clearSession, hasStoredSession, notifySessionExpired } from "./session";
import type {
  ClinicianNote,
  InsuranceFields,
  IntakeResponse,
  JsonObject,
  MedicalInfo,
  PatientDetail,
  PatientEducation,
  PatientSummary,
  Prescription,
  PrescriptionSuggestion,
  PublicPatient,
  RefinedTriage,
  TranscribeResponse,
  Vitals,
} from "../types";

// If VITE_API_BASE_URL is empty, axios uses relative URLs — served same-origin
// via Vite's proxy. Set explicitly only when you need to bypass the proxy.
const BASE_URL =
  import.meta.env.VITE_API_BASE_URL !== undefined && import.meta.env.VITE_API_BASE_URL !== ""
    ? import.meta.env.VITE_API_BASE_URL
    : "";

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 120_000,
});

// Attach Bearer token on every request. Reads localStorage first (primary store)
// then sessionStorage (legacy fallback). This is the ONLY auth mechanism —
// legacy X-Clinician-PIN has been removed.
api.interceptors.request.use((config) => {
  try {
    const raw =
      localStorage.getItem("solace.session.v1") ??
      sessionStorage.getItem("solace.session.v1");
    if (raw) {
      const sess = JSON.parse(raw);
      if (sess?.token) {
        config.headers = config.headers ?? {};
        (config.headers as Record<string, string>).Authorization = `Bearer ${sess.token}`;
      }
    }
  } catch {
    /* ignore */
  }
  return config;
});

// Endpoints where a 401 IS the answer, not a symptom. Sign-in and magic-link
// verification legitimately return 401 for a wrong PIN or a stale link, and the
// caller renders "Incorrect name or PIN" / "This link has expired". Clearing the
// session or bouncing to login on those would break the sign-in screen itself.
const AUTH_CHALLENGE_PATH = /\/auth\/(login|magic\/(request|verify))(\?|$)/;

// Global 401 handling. Before this, only ClinicianDashboard reacted to an expired
// token (via its polling error string) and every other clinician page surfaced a
// raw error. Now one place clears the session and tells the shell to show login.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url: string = error?.config?.url ?? "";
    // Only meaningful if the request went out as a signed-in clinician. An
    // anonymous call hitting a protected route has no session to expire.
    if (status === 401 && hasStoredSession() && !AUTH_CHALLENGE_PATH.test(url)) {
      clearSession();
      notifySessionExpired();
    }
    // Always re-reject: callers keep their own catch blocks and error UI.
    return Promise.reject(error);
  },
);

export async function postTranscribe(hospitalId: string, form: FormData): Promise<TranscribeResponse> {
  const { data } = await api.post<TranscribeResponse>(`/api/${hospitalId}/transcribe`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function postIntake(hospitalId: string, form: FormData): Promise<IntakeResponse> {
  const { data } = await api.post<IntakeResponse>(`/api/${hospitalId}/intake`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function postPainFlag(hospitalId: string, patientId: string): Promise<void> {
  await api.post(`/api/${hospitalId}/pain-flag`, { patient_id: patientId });
}

export async function acknowledgePainFlag(
  hospitalId: string,
  patientId: string,
): Promise<void> {
  await api.post(
    `/api/${hospitalId}/pain-flag/acknowledge`,
    { patient_id: patientId },
  );
}

export async function getPatients(
  hospitalId: string,
  status: "waiting" | "all" = "waiting"
): Promise<{ patients: PatientSummary[] }> {
  const { data } = await api.get(`/api/${hospitalId}/patients`, {
    params: { status },
  });
  return data;
}

export async function getPatientDetail(
  hospitalId: string,
  patientId: string,
): Promise<PatientDetail> {
  const { data } = await api.get<PatientDetail>(`/api/${hospitalId}/patients/${patientId}`);
  return data;
}

export async function markSeen(
  hospitalId: string,
  patientId: string,
  clinicianName: string
): Promise<void> {
  await api.patch(
    `/api/${hospitalId}/patients/${patientId}/resolve`,
    { clinician_name: clinicianName },
  );
}

export async function scanInsurance(
  hospitalId: string,
  imageFile: File,
  consentGranted = true,
): Promise<{ success: boolean; fields?: InsuranceFields; error?: string }> {
  const form = new FormData();
  form.append("image_file", imageFile);
  form.append("consent_granted", consentGranted ? "true" : "false");
  const { data } = await api.post(`/api/${hospitalId}/scan-insurance`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export async function listPrescriptions(
  hospitalId: string,
  patientId: string,
): Promise<Prescription[]> {
  const { data } = await api.get(`/api/${hospitalId}/patients/${patientId}/prescriptions`);
  return data.prescriptions || [];
}

export async function suggestPrescriptions(
  hospitalId: string,
  patientId: string,
): Promise<PrescriptionSuggestion[]> {
  const { data } = await api.post(
    `/api/${hospitalId}/patients/${patientId}/prescriptions/suggest`,
    {},
  );
  return data.suggestions || [];
}

export async function createPrescription(
  hospitalId: string,
  patientId: string,
  body: Partial<Prescription> & { drug: string }
): Promise<Prescription> {
  const { data } = await api.post(
    `/api/${hospitalId}/patients/${patientId}/prescriptions`,
    body,
  );
  return data.prescription;
}

export async function createNote(
  hospitalId: string,
  patientId: string,
  text: string,
  author = "Clinician"
): Promise<ClinicianNote> {
  const { data } = await api.post(
    `/api/${hospitalId}/patients/${patientId}/notes`,
    { text, author },
  );
  return data.note;
}

export async function publishPatientSummary(
  hospitalId: string,
  patientId: string,
  noteId?: string
): Promise<PatientEducation> {
  const { data } = await api.post(
    `/api/${hospitalId}/patients/${patientId}/publish-summary`,
    noteId ? { note_id: noteId } : {},
  );
  return data.summary;
}

export async function getPublicPatient(
  hospitalId: string,
  patientId: string
): Promise<PublicPatient> {
  const { data } = await api.get<PublicPatient>(
    `/api/${hospitalId}/public-patients/${patientId}`
  );
  return data;
}

export type EHRRecord = {
  mrn: string;
  hospital_id: string;
  name: string;
  dob: string;
  sex: string;
  height_cm: number;
  weight_kg: number;
  bmi: number;
  blood_type: string;
  primary_care_provider: string;
  insurance: string;
  emergency_contact: string;
  allergies: string[];
  medications: string[];
  conditions: string[];
  family_history: string[];
  immunizations: string[];
  social_history: string;
  prior_visits: {
    date: string;
    type: string;
    facility: string;
    chief_complaint: string;
    disposition: string;
    note: string;
  }[];
};

export type EHRLookupResult = {
  record: EHRRecord | null;
  reason?: string;
  match_method?: "insurance_member_id+provider" | "insurance_member_id" | "name_exact";
};

export async function lookupEHR(
  hospitalId: string,
  patientId: string
): Promise<EHRLookupResult> {
  const { data } = await api.get<EHRLookupResult>(
    `/api/${hospitalId}/ehr/lookup-by-patient/${patientId}`
  );
  return data;
}

export async function startIntake(
  hospitalId: string
): Promise<{ token: string; expires_at: number }> {
  const { data } = await api.post(`/api/${hospitalId}/start-intake`);
  return data;
}

export async function loginClinician(
  hospitalId: string,
  clinicianName: string,
  pin: string
): Promise<{
  token: string;
  clinician_id: string;
  name: string;
  role: string;
  hospital_id: string;
  expires_at: number;
}> {
  const { data } = await api.post(`/api/${hospitalId}/auth/login`, {
    clinician_name: clinicianName,
    pin,
  });
  return data;
}

// Passwordless sign-in. Step 1: email a single-use link. The response is
// intentionally generic (no account-enumeration) and may carry `dev_link` in
// local/sandbox mode so the flow is followable without a real mailbox.
export async function requestMagicLink(
  hospitalId: string,
  email: string,
): Promise<{ status: string; message: string; dev_link?: string }> {
  const { data } = await api.post(`/api/${hospitalId}/auth/magic/request`, { email });
  return data;
}

// Step 2: redeem the token from the emailed link for a session.
export async function verifyMagicLink(
  hospitalId: string,
  token: string,
): Promise<{
  token: string;
  clinician_id: string;
  name: string;
  role: string;
  hospital_id: string;
  expires_at: number;
}> {
  const { data } = await api.post(`/api/${hospitalId}/auth/magic/verify`, { token });
  return data;
}

export type EHRVendorOption = {
  id: string;        // "epic" | "cerner" | "athena"
  label: string;
  color: string;
  sandbox: boolean;
};

export async function listEHRVendors(): Promise<EHRVendorOption[]> {
  const { data } = await api.get<{ vendors: EHRVendorOption[] }>("/api/auth/ehr/vendors");
  return data.vendors || [];
}

// Builds the OAuth launch URL — frontend redirects the browser here, which 302s to
// the vendor's authorize endpoint. Mock provider auto-approves; real vendors show
// their hosted login screen.
export function buildEHRLaunchURL(vendorId: string, hospitalId: string, redirectUri: string): string {
  const base =
    import.meta.env.VITE_API_BASE_URL && import.meta.env.VITE_API_BASE_URL !== ""
      ? import.meta.env.VITE_API_BASE_URL
      : "";
  const qs = new URLSearchParams({
    vendor: vendorId,
    hospital_id: hospitalId,
    redirect_uri: redirectUri,
  });
  return `${base}/api/auth/ehr/launch?${qs.toString()}`;
}

export async function whoami(hospitalId: string): Promise<{
  clinician_id: string;
  name: string;
  role: string;
  hospital_id: string;
  auth_method: string;
}> {
  const { data } = await api.get(`/api/${hospitalId}/auth/whoami`);
  return data;
}

export async function resetDemo(
  hospitalId: string,
): Promise<{ deleted_test_patients: string[]; cleared_canonical_patients: string[] }> {
  const { data } = await api.post(
    `/api/${hospitalId}/admin/reset-demo`,
    {},
  );
  return data;
}

// --- Workflows ------------------------------------------------------------------------

export type WorkflowTrigger = {
  name: string;
  label: string;
  description: string;
  sample_context: Record<string, unknown>;
};

export type WorkflowActionField = {
  name: string;
  label: string;
  type: "text" | "textarea";
  required: boolean;
  help?: string;
};

export type WorkflowActionDef = {
  type: string;
  label: string;
  description: string;
  fields: WorkflowActionField[];
};

export type WorkflowTemplate = {
  id: string;
  label: string;
  description: string;
  trigger: string;
};

export type WorkflowStep = {
  type: string;
  config: Record<string, string>;
  stop_on_error?: boolean;
};

export type Workflow = {
  workflow_id: string;
  hospital_id: string;
  name: string;
  trigger: string;
  enabled: boolean;
  filters?: Record<string, unknown>;
  steps: WorkflowStep[];
  fire_count?: number;
  last_fired_at?: string | null;
  created_at?: string;
  updated_at?: string;
  from_template?: string;
};

export async function getWorkflowCatalog(
  hospitalId: string,
): Promise<{
  triggers: WorkflowTrigger[];
  actions: WorkflowActionDef[];
  templates: WorkflowTemplate[];
}> {
  const { data } = await api.get(`/api/${hospitalId}/workflows/catalog`);
  return data;
}

export async function listWorkflows(hospitalId: string): Promise<Workflow[]> {
  const { data } = await api.get<{ workflows: Workflow[] }>(`/api/${hospitalId}/workflows`);
  return data.workflows || [];
}

export async function createWorkflow(
  hospitalId: string,
  body: Omit<Workflow, "workflow_id" | "hospital_id" | "fire_count" | "last_fired_at" | "created_at" | "updated_at" | "from_template">
): Promise<Workflow> {
  const { data } = await api.post(`/api/${hospitalId}/workflows`, body);
  return data.workflow;
}

export async function updateWorkflow(
  hospitalId: string,
  workflowId: string,
  body: Omit<Workflow, "workflow_id" | "hospital_id" | "fire_count" | "last_fired_at" | "created_at" | "updated_at" | "from_template">
): Promise<Workflow> {
  const { data } = await api.put(`/api/${hospitalId}/workflows/${workflowId}`, body);
  return data.workflow;
}

export async function deleteWorkflow(
  hospitalId: string,
  workflowId: string
): Promise<void> {
  await api.delete(`/api/${hospitalId}/workflows/${workflowId}`);
}

export async function testWorkflow(
  hospitalId: string,
  body: { workflow_id?: string; workflow?: Partial<Workflow> }
): Promise<{
  context: Record<string, unknown>;
  results: { step_type: string; result: { success: boolean; reason?: string; message?: string } }[];
}> {
  const { data } = await api.post(`/api/${hospitalId}/workflows/test`, body);
  return data;
}

export async function workflowFromTemplate(
  hospitalId: string,
  templateId: string
): Promise<Workflow> {
  const { data } = await api.post(
    `/api/${hospitalId}/workflows/from-template`,
    { template_id: templateId },
  );
  return data.workflow;
}

// --- Appointments / self-scheduling ---------------------------------------------------

export type AppointmentSlot = {
  iso: string;
  label: string;
  duration_min: number;
};

export type Appointment = {
  appointment_id: string;
  hospital_id: string;
  slot_iso: string;
  patient_name: string;
  patient_phone_hash?: string;  // hashed, not raw — HIPAA §164.514
  reason_short: string;
  status: string;
  confirmation_code: string;
  created_via: string;
};

export async function getAppointmentAvailability(
  hospitalId: string,
  days: number = 7
): Promise<AppointmentSlot[]> {
  const { data } = await api.get<{ slots: AppointmentSlot[] }>(
    `/api/${hospitalId}/appointments/availability`,
    { params: { days } }
  );
  return data.slots || [];
}

export async function bookAppointment(
  hospitalId: string,
  body: { slot_iso: string; patient_name: string; patient_phone: string; reason: string }
): Promise<{ success: boolean; appointment: Appointment }> {
  const { data } = await api.post(`/api/${hospitalId}/appointments/book`, body);
  return data;
}

export async function lookupAppointment(
  hospitalId: string,
  confirmationCode: string
): Promise<Appointment> {
  const { data } = await api.get<Appointment>(
    `/api/${hospitalId}/appointments/${encodeURIComponent(confirmationCode)}`
  );
  return data;
}

export async function cancelAppointment(
  hospitalId: string,
  confirmationCode: string
): Promise<{ success: boolean }> {
  const { data } = await api.post(`/api/${hospitalId}/appointments/cancel`, {
    confirmation_code: confirmationCode,
  });
  return data;
}

// --- SMS ------------------------------------------------------------------------------

export async function sendDischargeSMS(
  hospitalId: string,
  patientId: string,
  phoneOverride?: string
): Promise<{ success: boolean; reason?: string; message?: string }> {
  const { data } = await api.post(
    `/api/${hospitalId}/sms/discharge`,
    { patient_id: patientId, ...(phoneOverride ? { phone: phoneOverride } : {}) },
  );
  return data;
}

export async function sendCareInstructionsSelfServe(
  hospitalId: string,
  patientId: string,
  phone: string
): Promise<{ success: boolean; reason?: string; message?: string }> {
  const { data } = await api.post(`/api/${hospitalId}/sms/care-instructions`, {
    patient_id: patientId,
    phone,
  });
  return data;
}

// --- Care recommendation (already inside intake response) -----------------------------

export type CareRecommendation = {
  destination: "ed_now" | "ed" | "urgent" | "telehealth" | "self_care" | "schedule";
  label: string;
  rationale: string;
  action_cta: string;
  severity: "critical" | "high" | "moderate" | "low";
};

// --- Identity / ID scan ---------------------------------------------------------------

export type IdFields = {
  first_name: string;
  last_name: string;
  dob: string;
  license_number: string;
  issuing_state: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  expiry: string;
  sex: string;
};

export async function scanID(
  hospitalId: string,
  imageFile: File
): Promise<{ success: boolean; fields?: IdFields; error?: string }> {
  const form = new FormData();
  form.append("image_file", imageFile);
  const { data } = await api.post(`/api/${hospitalId}/scan-id`, form, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return data;
}

export type IdentityLookupResult = {
  matched: boolean;
  match_method?: "name+dob" | "name_only" | "fhir_demographics" | "fhir_member_id";
  reason?: string;
  ehr_record?: {
    name: string;
    mrn: string;
    dob: string;
    sex: string;
    fhir_id?: string;
    allergies?: string[];
    medications?: string[];
    conditions?: string[];
    insurance?: string;
    primary_care_provider?: string;
    source?: string;
    prior_visits?: { date: string; type: string; chief_complaint: string; disposition: string }[];
  };
  prefill?: {
    age: number | null;
    sex: "male" | "female" | "other" | null;
    allergies: string[];
    medications: string[];
    conditions: string[];
    insurance_hint: string;
    emergency_contact: string;
    primary_care_provider: string;
    prior_visits_count: number;
  };
};

export type IdentityLookupBody = {
  first_name?: string;
  last_name?: string;
  dob?: string;
  license_number?: string;
  issuing_state?: string;
  insurance_member_id?: string;
  insurance_provider?: string;
};

export async function identityLookup(
  hospitalId: string,
  body: IdentityLookupBody,
): Promise<IdentityLookupResult> {
  const { data } = await api.post<IdentityLookupResult>(
    `/api/${hospitalId}/identity/lookup`,
    body,
  );
  return data;
}

// --- Voice agent ----------------------------------------------------------------------

export type VoiceTurnResponse = {
  call_id: string;
  say: string;
  audio_url: string | null;
  tool?: string | null;
  escalate?: "human" | "911" | null;
};

export async function voiceSimulatorStart(
  hospitalId: string,
  language: string
): Promise<VoiceTurnResponse> {
  const { data } = await api.post<VoiceTurnResponse>(`/api/voice/simulator/start`, {
    hospital_id: hospitalId,
    language,
  });
  return data;
}

export async function voiceSimulatorTurn(
  callId: string,
  text: string
): Promise<VoiceTurnResponse> {
  const { data } = await api.post<VoiceTurnResponse>(`/api/voice/simulator/turn`, {
    call_id: callId,
    text,
  });
  return data;
}

export async function voiceSimulatorEnd(callId: string, disposition = "ended_by_user"): Promise<void> {
  await api.post(`/api/voice/simulator/end`, { call_id: callId, disposition });
}

export type VoiceCallSummary = {
  call_id: string;
  hospital_id: string;
  language: string;
  channel: string;
  status: string;
  intent?: string | null;
  escalation?: string | null;
  disposition?: string | null;
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
  transcript?: { role: string; text: string; ts: string }[];
  tools_called?: { name: string; result_summary: string; ts: string }[];
};

export async function listVoiceCalls(hospitalId: string): Promise<VoiceCallSummary[]> {
  const { data } = await api.get(`/api/voice/calls`, {
    params: { hospital_id: hospitalId },
  });
  return data.calls || [];
}

export async function getVoiceStats(
  hospitalId: string,
): Promise<{ total: number; intents: Record<string, number>; escalations: number; avg_duration_seconds: number }> {
  const { data } = await api.get(`/api/voice/stats`, {
    params: { hospital_id: hospitalId },
  });
  return data;
}

export type VoiceAppointment = {
  appointment_id: string;
  hospital_id: string;
  patient_name: string;
  patient_phone_hash?: string;  // hashed, not raw — HIPAA §164.514
  reason_short: string;
  preferred_window?: string;
  status: string;
  confirmation_code: string;
  created_at: string;
};

export async function listVoiceAppointments(hospitalId: string): Promise<VoiceAppointment[]> {
  const { data } = await api.get(`/api/voice/appointments`, {
    params: { hospital_id: hospitalId },
  });
  return data.appointments || [];
}

export async function refineTriage(
  hospitalId: string,
  patientId: string,
  vitals: Vitals,
): Promise<RefinedTriage> {
  const { data } = await api.post<{ success: boolean; refinement: RefinedTriage; applied_at: string }>(
    `/api/${hospitalId}/patients/${patientId}/refine-triage`,
    vitals,
  );
  return data.refinement;
}

// ============================================================================
// Wave 1+2 — Clinician AI surface
// ============================================================================

export type ScribeSegment = { id: number; speaker: string; begin_ms: number; end_ms: number; content: string };
export type ScribeSection = { name: string; summary: { text: string; evidence_segments: number[] }[] };
export type ScribeOutput = {
  structured: { sections: ScribeSection[]; transcript_segments: ScribeSegment[] };
  soap_text: string;
};

export async function scribeFromTranscript(hospitalId: string, transcript: string): Promise<ScribeOutput> {
  const { data } = await api.post<ScribeOutput>(`/api/${hospitalId}/scribe/from-transcript`, { transcript, refine: true });
  return data;
}

// FHIR write-back — DocumentReference + Conditions + Allergies + Observations
export type EhrWriteResource = "DocumentReference" | "Condition" | "AllergyIntolerance" | "Observation(vital)" | "Observation(social)" | "Immunization";
export type EhrWriteResult = {
  writes: { resource: EhrWriteResource; result: { resourceType?: string; id?: string; url?: string; stored?: string; ok?: boolean } }[];
};
export type EhrWriteBody = {
  patient_ref: string;
  note_text?: string;
  conditions?: { icd10: string; display?: string }[];
  allergies?: { substance: string; reaction?: string; severity?: string }[];
  vitals?: { loinc: string; display: string; value: number; unit: string }[];
  social?: { loinc: string; display: string; text: string }[];
  immunizations?: { cvx: string; display: string }[];
};
export async function ehrWrite(hospitalId: string, body: EhrWriteBody): Promise<EhrWriteResult> {
  const { data } = await api.post<EhrWriteResult>(`/api/${hospitalId}/ehr-write`, body);
  return data;
}

export type DdxItem = {
  diagnosis: string;
  icd10: string;
  weight: number;
  rule_in: string[];
  rule_out: string[];
  must_not_miss: boolean;
  next_step: string;
  evidence_quote: string;
};
export type DdxResult = {
  differential: DdxItem[];
  counterfactuals: { if_true: string; would_change: string }[];
  red_flags: { diagnosis: string; icd10: string }[];
  conformal: { set_90: string[]; set_95: string[] };
};

export async function ddxV2(
  hospitalId: string,
  body: { transcript: string; chief_complaint?: string; specialty?: string; medical_info?: MedicalInfo; vitals?: Vitals }
): Promise<DdxResult> {
  const { data } = await api.post<DdxResult>(`/api/${hospitalId}/ddx/v2`, body);
  return data;
}

export async function listCalculators(hospitalId: string): Promise<{ key: string; name: string; inputs: string[]; applies_when: string[] }[]> {
  const { data } = await api.get(`/api/${hospitalId}/cds/calculators`);
  return data.calculators;
}

/**
 * One auto-extracted clinical calculator. `result` is the calculator's own
 * output shape, which differs per calculator, so it stays unknown and is
 * rendered defensively. `unknown` lists the inputs the extractor could not find.
 */
export type CalculatorSuggestion = {
  key: string;
  name: string;
  result: unknown;
  unknown: string[];
};

export async function calcAutoExtract(
  hospitalId: string,
  transcript: string,
  chief_complaint = "",
): Promise<{ calculators: CalculatorSuggestion[] }> {
  const { data } = await api.post<{ calculators: CalculatorSuggestion[] }>(
    `/api/${hospitalId}/cds/auto-extract`,
    { transcript, chief_complaint },
  );
  return data;
}

export async function calculate(hospitalId: string, key: string, inputs: JsonObject) {
  const { data } = await api.post(`/api/${hospitalId}/cds/calculate`, { key, inputs });
  return data;
}

export async function listScreeners(hospitalId: string) {
  const { data } = await api.get(`/api/${hospitalId}/screeners`);
  return data.screeners as { key: string; name: string; items: string[]; scale: string }[];
}

export async function scoreScreener(hospitalId: string, key: string, body: { items?: number[]; answers?: JsonObject; sex?: string }) {
  const { data } = await api.post(`/api/${hospitalId}/screeners/score`, { key, ...body });
  return data;
}

/** An E/M level candidate (backend/services/em_coding.py `_EM_TABLE`). */
export type EmLevel = {
  code: string;
  level: number;
  mdm: string;
  patient?: string;
};

/** A suggested diagnosis or procedure code with the text that supports it. */
export type CodeCandidate = {
  code: string;
  name: string;
  support?: string;
};

/**
 * The flat, backward-compatible half of the coding response. em_coding.suggest
 * also returns setting, patient_type, em_leveling and em_ranked; add them here as
 * screens start reading them.
 */
export type CodingSuggestResult = {
  mdm?: string;
  em_primary?: EmLevel;
  em_alternate?: EmLevel;
  icd10?: CodeCandidate[];
  cpt_procedures?: CodeCandidate[];
  modifiers?: { modifier: string; reason: string }[];
  established_patient?: boolean;
};

export async function codingSuggest(
  hospitalId: string,
  note_text: string,
  established_patient = true,
): Promise<CodingSuggestResult> {
  const { data } = await api.post<CodingSuggestResult>(
    `/api/${hospitalId}/coding/suggest`,
    { note_text, established_patient },
  );
  return data;
}

// Letters
export async function listLetterTemplates(hospitalId: string) {
  const { data } = await api.get(`/api/${hospitalId}/letters/templates`);
  return data.templates as { key: string; name: string; audience: string; slots: string[] }[];
}

export async function autofillLetter(hospitalId: string, template_key: string, chart_context: JsonObject) {
  const { data } = await api.post(`/api/${hospitalId}/letters/auto-fill`, { template_key, chart_context });
  return data as { slots: Record<string, string>; rendered: string };
}

export async function renderLetter(hospitalId: string, template_key: string, slots: Record<string, string>) {
  const { data } = await api.post(`/api/${hospitalId}/letters/render`, { template_key, slots });
  return data.rendered as string;
}

export async function letterPdfUrl(hospitalId: string, template_key: string, slots: Record<string, string>) {
  const resp = await api.post(`/api/${hospitalId}/letters/pdf`, { template_key, slots }, { responseType: "blob" });
  return URL.createObjectURL(resp.data as Blob);
}

// Inbox draft + result triage
/**
 * Shared head of the inbox drafting responses (backend/services/inbox_drafts.py).
 * requires_clinician_review is always true: the FDA human-in-the-loop carve-out
 * means nothing here is ever auto-sendable.
 */
export type InboxDraftBase = {
  draft: string;
  urgency: "routine" | "same_day" | "emergent" | "crisis";
  requires_clinician_review: boolean;
  grounding?: { claim: string; cited_field: string }[];
  ungrounded_claims?: { claim: string; reason: string }[];
  grounded_ratio?: number;
  send_envelope?: JsonObject;
};

export type InboxDraftResult = InboxDraftBase & {
  red_flags: string[];
  red_flag_detail?: { label: string; urgency_floor: string }[];
  tone: string;
  suggested_action: "send_after_review" | "escalate_now" | "call_patient";
  chart_fields_available?: string[];
};

export async function inboxDraft(
  hospitalId: string,
  inbound_message: string,
  patient_chart: JsonObject = {},
  hospital_name = "our clinic",
): Promise<InboxDraftResult> {
  const { data } = await api.post<InboxDraftResult>(`/api/${hospitalId}/inbox/draft`, {
    inbound_message,
    patient_chart,
    hospital_name,
  });
  return data;
}

/** Abnormal-result message draft. `classification` is the classify_lab payload. */
export type AbnormalResultDraft = InboxDraftBase & {
  classification: JsonObject;
};

export async function abnormalResultDraft(
  hospitalId: string,
  lab_name: string,
  value: number,
  recommended_action = "",
): Promise<AbnormalResultDraft> {
  const { data } = await api.post<AbnormalResultDraft>(
    `/api/${hospitalId}/inbox/result-draft`,
    { lab_name, value, recommended_action },
  );
  return data;
}

// Refills
/** backend/services/refills.py; labs_to_order is present on needs_labs only. */
export type RefillTriageResult = {
  decision: "protocol_approved" | "needs_visit" | "needs_labs" | "physician_required";
  reason: string;
  rationale_codes: string[];
  rationale_detail: { code: string; message: string }[];
  patient_message: string;
  labs_to_order?: string[];
  auto_approved: boolean;
  requires_clinician_review: boolean;
  send_envelope?: JsonObject;
  audited?: boolean;
};

export async function refillTriage(
  hospitalId: string,
  body: {
    medication_canonical: string;
    last_visit_iso?: string;
    relevant_lab_iso?: string;
    relevant_lab_value?: number;
    recent_hospitalization?: boolean;
  },
): Promise<RefillTriageResult> {
  const { data } = await api.post<RefillTriageResult>(`/api/${hospitalId}/refills/triage`, body);
  return data;
}

// PA packets
export type PaSubmissionChannel = { channel: string; status: string };

/**
 * Prior-auth packet plus its Da Vinci FHIR Claim. The packet body is assembled
 * per payer, so only the parts the UI reads are pinned down here.
 */
export type PaPacketResult = {
  packet: JsonObject & {
    submission_channels?: PaSubmissionChannel[];
    narrative?: JsonObject & { clinical_rationale?: string };
  };
  fhir_claim: unknown;
};

export async function paPacket(hospitalId: string, body: JsonObject): Promise<PaPacketResult> {
  const { data } = await api.post<PaPacketResult>(`/api/${hospitalId}/pa/packet`, body);
  return data;
}

// Drug check
/** One drug-drug interaction: `a` and `b` are the interacting medications. */
export type DrugDrugAlert = {
  a: string;
  b: string;
  severity: string;
  reason: string;
};

export type DrugAllergyAlert = { med: string; allergy?: string };

export type DrugCheckResult = {
  drug_drug: DrugDrugAlert[];
  drug_allergy: DrugAllergyAlert[];
  any_high?: boolean;
};

export async function drugCheck(
  hospitalId: string,
  meds: string[],
  allergies: string[] = [],
  egfr?: number,
  complaint = "",
): Promise<DrugCheckResult> {
  const { data } = await api.post<DrugCheckResult>(`/api/${hospitalId}/drug-check`, {
    meds,
    allergies,
    egfr,
    complaint,
  });
  return data;
}

// Discharge plan
/** backend/services/discharge_plan.py. `summary` is a patient-education block. */
export type DischargePlanResult = {
  language: string;
  summary?: {
    headline?: string;
    what_we_are_doing?: string;
  } & JsonObject;
  red_flags?: string[];
  follow_up_text?: string;
  sms_body?: string;
};

export async function buildDischarge(
  hospitalId: string,
  body: JsonObject,
): Promise<DischargePlanResult> {
  const { data } = await api.post<DischargePlanResult>(`/api/${hospitalId}/discharge/build`, body);
  return data;
}

// Specialty packs
export async function listSpecialtyPacks(hospitalId: string) {
  const { data } = await api.get(`/api/${hospitalId}/specialty/packs`);
  return data.packs as { key: string; name: string }[];
}

// Care ops
export async function eligibilityCheck(hospitalId: string, body: { payer_name: string; member_id: string; patient_first: string; patient_last: string; patient_dob: string }) {
  const { data } = await api.post(`/api/${hospitalId}/eligibility/check`, body);
  return data;
}

export async function noShowPredict(hospitalId: string, body: JsonObject) {
  const { data } = await api.post(`/api/${hospitalId}/no-show/predict`, body);
  return data;
}

export async function careGapsAdHoc(hospitalId: string, patient: JsonObject) {
  const { data } = await api.post(`/api/${hospitalId}/care-gaps/evaluate`, { patient });
  return data.gaps as JsonObject[];
}

export async function sdohPrapare(hospitalId: string, answers: JsonObject) {
  const { data } = await api.post(`/api/${hospitalId}/sdoh/prapare`, { answers });
  return data;
}

export async function ehrLocalResources(hospitalId: string) {
  const { data } = await api.get(`/api/${hospitalId}/ehr-write/local`);
  return data.resources as JsonObject[];
}

// AI override audit
export async function recordAiOverride(hospitalId: string, body: { purpose: string; decision: string; patient_id?: string; diff_chars?: number; notes?: string; model_name?: string }) {
  const { data } = await api.post(`/api/${hospitalId}/ai-override`, body);
  return data;
}

// Public — model cards
export async function listModelCards() {
  const { data } = await api.get(`/api/model-cards`);
  return data.cards as { id: string; name: string; version: string }[];
}

export async function getModelCard(card_id: string) {
  const { data } = await api.get(`/api/model-cards/${card_id}`);
  return data;
}

// ============================================================================
// Wave 3 — Evidence RAG, EWS, HCC, Handoffs, Loop closure
// ============================================================================

export async function evidenceAnswer(hospitalId: string, question: string, k = 6) {
  const { data } = await api.post(`/api/${hospitalId}/evidence/answer`, { question, k });
  return data as {
    question: string;
    snippets: { index: number; title: string; body: string; source: string; year: number; url: string; score: number }[];
    answer: string;
    key_recommendations: string[];
    uncertainty: string;
  };
}

export type EwsContribution = { feature: string; points: number; why: string; source?: string };

/** Shared head of both early-warning responses (backend/services/early_warning.py). */
export type EwsResult = {
  score: number;
  band: string;
  action: string;
  contributions: EwsContribution[];
};

/**
 * Sepsis EWS also carries the provenance blurb the UI renders under the score.
 * The endpoint returns more besides (qsofa, sirs, sofa_organ_proxies,
 * map_estimate, risk_interval, provenance); add them as screens consume them.
 */
export type SepsisEwsResult = EwsResult & { calibration_note: string };

export async function sepsisEws(hospitalId: string, vitals: JsonObject): Promise<SepsisEwsResult> {
  const { data } = await api.post<SepsisEwsResult>(`/api/${hospitalId}/ews/sepsis`, vitals);
  return data;
}

export async function deteriorationIndex(hospitalId: string, body: JsonObject): Promise<EwsResult> {
  const { data } = await api.post<EwsResult>(`/api/${hospitalId}/ews/deterioration`, body);
  return data;
}

export type HccDocumented = {
  hcc_code: string;
  description: string;
  raf: number;
  last_documented_year: number;
  needs_recapture: boolean;
};

export type HccSuspected = {
  icd10: string;
  display: string;
  evidence_quote: string;
};

/**
 * The subset of /hcc/evaluate that the UI reads. The endpoint also returns
 * suppressed_hccs, needs_recapture, recapture_worklist and raf_at_risk (see
 * backend/services/hcc_capture.py); add them here as screens start using them.
 */
export type HccEvaluateResult = {
  current_year: number;
  raf_total: number;
  documented_hccs: HccDocumented[];
  suspected_undocumented: HccSuspected[];
  meat_checklist: string[];
};

export async function hccEvaluate(
  hospitalId: string,
  body: { conditions: JsonObject[]; prior_notes?: string[]; current_year?: number },
): Promise<HccEvaluateResult> {
  const { data } = await api.post<HccEvaluateResult>(`/api/${hospitalId}/hcc/evaluate`, body);
  return data;
}

/**
 * Both handoff responses share this envelope (backend/services/handoff.py):
 * `available` false means no model key or a parse failure and nothing else is
 * present; otherwise the model's structured JSON is merged in and
 * `rendered_text` carries the formatted version the UI displays.
 */
export type HandoffEnvelope = {
  available: boolean;
  reason?: string;
  error?: string;
  context_gaps?: string[];
  rendered_text?: string;
};

export type HandoffIpassResult = HandoffEnvelope & {
  illness_severity?: "stable" | "watcher" | "unstable";
  severity_rationale?: string;
  patient_summary?: string;
  action_list?: {
    action: string;
    priority: "critical" | "routine" | "if-needed";
    by_when: string;
    responsible: string;
    contingency: string;
  }[];
  situation_awareness?: string;
};

export async function handoffIpass(
  hospitalId: string,
  chart_context: JsonObject,
): Promise<HandoffIpassResult> {
  const { data } = await api.post<HandoffIpassResult>(
    `/api/${hospitalId}/handoff/ipass`,
    { chart_context },
  );
  return data;
}

export type HandoffSbarResult = HandoffEnvelope & {
  situation?: string;
  background?: string;
  assessment?: string;
  recommendation?: string;
  urgency?: "emergent" | "urgent" | "routine";
  specific_questions?: string[];
};

export async function handoffSbar(
  hospitalId: string,
  chart_context: JsonObject,
  consult_specialty = "cardiology",
  reason = "",
): Promise<HandoffSbarResult> {
  const { data } = await api.post<HandoffSbarResult>(
    `/api/${hospitalId}/handoff/sbar`,
    { chart_context, consult_specialty, reason },
  );
  return data;
}

export async function scribeRedact(hospitalId: string, segments: JsonObject[]) {
  const { data } = await api.post(`/api/${hospitalId}/scribe/redact`, { segments });
  return data;
}

export async function resultLoopOpen(hospitalId: string, body: { patient_id: string; test_name: string; value: string; severity?: string; sla_days?: number }) {
  const { data } = await api.post(`/api/${hospitalId}/result-loop/open`, body);
  return data;
}

export async function resultLoopClose(hospitalId: string, tracking_id: string, action: string) {
  const { data } = await api.post(`/api/${hospitalId}/result-loop/close`, { tracking_id, action });
  return data;
}

/**
 * One open result-loop entry, plus the derived days_overdue the worklist adds.
 * Mirrors backend/services/redaction.py (track entry + overdue_worklist).
 */
export type ResultLoopOverdueItem = {
  tracking_id: string;
  hospital_id: string;
  patient_id: string;
  clinician_id: string;
  test_name: string;
  value: string;
  severity: string;
  opened_at: string;
  sla_days: number;
  closed_at: string | null;
  closed_by: string | null;
  close_action: string | null;
  days_overdue: number;
};

export async function resultLoopOverdue(hospitalId: string): Promise<ResultLoopOverdueItem[]> {
  const { data } = await api.get<{ items: ResultLoopOverdueItem[] }>(
    `/api/${hospitalId}/result-loop/overdue`,
  );
  return data.items;
}

// ============================================================================
// Wave 4 — HL7 v2, multi-encounter, fax, sepsis bundle, cohort, portal,
// nurse triage, TEFCA, telehealth, style learning, MedicationStatement
// ============================================================================

export type Hl7MdmRenderResult = {
  hl7_message: string;
  /** The same message wrapped in an MLLP frame, base64 encoded. */
  mllp_frame_b64: string;
};

export async function hl7MdmRender(hospitalId: string, body: JsonObject): Promise<Hl7MdmRenderResult> {
  const { data } = await api.post<Hl7MdmRenderResult>(`/api/${hospitalId}/hl7/mdm/render`, body);
  return data;
}

/**
 * Multi-encounter stitch (backend/services/multi_encounter.py). `available`
 * gates the whole payload: false means no input or no model key, and only
 * reason/error are present. The rest is the model's JSON, spread onto the same
 * object by the service.
 */
export type EncounterStitchResult = {
  available: boolean;
  reason?: string;
  error?: string;
  encounter_threads?: unknown;
  narrative_summary?: string;
  threads?: {
    thread_id: string;
    chief_complaint: string;
    trajectory: string;
    summary: string;
  }[];
  active_problems?: {
    problem: string;
    first_documented: string;
    last_status: string;
    notes: string;
  }[];
  interventions_tried?: {
    intervention: string;
    outcome: string;
    thread_id: string;
  }[];
  open_questions_for_clinician?: string[];
};

export async function encounterStitch(
  hospitalId: string,
  notes: JsonObject[],
): Promise<EncounterStitchResult> {
  const { data } = await api.post<EncounterStitchResult>(
    `/api/${hospitalId}/encounter/stitch`,
    { notes },
  );
  return data;
}

/**
 * Ward-huddle parse. Like the stitch result, `available` gates everything, and
 * the model's JSON is spread onto the object, so the extra keys are open.
 */
export type EncounterHuddleResult = {
  available: boolean;
  reason?: string;
  error?: string;
  speaker_count?: number;
  [key: string]: unknown;
};

export async function encounterHuddle(
  hospitalId: string,
  transcript: string,
  ward_context = "",
): Promise<EncounterHuddleResult> {
  const { data } = await api.post<EncounterHuddleResult>(
    `/api/${hospitalId}/encounter/huddle`,
    { transcript, ward_context },
  );
  return data;
}

export async function faxIntake(hospitalId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post(`/api/${hospitalId}/fax/intake`, form, { headers: { "Content-Type": "multipart/form-data" } });
  return data;
}

/** One SEP-1 bundle element (backend/services/sepsis_bundle.py). */
export type SepsisBundleElement = {
  id: string;
  name: string;
  completed: boolean;
  /** Absent on elements that are always required. */
  required?: boolean;
  /** Minutes from sepsis recognition, or null when the step has no timestamp. */
  minutes: number | null;
  dose?: number | null;
};

export type SepsisBundleResult = {
  sepsis_recognition_iso: string;
  deadline_iso: string;
  elements: SepsisBundleElement[];
  compliance_rate: number;
  all_complete: boolean;
};

export async function sepsisBundleEvaluate(
  hospitalId: string,
  body: JsonObject,
): Promise<SepsisBundleResult> {
  const { data } = await api.post<SepsisBundleResult>(
    `/api/${hospitalId}/sepsis/bundle/evaluate`,
    body,
  );
  return data;
}

export async function cohortKickoff(hospitalId: string, body: JsonObject) {
  const { data } = await api.post(`/api/${hospitalId}/cohort/export/kickoff`, body);
  return data;
}

export async function cohortPoll(hospitalId: string, content_location: string) {
  const { data } = await api.get(`/api/${hospitalId}/cohort/export/poll`, { params: { content_location } });
  return data;
}

/**
 * De-identified cohort result (backend/services/cohort_export.py). The async
 * export path returns status/manifest instead of inline rows, so both are
 * optional. Patient rows are Safe-Harbor de-identified and their columns vary
 * with the query, hence JsonObject.
 */
export type CohortQueryResult = {
  count?: number;
  patients?: JsonObject[];
  deidentified?: string;
  status?: string;
  manifest?: unknown;
};

export async function cohortQuery(hospitalId: string, body: JsonObject): Promise<CohortQueryResult> {
  const { data } = await api.post<CohortQueryResult>(`/api/${hospitalId}/cohort/query`, body);
  return data;
}

export async function insuranceOcrChain(hospitalId: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  const { data } = await api.post(`/api/${hospitalId}/insurance/ocr-to-eligibility`, form, { headers: { "Content-Type": "multipart/form-data" } });
  return data;
}

export async function medReconciliationWrite(hospitalId: string, patient_ref: string, medications: string[]) {
  const { data } = await api.post(`/api/${hospitalId}/ehr-write/medication-statements`, { patient_ref, medications });
  return data;
}

export async function recordStylePair(hospitalId: string, body: { ai_draft: string; final: string; section?: string }) {
  const { data } = await api.post(`/api/${hospitalId}/style/record-pair`, body);
  return data;
}

export async function styleProfile(hospitalId: string) {
  const { data } = await api.get(`/api/${hospitalId}/style/profile`);
  return data;
}

export async function portalInbound(hospitalId: string, patient_id: string, body: string, sender_name = "Patient") {
  const { data } = await api.post(`/api/${hospitalId}/portal/inbound`, { patient_id, body, sender_name });
  return data;
}

/** Thread summary row (backend/services/portal_messages.py list_threads). */
export type PortalThreadSummary = {
  thread_key: string;
  hospital_id: string;
  patient_id: string;
  message_count: number;
  unread_count: number;
  last_message_at: string | null;
};

/**
 * One portal message. Inbound and outbound share a head; the AI-draft and read
 * fields only ever populate on inbound, so they are optional here.
 */
export type PortalMessage = {
  id: string;
  thread_key: string;
  hospital_id: string;
  patient_id: string;
  direction: "inbound" | "outbound";
  sender_name: string;
  body: string;
  tags: string[];
  created_at: string;
  routing?: string;
  ai_draft?: string | null;
  ai_draft_status?: "pending" | "accepted" | "edited" | "rejected" | null;
  read_by_clinician_at?: string | null;
  read_by_patient_at?: string | null;
  outbound_reply?: string | null;
  outbound_at?: string | null;
  in_reply_to?: string;
};

export async function portalThreads(
  hospitalId: string,
  only_unread = false,
): Promise<PortalThreadSummary[]> {
  const { data } = await api.get<{ threads: PortalThreadSummary[] }>(
    `/api/${hospitalId}/portal/threads`,
    { params: { only_unread } },
  );
  return data.threads;
}

export async function portalThread(
  hospitalId: string,
  thread_key: string,
): Promise<PortalMessage[]> {
  const { data } = await api.get<{ messages: PortalMessage[] }>(
    `/api/${hospitalId}/portal/thread/${encodeURIComponent(thread_key)}`,
  );
  return data.messages;
}

export async function portalRespond(hospitalId: string, message_id: string, body: string, ai_draft_status = "edited") {
  const { data } = await api.post(`/api/${hospitalId}/portal/respond`, { message_id, body, ai_draft_status });
  return data;
}

export async function nurseTriageProtocols(hospitalId: string) {
  const { data } = await api.get(`/api/${hospitalId}/nurse-triage/protocols`);
  return data.protocols as string[];
}

/** backend/services/nurse_triage.py `_result`. */
export type NurseTriageResult = {
  disposition: string;
  reason: string;
  sla: string;
  instructions: string;
};

export async function nurseTriageEvaluate(
  hospitalId: string,
  protocol_key: string,
  answers: JsonObject,
): Promise<NurseTriageResult> {
  const { data } = await api.post<NurseTriageResult>(
    `/api/${hospitalId}/nurse-triage/evaluate`,
    { protocol_key, answers },
  );
  return data;
}

/**
 * TEFCA/QHIN response. The UI only renders it as raw JSON, and the payload
 * mirrors whatever the responding QHIN sends, so it stays deliberately open.
 */
export type TefcaQueryResult = JsonObject;

export async function tefcaQuery(
  hospitalId: string,
  patient_name: string,
  patient_dob: string,
  consent_attestation = true,
): Promise<TefcaQueryResult> {
  const { data } = await api.post<TefcaQueryResult>(
    `/api/${hospitalId}/tefca/query`,
    { patient_name, patient_dob, consent_attestation },
  );
  return data;
}

export type TelehealthProvider = "doxy" | "zoom" | "teams" | "doximity";

/**
 * Telehealth join details. Fields beyond provider/url differ per vendor
 * (backend/services/telehealth.py): doxy adds patient_message, zoom a passcode,
 * doximity from/to numbers.
 */
export type TelehealthSessionResult = {
  provider: string;
  url: string;
  patient_message?: string;
  passcode?: string;
  from?: string;
  to?: string;
};

export async function telehealthSession(
  hospitalId: string,
  body: JsonObject,
): Promise<TelehealthSessionResult> {
  const { data } = await api.post<TelehealthSessionResult>(
    `/api/${hospitalId}/telehealth/session`,
    body,
  );
  return data;
}

// ---- Hospital workspace provisioning ----------------------------------------
export type ProvisionedHospital = {
  hospital_id: string;
  slug: string;
  name: string;
  onboarded?: boolean;
  admin_invited?: boolean;
  admin_dev_link?: string; // local/sandbox only
  clinician_path: string;
  patient_path: string;
  clinician_url: string;
  patient_url: string;
};

export async function provisionHospital(
  name: string,
  requestedSlug?: string,
  adminEmail?: string,
  adminName?: string,
): Promise<ProvisionedHospital> {
  const { data } = await api.post<ProvisionedHospital>("/hospitals/provision", {
    name,
    requested_slug: requestedSlug || undefined,
    admin_email: adminEmail || undefined,
    admin_name: adminName || undefined,
  });
  return data;
}

// ---- Onboarding wizard + team management (admin) ----------------------------
export type OnboardingStatus = {
  hospital_id: string;
  name: string;
  onboarded: boolean;
  team_size: number;
  pending_requests: number;
  patient_url: string;
};

export type CareTeamMember = {
  clinician_id: string;
  name: string;
  email: string;
  role: string;
  last_login_at: string | null;
};

export type AccessRequest = {
  request_id: string;
  email: string;
  name: string;
  note?: string;
  created_at: string;
};

export async function getOnboarding(hospitalId: string): Promise<OnboardingStatus> {
  const { data } = await api.get(`/api/${hospitalId}/onboarding`);
  return data;
}

export async function completeOnboarding(hospitalId: string): Promise<{ status: string }> {
  const { data } = await api.post(`/api/${hospitalId}/onboarding/complete`);
  return data;
}

export async function inviteTeammate(
  hospitalId: string,
  email: string,
  name: string,
  role: string,
): Promise<{ status: string; email: string; role: string; dev_link?: string }> {
  const { data } = await api.post(`/api/${hospitalId}/invites`, { email, name, role });
  return data;
}

export async function listCareTeam(hospitalId: string): Promise<{ members: CareTeamMember[]; count: number }> {
  const { data } = await api.get(`/api/${hospitalId}/care-team`);
  return data;
}

export async function listAccessRequests(hospitalId: string): Promise<{ requests: AccessRequest[] }> {
  const { data } = await api.get(`/api/${hospitalId}/access-requests`);
  return data;
}

export async function approveAccessRequest(
  hospitalId: string,
  requestId: string,
): Promise<{ status: string; email: string; dev_link?: string }> {
  const { data } = await api.post(`/api/${hospitalId}/access-requests/${requestId}/approve`);
  return data;
}

export async function denyAccessRequest(hospitalId: string, requestId: string): Promise<{ status: string }> {
  const { data } = await api.post(`/api/${hospitalId}/access-requests/${requestId}/deny`);
  return data;
}

// ---------------------------------------------------------------------------
// Public governance — the Solace Trust Report. Aggregate-only, no auth, no PHI.
// Mirrors backend/services/model_cards.trust_report().
// ---------------------------------------------------------------------------
export interface TrustReportCalibration {
  model_id: string;
  method: string;
  target_coverage: number | null;
  provenance: string;
  labels_are_real_clinical_outcomes: boolean;
  status: "available" | "unavailable";
  note: string;
  q_hat_by_esi: Record<string, number> | null;
  representative_q_hat?: number;
  calibration_source?: string;
  calibration_n_per_class?: Record<string, number>;
  empirical_coverage: {
    overall: number;
    by_esi: Record<string, number>;
    avg_set_size: number;
    n: number;
    evaluation: string;
  } | null;
}

export interface TrustReportFairnessModel {
  model_id: string;
  name: string;
  risk_tier: string | null;
  subgroup_audit_applicable: boolean;
  groups_audited: string[];
  demographic_performance_status: string | null;
  equity_note?: string | null;
}

export interface TrustReportOverrideAcceptance {
  scope: string;
  source: string;
  total_decisions: number;
  by_purpose: Record<
    string,
    { total: number; accept_rate: number; edit_rate: number; reject_rate: number }
  >;
  definition: Record<string, string>;
  phi_note: string;
}

// AI Bill-of-Materials — every model, version, provider, purpose, data-handling
// posture. Mirrors backend/services/model_cards.ai_bom().
export interface AiBomComponent {
  component_id: string;
  kind: string;
  name: string;
  configured_model: string | null;
  bedrock_inference_profile: string | null;
  version_source: string;
  provider: {
    default: string;
    baa_covered: boolean;
    baa_basis: string;
    opt_in_fallback: string | null;
  };
  purpose: string;
  data_handling: Record<string, string>;
  model_card?: string;
  evidence: string[];
}

export interface AiBom {
  artifact: string;
  spec_alignment: string;
  as_of: string;
  default_provider_posture: string;
  resolved_models: Record<string, unknown>;
  components: AiBomComponent[];
  data_handling_controls: Record<
    string,
    { control: string; evidence: string; families_redacted?: string[]; family_count?: number }
  >;
  disclosure: string;
}

// AI threat-control / safety attestation pack. Mirrors
// backend/services/model_cards.attestation_pack().
export interface AttestationControl {
  control_id: string;
  title: string;
  statement: string;
  mitigates_threat: string;
  maturity: string;
  maturity_definition: string | null;
  framework_refs: string[];
  evidence: string[];
  honest_caveat?: string;
}

export interface AttestationPack {
  artifact: string;
  as_of: string;
  frameworks: string[];
  control_count: number;
  maturity_legend: Record<string, string>;
  maturity_distribution: Record<string, number>;
  controls: AttestationControl[];
  honesty_statement: string;
}

export interface TrustReport {
  report: string;
  framework: string;
  as_of: string;
  preliminary: boolean;
  data_provenance: string;
  disclaimer: string;
  scope: string;
  model_inventory: {
    count: number;
    models: { id: string; name: string; version: string; risk_tier: string | null }[];
  };
  ai_bom: AiBom;
  attestation_pack: AttestationPack;
  calibration: TrustReportCalibration;
  fairness: {
    framework: string;
    models: TrustReportFairnessModel[];
    data_status: string;
    provenance: string;
    disclosure: string;
  };
  override_acceptance: TrustReportOverrideAcceptance;
  endpoints: Record<string, string>;
}

export async function getTrustReport(): Promise<TrustReport> {
  const { data } = await api.get<TrustReport>("/api/governance/trust-report");
  return data;
}

export async function getAiBom(): Promise<AiBom> {
  const { data } = await api.get<AiBom>("/api/governance/ai-bom");
  return data;
}

export async function getAttestationPack(): Promise<AttestationPack> {
  const { data } = await api.get<AttestationPack>("/api/governance/attestation-pack");
  return data;
}

// The full RFP/procurement bundle — Trust Report + AI-BOM + attestation pack.
export interface RfpExport {
  artifact: string;
  as_of: string;
  scope: string;
  preliminary: boolean;
  disclaimer: string;
  contents: string[];
  trust_report: TrustReport;
  ai_bom: AiBom;
  attestation_pack: AttestationPack;
  endpoints: Record<string, string>;
}

export async function getRfpExport(): Promise<RfpExport> {
  const { data } = await api.get<RfpExport>("/api/governance/rfp-export");
  return data;
}

// Public request-to-join (used on the landing "Join" path when not yet invited).
export async function requestAccess(
  hospitalId: string,
  email: string,
  name: string,
  note?: string,
): Promise<{ status: string; message: string }> {
  const { data } = await api.post(`/api/${hospitalId}/access-requests`, { email, name, note });
  return data;
}
