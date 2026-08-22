import CloudSyncRounded from "@mui/icons-material/CloudSyncRounded";
import PlayCircleOutlineRounded from "@mui/icons-material/PlayCircleOutlineRounded";
import SecurityRounded from "@mui/icons-material/SecurityRounded";
import UploadRounded from "@mui/icons-material/UploadRounded";
import {
  Alert, AlertTitle, Box, Button, CircularProgress, Container, Divider, Paper, Skeleton, Stack, Typography
} from "@mui/material";
import { useMemo, useState } from "react";
import { AnalysisSummary } from "../components/AnalysisSummary";
import { ConfirmUpdateDialog } from "../components/ConfirmUpdateDialog";
import { ExternalizationPreview } from "../components/ExternalizationPreview";
import { IFlowSelector } from "../components/IFlowSelector";
import { ParameterFilters } from "../components/ParameterFilters";
import { ParameterTable, type ParameterRow } from "../components/ParameterTable";
import { PipelineProgress } from "../components/PipelineProgress";
import { SapConnectionStatus } from "../components/SapConnectionStatus";
import { ValidationResult } from "../components/ValidationResult";
import { useIFlowExternalizer } from "../hooks/useIFlowExternalizer";
import type { ParameterFilter } from "../models/externalization";

export function ExternalizerPage() {
  const flow = useIFlowExternalizer();
  const [filter, setFilter] = useState<ParameterFilter>("all");
  const [search, setSearch] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const allRows = useMemo<ParameterRow[]>(() => flow.analysis ? [...flow.analysis.parameters, ...flow.analysis.skipped] : [], [flow.analysis]);
  const rows = useMemo(() => allRows.filter((row) => matchesFilter(row, filter) && matchesSearch(row, search)), [allRows, filter, search]);
  const selectedParameters = useMemo(() => flow.analysis?.parameters.filter((item) => flow.selected.has(item.parameterName)) ?? [], [flow.analysis, flow.selected]);
  const operationBusy = flow.busy === "dry-run" || flow.busy === "update";

  return <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
    <Box component="header" sx={{ bgcolor: "#0b1f33", color: "white", py: { xs: 4, md: 5 }, borderBottom: "4px solid", borderColor: "primary.main" }}>
      <Container maxWidth="xl"><Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={3} alignItems={{ md: "center" }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box sx={{ width: 48, height: 48, display: "grid", placeItems: "center", borderRadius: 2, bgcolor: "primary.main" }}><CloudSyncRounded /></Box>
          <Box><Typography variant="h3" component="h1" fontWeight={700}>iFlow Parameter Externalizer</Typography>
            <Typography sx={{ mt: 0.5, color: "rgba(255,255,255,.72)" }}>Externalize SAP Integration Suite configuration parameters safely.</Typography></Box>
        </Stack>
        <Paper elevation={0} sx={{ px: 2, py: 1.25, bgcolor: "rgba(255,255,255,.08)", color: "inherit", border: "1px solid rgba(255,255,255,.16)" }}>
          <SapConnectionStatus status={flow.sapStatus} loading={flow.busy === "status"} />
        </Paper>
      </Stack></Container>
    </Box>

    <Container maxWidth="xl" component="main" sx={{ py: { xs: 3, md: 5 } }}>
      <Stack spacing={3}>
        <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2.5 }}><SecurityRounded color="primary" />
            <Box><Typography variant="h6" fontWeight={700}>SAP Integration Suite</Typography>
              <Typography variant="body2" color="text.secondary">OAuth credentials stay on the backend and are never sent to this browser.</Typography></Box>
          </Stack>
          <IFlowSelector tenantUrl={flow.tenantUrl} iflowId={flow.iflowId} version={flow.version}
            loading={flow.busy === "analyze"} disabled={!flow.canAnalyze}
            onTenantUrl={flow.setTenantUrl} onIflowId={flow.setIflowId} onVersion={flow.setVersion} onAnalyze={flow.analyze} />
        </Paper>

        {flow.error && <Alert severity="error" onClose={() => flow.setError(undefined)}>
          <AlertTitle>{flow.error.status === 422 ? "Validation failed" : "Operation failed"}</AlertTitle>{flow.error.message}
          {Array.isArray(flow.error.details?.validationErrors) && <Box component="ul" sx={{ mb: 0 }}>
            {(flow.error.details.validationErrors as Array<{ message?: string }>).map((item, index) => <li key={index}>{item.message ?? "SAP validation error"}</li>)}
          </Box>}
        </Alert>}

        {flow.busy === "analyze" && <><Skeleton variant="rounded" height={130} /><Skeleton variant="rounded" height={320} /></>}

        {flow.analysis && <>
          <Box><Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>Analysis summary</Typography><AnalysisSummary summary={flow.analysis.summary} /></Box>
          <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 } }}>
            <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" spacing={1} sx={{ mb: 2.5 }}>
              <Box><Typography variant="h5" fontWeight={700}>Detected parameters</Typography>
                <Typography variant="body2" color="text.secondary">Choose only the new values you want to externalize.</Typography></Box>
              <Typography variant="body2" color="text.secondary">{flow.selected.size} selected</Typography>
            </Stack>
            <ParameterFilters filter={filter} search={search} onFilter={setFilter} onSearch={setSearch} />
            <Divider sx={{ my: 2 }} />
            <ParameterTable rows={rows} selected={flow.selected} onToggle={flow.toggle} onSelectAll={flow.selectAll} onClearAll={flow.clearAll} />
          </Paper>

          {selectedParameters.length > 0 && <ExternalizationPreview parameters={selectedParameters} />}

          {!flow.sapStatus?.updateEnabled && <Alert severity="info">
            SAP updates are disabled on this server. Dry runs remain available. An administrator can enable updates after deployment access is protected.
          </Alert>}

          <Paper variant="outlined" sx={{ p: 2 }}><Stack direction={{ xs: "column", sm: "row" }} justifyContent="flex-end" spacing={1.5}>
            <Button variant="outlined" size="large" startIcon={flow.busy === "dry-run" ? <CircularProgress size={18} /> : <PlayCircleOutlineRounded />}
              disabled={!flow.canExecute} onClick={flow.dryRun}>Dry run</Button>
            <Button variant="contained" size="large" startIcon={<UploadRounded />} disabled={!flow.canUpdate}
              onClick={() => setConfirmOpen(true)}>Externalize &amp; Update</Button>
          </Stack></Paper>
        </>}

        {(operationBusy || flow.progressIndex >= 0) && <PipelineProgress activeIndex={flow.progressIndex}
          dryRun={flow.busy === "dry-run" || Boolean(flow.result && !flow.result.outcome?.uploaded)} failed={Boolean(flow.error)} />}
        {flow.result && <ValidationResult result={flow.result} />}
      </Stack>
    </Container>

    <ConfirmUpdateDialog open={confirmOpen} iflowId={flow.iflowId} count={flow.selected.size} onCancel={() => setConfirmOpen(false)}
      onConfirm={() => { setConfirmOpen(false); void flow.update(); }} />
  </Box>;
}

function matchesFilter(row: ParameterRow, filter: ParameterFilter): boolean {
  if (filter === "all") return true;
  if (filter === "adapter") return row.sourceType === "adapter";
  if (filter === "content-modifier") return row.sourceType === "content-modifier";
  return row.status === filter;
}

function matchesSearch(row: ParameterRow, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const parameterName = "parameterName" in row ? row.parameterName : "";
  return [parameterName, row.componentName, row.componentId, row.propertyName, row.adapterType]
    .some((value) => value?.toLowerCase().includes(query));
}
