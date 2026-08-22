import SearchRounded from "@mui/icons-material/SearchRounded";
import { InputAdornment, Stack, TextField, ToggleButton, ToggleButtonGroup } from "@mui/material";
import type { ParameterFilter } from "../models/externalization";

export function ParameterFilters({ filter, search, onFilter, onSearch }: {
  filter: ParameterFilter; search: string; onFilter(value: ParameterFilter): void; onSearch(value: string): void;
}) {
  return <Stack direction={{ xs: "column", lg: "row" }} spacing={2} justifyContent="space-between">
    <TextField size="small" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search parameters"
      inputProps={{ "aria-label": "Search detected parameters" }}
      InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }} />
    <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_event, value: ParameterFilter | null) => value && onFilter(value)}
      aria-label="Parameter filter" sx={{ flexWrap: "wrap" }}>
      <ToggleButton value="all">All</ToggleButton><ToggleButton value="adapter">Adapters</ToggleButton>
      <ToggleButton value="content-modifier">Content Modifier</ToggleButton><ToggleButton value="existing">Existing</ToggleButton>
      <ToggleButton value="new">New</ToggleButton><ToggleButton value="skipped">Skipped</ToggleButton>
    </ToggleButtonGroup>
  </Stack>;
}
