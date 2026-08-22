import SearchRounded from "@mui/icons-material/SearchRounded";
import { Button, Grid, MenuItem, TextField } from "@mui/material";

interface Props {
  tenantUrl: string; iflowId: string; version: string; loading: boolean; disabled: boolean;
  onTenantUrl(value: string): void; onIflowId(value: string): void; onVersion(value: string): void; onAnalyze(): void;
}

export function IFlowSelector(props: Props) {
  return <Grid container spacing={2} alignItems="flex-end">
    <Grid size={{ xs: 12, md: 5 }}>
      <TextField fullWidth label="Tenant URL" value={props.tenantUrl} onChange={(event) => props.onTenantUrl(event.target.value)}
        helperText="Uses OAuth credentials configured on the backend" inputProps={{ "aria-label": "SAP tenant URL" }} />
    </Grid>
    <Grid size={{ xs: 12, sm: 8, md: 4 }}>
      <TextField fullWidth required label="iFlow ID" value={props.iflowId} onChange={(event) => props.onIflowId(event.target.value)}
        placeholder="OrderProcessing" inputProps={{ "aria-label": "iFlow ID" }} />
    </Grid>
    <Grid size={{ xs: 12, sm: 4, md: 1.5 }}>
      <TextField fullWidth select label="Version" value={props.version} onChange={(event) => props.onVersion(event.target.value)}>
        <MenuItem value="active">active</MenuItem><MenuItem value="1.0.0">1.0.0</MenuItem>
      </TextField>
    </Grid>
    <Grid size={{ xs: 12, md: 1.5 }}>
      <Button fullWidth variant="contained" size="large" startIcon={<SearchRounded />} onClick={props.onAnalyze}
        disabled={props.disabled || props.loading} sx={{ minHeight: 56 }}>Analyze</Button>
    </Grid>
  </Grid>;
}
