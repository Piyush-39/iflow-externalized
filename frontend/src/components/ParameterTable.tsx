import LockRounded from "@mui/icons-material/LockRounded";
import {
  Box, Button, Checkbox, Chip, Paper, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Tooltip, Typography
} from "@mui/material";
import type { ExternalizationParameterView, SkippedParameterView } from "../models/externalization";

export type ParameterRow = ExternalizationParameterView | SkippedParameterView;

export function ParameterTable({ rows, selected, onToggle, onSelectAll, onClearAll }: {
  rows: ParameterRow[]; selected: Set<string>; onToggle(name: string): void; onSelectAll(): void; onClearAll(): void;
}) {
  return <Paper variant="outlined" sx={{ overflow: "hidden" }}>
    <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ px: 2, py: 1.25, borderBottom: 1, borderColor: "divider" }}>
      <Button size="small" onClick={onSelectAll}>Select all new</Button>
      <Button size="small" color="inherit" onClick={onClearAll}>Clear all</Button>
    </Stack>
    <TableContainer sx={{ maxHeight: 520 }}><Table stickyHeader aria-label="Detected externalization parameters">
      <TableHead><TableRow>
        <TableCell padding="checkbox"><span className="sr-only">Select</span></TableCell>
        <TableCell>Parameter</TableCell><TableCell>Source</TableCell><TableCell>Component</TableCell>
        <TableCell>Property</TableCell><TableCell>Original value</TableCell><TableCell>Status</TableCell>
      </TableRow></TableHead>
      <TableBody>{rows.map((row, index) => {
        const parameterName = "parameterName" in row ? row.parameterName : undefined;
        const selectable = row.status === "new" && parameterName;
        return <TableRow key={`${row.componentId ?? "component"}-${row.propertyName}-${parameterName ?? index}`} hover>
          <TableCell padding="checkbox"><Checkbox size="small" disabled={!selectable} checked={Boolean(parameterName && selected.has(parameterName))}
            onChange={() => parameterName && onToggle(parameterName)} inputProps={{ "aria-label": `Select ${parameterName ?? row.propertyName}` }} /></TableCell>
          <TableCell><Typography variant="body2" fontWeight={600}>{parameterName ?? "Not externalized"}</Typography></TableCell>
          <TableCell><Chip size="small" variant="outlined" label={row.sourceType === "adapter" ? row.adapterType ?? "Adapter" : "Content Modifier"} /></TableCell>
          <TableCell>{row.componentName ?? row.componentId ?? "—"}</TableCell>
          <TableCell><Typography variant="body2">{row.propertyName}</Typography>
            {row.section && <Typography variant="caption" color="text.secondary">{sectionLabel(row.section)}</Typography>}</TableCell>
          <TableCell sx={{ maxWidth: 300 }}>
            {row.sensitive ? <Tooltip title="Sensitive values are never returned by the backend"><Stack direction="row" spacing={0.75} alignItems="center">
              <LockRounded fontSize="small" color="action" /><Typography variant="body2" color="text.secondary">Sensitive value</Typography>
            </Stack></Tooltip> : <Typography variant="body2" noWrap title={"originalValue" in row ? row.originalValue : undefined}>
              {"originalValue" in row ? row.originalValue || "—" : reasonLabel("reason" in row ? row.reason : "skipped")}
            </Typography>}
          </TableCell>
          <TableCell><StatusChip status={row.status} reason={"reason" in row ? row.reason : undefined} /></TableCell>
        </TableRow>;
      })}</TableBody>
    </Table></TableContainer>
    {rows.length === 0 && <Box sx={{ py: 7, textAlign: "center" }}><Typography color="text.secondary">No parameters match this filter.</Typography></Box>}
  </Paper>;
}

function StatusChip({ status, reason }: { status: ParameterRow["status"]; reason?: string }) {
  if (status === "new") return <Chip size="small" color="primary" label="New" />;
  if (status === "existing") return <Chip size="small" color="success" variant="outlined" label="Existing" />;
  return <Tooltip title={reasonLabel(reason ?? "skipped")}><Chip size="small" color="default" variant="outlined" label="Skipped" /></Tooltip>;
}

function sectionLabel(section: string): string {
  return section === "property" ? "Exchange Property" : section[0]!.toUpperCase() + section.slice(1);
}

function reasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    "dynamic-expression": "Dynamic expression",
    "body-disabled": "Message Body disabled by policy",
    "body-too-large": "Message Body exceeds safe limit",
    "unsupported-type": "Unsupported value type",
    "unsupported-value": "Unsupported static value",
    "malformed-table": "Malformed Content Modifier table",
    empty: "Empty value"
  };
  return labels[reason] ?? reason.replaceAll("-", " ");
}
