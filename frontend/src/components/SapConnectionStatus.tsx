import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import ErrorRounded from "@mui/icons-material/ErrorRounded";
import { Chip, Skeleton, Stack, Typography } from "@mui/material";
import type { SapStatus } from "../models/externalization";

export function SapConnectionStatus({ status, loading }: { status?: SapStatus; loading: boolean }) {
  if (loading) return <Skeleton width={180} height={32} />;
  return <Stack direction="row" spacing={1} alignItems="center">
    <Typography variant="body2" color="text.secondary">SAP Connection</Typography>
    <Chip
      size="small"
      color={status?.configured ? "success" : "error"}
      icon={status?.configured ? <CheckCircleRounded /> : <ErrorRounded />}
      label={status?.configured ? "Configured" : "Not configured"}
      variant="outlined"
    />
  </Stack>;
}
