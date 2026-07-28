import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Activity, Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { usePatientWorkspace } from "../PatientWorkspaceContext";
import { deteriorationIndex, sepsisEws } from "../../../lib/api";
import type { EwsContribution, EwsResult, SepsisEwsResult } from "../../../lib/api";
import type { Vitals } from "../../../types";

/**
 * Early warning on the patient in front of you.
 *
 * The same two engines are reachable from the standalone tool bench, but there
 * they start from a form of typed-in numbers, which is backwards when the
 * patient's vitals are already on the chart. This card seeds every input it can
 * from `measured_vitals` and asks only for the four things the chart genuinely
 * cannot know: WBC, lactate, supplemental oxygen, and whether infection is
 * suspected.
 *
 * Missing inputs are shown rather than defaulted, because the backend widens its
 * uncertainty for each absent value and a score built on four blanks should not
 * look as trustworthy as one built on a full set.
 */

/** `measured_vitals` is stored as a JSON string of the Vitals shape. */
function parseVitals(raw: string | null | undefined): Vitals | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Vitals;
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

const BAND_TONE: Record<string, string> = {
  low: "bg-success/15 text-success ring-success/30",
  moderate: "bg-warning/15 text-warning ring-warning/30",
  medium: "bg-warning/15 text-warning ring-warning/30",
  high: "bg-error/15 text-error ring-error/30",
  critical: "bg-error text-white ring-error",
};

function bandTone(band: string): string {
  return BAND_TONE[(band || "").toLowerCase()] || "bg-surface-low text-ink ring-line";
}

function ScoreCard({
  title,
  Icon,
  result,
}: {
  title: string;
  Icon: typeof Activity;
  result: EwsResult | SepsisEwsResult;
}) {
  return (
    <div className="rounded-lg bg-surface-lowest shadow-card p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          <Icon className="w-3.5 h-3.5" aria-hidden />
          {title}
        </div>
        <span
          className={`text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded ring-1 ${bandTone(result.band)}`}
        >
          {result.band}
        </span>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-bold tracking-editorial text-ink">{result.score}</span>
        <span className="text-xs text-text-muted">points</span>
      </div>

      <p className="text-sm text-ink leading-relaxed">{result.action}</p>

      {result.contributions.length > 0 && (
        <div className="divide-y divide-line">
          {result.contributions.map((c: EwsContribution, i: number) => (
            <div key={i} className="py-1.5 first:pt-0 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-ink">{c.feature}</span>
                <span className="font-semibold text-ink shrink-0">+{c.points}</span>
              </div>
              <div className="text-xs text-text-muted mt-0.5">{c.why}</div>
            </div>
          ))}
        </div>
      )}

      {"calibration_note" in result && result.calibration_note && (
        <p className="text-[11px] text-text-muted leading-relaxed border-t border-line pt-2">
          {result.calibration_note}
        </p>
      )}
    </div>
  );
}

export default function EarlyWarningTab() {
  // Both engines score a vitals payload rather than a patient id, so the record
  // is read for its vitals and no patientId is sent.
  const { hospitalId, patient, loading, error } = usePatientWorkspace();

  // Clinician-supplied inputs. Left undefined rather than defaulted so a blank
  // is reported as missing instead of silently scoring as a normal value.
  const [wbc, setWbc] = useState<string>("");
  const [lactate, setLactate] = useState<string>("");
  const [onOxygen, setOnOxygen] = useState(false);
  const [suspectedInfection, setSuspectedInfection] = useState(false);

  const [sepsis, setSepsis] = useState<SepsisEwsResult | null>(null);
  const [deterioration, setDeterioration] = useState<EwsResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const vitals = useMemo(() => parseVitals(patient?.measured_vitals), [patient?.measured_vitals]);

  /** Chart-derived half of the payload, plus what the chart cannot supply. */
  const payload = useMemo(() => {
    const num = (s: string) => (s.trim() === "" ? undefined : Number(s));
    return {
      hr: vitals?.heart_rate ?? undefined,
      rr: vitals?.respiratory_rate ?? undefined,
      temp_c: vitals?.temperature_c ?? undefined,
      sbp: vitals?.systolic_bp ?? undefined,
      spo2: vitals?.spo2 ?? undefined,
      gcs: vitals?.gcs_total ?? undefined,
      mental_status: vitals?.mental_status ?? undefined,
      wbc: num(wbc),
      lactate: num(lactate),
      on_oxygen: onOxygen,
      suspected_infection: suspectedInfection,
    };
  }, [vitals, wbc, lactate, onOxygen, suspectedInfection]);

  /** Inputs the engines weight that we still have nothing for. */
  const missing = useMemo(() => {
    const labels: Record<string, string> = {
      hr: "heart rate",
      rr: "respiratory rate",
      temp_c: "temperature",
      sbp: "systolic BP",
      spo2: "SpO2",
      wbc: "WBC",
      lactate: "lactate",
    };
    return Object.entries(labels)
      .filter(([k]) => payload[k as keyof typeof payload] === undefined)
      .map(([, label]) => label);
  }, [payload]);

  const run = useCallback(async () => {
    setBusy(true);
    setRunError(null);
    try {
      const [s, d] = await Promise.all([
        sepsisEws(hospitalId, payload),
        deteriorationIndex(hospitalId, payload),
      ]);
      setSepsis(s);
      setDeterioration(d);
    } catch (e) {
      const detail =
        (e as { response?: { data?: { detail?: string } }; message?: string })?.response?.data
          ?.detail ||
        (e as { message?: string })?.message ||
        "Could not run the early-warning engines.";
      setRunError(detail);
    } finally {
      setBusy(false);
    }
  }, [hospitalId, payload]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 justify-center text-text-muted text-sm">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> Loading patient…
      </div>
    );
  }
  if (error || !patient) {
    return (
      <div className="py-6 text-sm text-error">
        {error || "Patient record unavailable."}
      </div>
    );
  }

  const inputClass =
    "w-full h-9 px-3 rounded-md bg-surface-low ring-1 ring-line focus:ring-2 focus:ring-primary text-sm text-ink outline-none transition-all";

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-lg bg-surface-lowest shadow-card p-4 flex flex-col gap-3">
        <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
          Inputs
        </div>

        {vitals ? (
          <div className="flex flex-wrap gap-1.5">
            {[
              ["HR", vitals.heart_rate],
              ["RR", vitals.respiratory_rate],
              ["Temp", vitals.temperature_c],
              ["SBP", vitals.systolic_bp],
              ["SpO2", vitals.spo2],
              ["GCS", vitals.gcs_total],
            ]
              .filter(([, v]) => v !== null && v !== undefined)
              .map(([label, v]) => (
                <span
                  key={String(label)}
                  className="text-[11px] font-medium px-2 py-1 rounded bg-surface-low ring-1 ring-line text-ink"
                >
                  {label} {String(v)}
                </span>
              ))}
          </div>
        ) : (
          <p className="text-sm text-text-muted leading-relaxed">
            No vitals recorded on this chart yet. Record them on the patient snapshot and
            they will seed these scores automatically.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
              WBC
            </span>
            <input
              type="number"
              step="0.1"
              value={wbc}
              onChange={(e) => setWbc(e.target.value)}
              placeholder="not drawn"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
              Lactate
            </span>
            <input
              type="number"
              step="0.1"
              value={lactate}
              onChange={(e) => setLactate(e.target.value)}
              placeholder="not drawn"
              className={inputClass}
            />
          </label>
        </div>

        <div className="flex flex-wrap gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={suspectedInfection}
              onChange={(e) => setSuspectedInfection(e.target.checked)}
            />
            Infection suspected
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={onOxygen}
              onChange={(e) => setOnOxygen(e.target.checked)}
            />
            On supplemental oxygen
          </label>
        </div>

        {missing.length > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-warning-container/40 p-2.5 text-[11px] text-ink leading-relaxed">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-warning mt-0.5" aria-hidden />
            <span>
              Scoring without {missing.join(", ")}. Each missing input widens the engine's
              uncertainty, so read the result as a floor rather than a full assessment.
            </span>
          </div>
        )}

        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="self-start inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-primary text-white text-sm font-semibold transition-all hover:brightness-110 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
          ) : (
            <RefreshCw className="w-3.5 h-3.5" aria-hidden />
          )}
          {sepsis || deterioration ? "Re-run" : "Run early warning"}
        </button>

        {runError && <div className="text-sm text-error">{runError}</div>}
      </div>

      {sepsis && <ScoreCard title="Sepsis early warning" Icon={Activity} result={sepsis} />}
      {deterioration && (
        <ScoreCard title="Deterioration index" Icon={TrendingUp} result={deterioration} />
      )}
    </div>
  );
}
