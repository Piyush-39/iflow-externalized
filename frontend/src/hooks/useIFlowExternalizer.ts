import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { iflowApi } from "../api/iflowApi";
import type { AnalysisResponse, SapStatus } from "../models/externalization";

export const PIPELINE_STEPS = [
  "Downloading iFlow", "Creating backup", "Extracting artifact", "Analyzing configuration",
  "Externalizing parameters", "Creating ZIP", "Local validation", "Uploading SAP artifact",
  "SAP validation", "Configuration verification"
] as const;

export function useIFlowExternalizer() {
  const [sapStatus, setSapStatus] = useState<SapStatus>();
  const [tenantUrl, setTenantUrl] = useState("");
  const [iflowId, setIflowId] = useState("");
  const [version, setVersion] = useState("active");
  const [analysis, setAnalysis] = useState<AnalysisResponse>();
  const [result, setResult] = useState<AnalysisResponse>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"status" | "analyze" | "dry-run" | "update" | undefined>("status");
  const [progressIndex, setProgressIndex] = useState(-1);
  const [error, setError] = useState<ApiError>();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    iflowApi.status()
      .then((status) => { setSapStatus(status); setTenantUrl(status.tenantUrl); })
      .catch((caught: unknown) => setError(asApiError(caught)))
      .finally(() => setBusy(undefined));
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, []);

  const request = useMemo(() => ({ tenantUrl, iflowId: iflowId.trim(), version }), [tenantUrl, iflowId, version]);

  const analyze = useCallback(async () => {
    setBusy("analyze"); setError(undefined); setResult(undefined); setAnalysis(undefined); setSelected(new Set());
    try {
      const response = await iflowApi.analyze(request);
      setAnalysis(response);
      setSelected(new Set(response.parameters.filter((item) => item.status === "new").map((item) => item.parameterName)));
    } catch (caught) { setError(asApiError(caught)); }
    finally { setBusy(undefined); }
  }, [request]);

  const runOperation = useCallback(async (mode: "dry-run" | "update") => {
    setBusy(mode); setError(undefined); setResult(undefined); setProgressIndex(0);
    const maximum = mode === "dry-run" ? 6 : PIPELINE_STEPS.length - 1;
    timer.current = window.setInterval(() => setProgressIndex((current) => Math.min(current + 1, maximum)), 650);
    try {
      const body = { ...request, selectedParameters: [...selected] };
      const response = mode === "dry-run" ? await iflowApi.dryRun(body) : await iflowApi.externalize(body);
      setResult(response);
      setProgressIndex(mode === "dry-run" ? 7 : PIPELINE_STEPS.length);
    } catch (caught) { setError(asApiError(caught)); }
    finally {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = undefined;
      setBusy(undefined);
    }
  }, [request, selected]);

  const toggle = useCallback((name: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const selectable = analysis?.parameters.filter((item) => item.status === "new").map((item) => item.parameterName) ?? [];
  return {
    sapStatus, tenantUrl, setTenantUrl, iflowId, setIflowId, version, setVersion,
    analysis, result, selected, busy, progressIndex, error, setError,
    analyze, dryRun: () => runOperation("dry-run"), update: () => runOperation("update"), toggle,
    selectAll: () => setSelected(new Set(selectable)), clearAll: () => setSelected(new Set()),
    canAnalyze: Boolean(iflowId.trim() && sapStatus?.configured && !busy),
    canExecute: Boolean(analysis && selected.size > 0 && sapStatus?.configured && !busy),
    canUpdate: Boolean(analysis && selected.size > 0 && sapStatus?.configured && sapStatus.updateEnabled && !busy)
  };
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError ? error : new ApiError(error instanceof Error ? error.message : "Unexpected error", 0);
}
