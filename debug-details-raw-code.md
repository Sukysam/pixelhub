[OPEN] Debug session: details-raw-code

## Symptom
- The `Details` section renders audit-log content as raw code/JSON instead of readable formatted content.

## Scope
- Observed in the Settings `Audit Log` table.
- Needs root-cause confirmation across frontend rendering, backend payload shape, and styling.

## Initial Hypotheses
1. The frontend intentionally renders `details` with a code/preformatted element or whitespace-preserving style.
2. The frontend receives structured JSON but lacks a formatter to convert nested objects into readable content.
3. The backend serializes `details` as a string blob instead of structured JSON, forcing a raw-text fallback.
4. Frontend parsing/regression broke object detection and now treats all detail payloads as plain strings.
5. Table/cell CSS preserves whitespace in a way that exposes raw JSON formatting rather than readable summaries.

## Evidence Plan
- Find the audit log data source and the exact `Details` rendering component.
- Inspect payload shape from backend serializers/views and current frontend cell rendering.
- Add minimal instrumentation only if static inspection is insufficient.
- Apply the smallest fix that preserves adjacent layout and verify across browsers/viewports.
