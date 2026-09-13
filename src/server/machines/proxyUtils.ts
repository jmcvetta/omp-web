import { RemoteMachineRequestError } from "./machineClient.js";

export const SAFE_RESPONSE_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
  "last-modified",
  "etag",
  "content-security-policy",
  "x-content-type-options",
]);

export function filterSafeHeaders(headers: Record<string, string | string[] | undefined>): Headers {
  const safeHeaders = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (!SAFE_RESPONSE_HEADERS.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) safeHeaders.append(name, item);
    } else {
      safeHeaders.set(name, value);
    }
  }
  return safeHeaders;
}

export function sendGatewayErrorResponse(machineId: string, error: unknown): Response {
  const statusCode = error instanceof RemoteMachineRequestError ? error.statusCode : 502;
  const label = statusCode === 504 ? "Remote machine timeout" : "Remote machine unavailable";
  return Response.json({
    error: label,
    machineId,
    statusCode,
    detail: error instanceof Error ? error.message : String(error),
  }, { status: statusCode });
}
