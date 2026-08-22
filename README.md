# SAP iFlow Externalizer

A Node.js + TypeScript application with both CLI and React interfaces. It downloads an SAP Integration Suite Cloud Integration iFlow, backs it up, externalizes selected adapter and Content Modifier constants, validates the rebuilt artifact, and can update the same design-time artifact. Dry run is the default. Deployment and automatic rollback remain separately opt-in.

Both interfaces use one domain pipeline:

```text
CLI ─┐
     ├─> workflowService ─> externalizationService ─> SAP/ZIP/XML services
REST ┘
  ▲
React
```

## Safety model

Externalization is treated as a three-file SAP artifact change, based on an iFlow exported by SAP Cloud Integration:

1. The adapter property in the `.iflw` references `{{Parameter_Name}}`.
2. `src/main/resources/parameters.prop` retains the original/default value.
3. `src/main/resources/parameters.propdef` contains the typed parameter and a `<param_references><reference .../></param_references>` mapping with the adapter category and metadata attribute ID.

The application updates all three together. It parses XML, only changes allowlisted adapter properties or safe Content Modifier value cells, and refuses a new externalization when the SAP component has no `cmdVariantUri`. BPMN IDs, sequence flows, field names, diagrams, namespaces, scripts, mappings, and unrelated resources are never detection candidates.

## Requirements and authentication

- Node.js 20 or newer.
- An SAP Integration Suite OAuth client/service key that supports the client-credentials grant.
- Read permission for design-time artifacts and edit permission for updates. In Cloud Integration, use the least-privilege role collection appropriate to your tenant; `PI_Integration_Developer` / `WorkspacePackagesEdit` is the standard edit-capable role family. Access policies can further restrict individual packages/artifacts.
- If deployment is enabled, the client must also have deployment permission.

The token endpoint receives HTTP Basic client authentication and `grant_type=client_credentials`. Tokens are kept in memory only and refreshed shortly before expiration. Modifying SAP API calls first fetch an `X-CSRF-Token` and preserve the associated session cookie. Client secrets and access tokens are never logged.

Some Cloud Integration tenants return HTTP 501 (`No message reference given`) when metadata or the collection itself is read directly from the streamed `IntegrationDesigntimeArtifacts` entity, even though its `/$value` ZIP download and PUT are supported. The client automatically falls back to `IntegrationPackages(...)/IntegrationDesigntimeArtifacts` for metadata and fetches CSRF state from the OData `$metadata` document. API errors include the HTTP method and safe request path to make endpoint problems distinguishable without logging tokens or credentials.

Official SAP references: [Integration Flow example requests](https://help.sap.com/docs/cloud-integration/sap-cloud-integration/integration-flow-example-requests), [update and validate configuration parameters](https://help.sap.com/docs/cloud-integration/sap-cloud-integration/update-and-validate-configuration-parameters), and [Integration Content API/CSRF behavior](https://help.sap.com/docs/cloud-integration/sap-cloud-integration/integration-content).

## Configuration

```bash
cp .env.example .env
```

Set:

```dotenv
SAP_IS_BASE_URL=https://your-tenant.example.com
SAP_CLIENT_ID=your-client-id
SAP_CLIENT_SECRET=your-client-secret
SAP_TOKEN_URL=https://your-oauth-host.example.com/oauth/token
SAP_IFLOW_ID=OrderProcessing
SAP_IFLOW_VERSION=active
DRY_RUN=true
DEPLOY_AFTER_UPDATE=false
AUTO_ROLLBACK_ON_FAILURE=false
EXTERNALIZE_CONTENT_MODIFIER_BODY=false
ENABLE_UPDATE_API=false
```

Credentials are required even in dry run because the artifact is downloaded from SAP. Boolean flags accept only `true` or `false`.

`EXTERNALIZE_CONTENT_MODIFIER_BODY` is disabled by default. When explicitly enabled, only a single static body no longer than 200 characters is eligible; structured XML, multiline bodies, expressions, and larger bodies are still skipped.

`ENABLE_UPDATE_API` applies only to the REST API. It defaults to `false`, so the hosted UI can analyze and run dry runs but cannot modify SAP until an administrator deliberately enables it. The CLI continues to use `--dry-run` or `--update` directly.

## Install, verify, and run the CLI

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run externalize -- --id OrderProcessing --dry-run
```

Use `--update` instead of `--dry-run` only after reviewing the generated artifact. `--version <version>` overrides `SAP_IFLOW_VERSION`. Existing `npm run dev` behavior remains available.

The normal dry-run flow is download → backup → extract → analyze → modify → rebuild → local validation → report. It writes:

- `backup/<iFlow-name>_<timestamp>.zip`: immutable original download. A collision creates a suffixed file; the sole backup is never overwritten.
- `output/<iFlow-id>-externalized.zip`: locally generated artifact.
- `output/externalization-report.json`: machine-readable, secret-redacted change report.

## Updating, validation, and deployment

Review the report and generated ZIP first. Set `DRY_RUN=false` to PUT the Base64 ZIP back to the same `IntegrationDesigntimeArtifacts(Id=...,Version=...)` entity. The existing artifact name is read from SAP rather than hardcoded.

After PUT, the tool calls `ValidateIntegrationDesigntimeArtifact`, prints every returned validation error, then reads `/Configurations?$format=json` and checks every expected parameter. A failed SAP validation or missing configuration prevents deployment.

`DEPLOY_AFTER_UPDATE=false` is the default. Set it to `true` only when an immediate deployment is explicitly intended. The tool never undeploys an integration.

## Backup and rollback

If SAP accepts the PUT but validation fails, the original ZIP path is printed. With `AUTO_ROLLBACK_ON_FAILURE=false`, restoration is a deliberate operator action: retain the backup, set the desired flags after review, or upload that exact ZIP through the SAP UI/API. With `AUTO_ROLLBACK_ON_FAILURE=true`, the application calls `restoreOriginalIFlow()`, PUTs the original ZIP, and validates the restoration. It does not deploy the restored artifact automatically.

## Detection and naming

Rules live in `src/rules/externalizationRules.ts`. Adapter aliases and allowed property names are data, so another adapter/property can be added without a large conditional chain. Initial adapters are HTTP/HTTPS, SOAP, OData, SFTP, FTP, Mail, JMS, ProcessDirect, XI, and IDoc.

Names are deterministic: `Receiver_<component-or-adapter>_<property>`, `Sender_...`, or `Step_...`. Unsupported characters become `_`; collisions receive `_2`, `_3`, and so on. Exact existing `{{...}}` references are detected and left untouched, so a second execution is idempotent.

### Content Modifier detection

Content Modifier support is based on SAP's exported `Enricher` flow-step structure: a `bpmn2:callActivity` with `activityType=Enricher`, a matching `cmdVariantUri`, and escaped row XML in `headerTable` or `propertyTable`. The engine reads each row's `Name`, `Type`, and `Value` cells. Only `Type=constant` static values are eligible, and only the `Value` cell changes.

The following are skipped: empty values, `${...}` and `#{...}`, XPath/JSONPath/Simple/Groovy-style expressions, script/resource references, structured bodies, and already externalized values. Already externalized values are reported without being changed.

Content Modifier names use `CM_<StepName>_<FieldName>`, are restricted to letters, digits, and underscores, and are capped at 120 characters. Identical values in different steps stay separate because their semantics may differ.

Credential/security-material fields externalize aliases only. Password/private-key/secret material is neither queried nor handled. Sensitive-rule values are redacted in logs and reports.

## REST API and frontend

Start the backend API in one terminal:

```bash
npm run server:dev
```

Install and start the frontend in another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to `http://localhost:3001`. The browser receives the configured tenant URL and connection state, but never receives the OAuth client ID, client secret, token URL, or access token. Credentials are not placed in browser storage.

Available routes:

- `GET /api/health`
- `GET /api/sap/status`
- `POST /api/iflow/analyze`
- `POST /api/iflow/dry-run`
- `POST /api/iflow/externalize`
- `GET /api/iflow/:id/configurations?version=active`

Analyze is read-only. Dry run creates a backup, modified ZIP, local validation result, and report without PUT. Externalize requires an explicit non-empty selection, always validates, verifies `/Configurations`, and never deploys from the REST interface.

The UI provides source/status filters, search, select/clear controls, sensitive-value masking, before/after preview, a confirmation dialog, pipeline status, SAP validation errors, and dry-run/update results.

## Deploying the complete application on Vercel

The repository is configured as one Vercel project: Vite builds the React UI into `public/`, while the root `server.ts` exports the existing Express API as one Vercel Function. The CLI and REST API still use the same workflow and externalization services.

1. In Vercel, import `Piyush-39/iflow-externalized` and keep the project root as the repository root. The committed `vercel.json` supplies the build command and a 300-second function duration.
2. Add these server-side environment variables for Production and Preview as appropriate:

   ```dotenv
   SAP_IS_BASE_URL=https://your-tenant.example.com
   SAP_CLIENT_ID=your-client-id
   SAP_CLIENT_SECRET=your-client-secret
   SAP_TOKEN_URL=https://your-oauth-host.example.com/oauth/token
   DEPLOY_AFTER_UPDATE=false
   AUTO_ROLLBACK_ON_FAILURE=false
   EXTERNALIZE_CONTENT_MODIFIER_BODY=false
   ENABLE_UPDATE_API=false
   ```

   `SAP_IFLOW_ID` and `DRY_RUN` are CLI inputs and are not required by the hosted API. Never create `VITE_` variables for OAuth credentials; such variables are exposed to the browser.
3. From the Vercel project, create and connect a **private Vercel Blob** store. Vercel adds `BLOB_READ_WRITE_TOKEN` to the project automatically. Do not paste that token into Git or expose it to the frontend.
4. Enable Vercel Deployment Protection / Vercel Authentication for every environment that can reach the SAP-mutating API. The API is intentionally not a public anonymous integration endpoint.
5. Deploy with `ENABLE_UPDATE_API=false`, open the generated URL, verify SAP status, analyze a non-production iFlow, and complete a dry run.
6. Only after protection and dry-run verification, set `ENABLE_UPDATE_API=true` and redeploy if design-time updates are required. `DEPLOY_AFTER_UPDATE` should remain `false`; the web API never deploys an iFlow.

Vercel Functions have an ephemeral filesystem. Each request therefore uses an isolated directory under `/tmp`, removes it afterward, and stores the original backup, generated ZIP, and redacted JSON report in private Blob storage. The original backup is archived before any SAP PUT. If Blob is not connected, dry-run/update requests fail safely instead of pretending that a temporary file is a durable backup.

For local Vercel-style verification:

```bash
npm install
VERCEL=1 npm run vercel-build
npx vercel dev
```

The generated `public/` directory, `.vercel/`, all `.env` variants except `.env.example`, local ZIPs, reports, dependencies, and temporary files are ignored by Git.

## Known limitations

- SAP adapter metadata and property IDs vary by adapter/version. Only properties in the rule table are candidates, and the artifact's own `cmdVariantUri` is required for new references. Validate every generated artifact in a non-production tenant before broader use.
- The repository contained SAP's real `Enricher` table structure but no manually externalized Content Modifier reference. The implementation uses the component's real `cmdVariantUri` plus `attrId::headerTable`, `attrId::propertyTable`, or `attrId::wrapContent` in the same `parameters.propdef` reference format already generated by SAP for other components. Confirm Configure → Externalized Parameters behavior on the adapter/runtime versions used by your tenant before production rollout.
- The tool does not infer arbitrary custom adapter metadata, externalize scripts/mappings/resources, or turn `${...}` Camel expressions into parameters.
- An archive with multiple ambiguous `.iflw` files is rejected.
- SAP's validation call returns HTTP 202 even when its textual result says `Failed`; the response body, not just the HTTP status, is evaluated.
