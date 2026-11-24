import { autostartDto, setAutostartBody } from "@hub/contract/autostart";
import { connectionDto, connectionsDto } from "@hub/contract/connections";
import { coreUpdateDto, instanceDto } from "@hub/contract/instance";
import { opsErrorsDto, opsLinesDto } from "@hub/contract/ops-log";
import { connectionIdParam, setSecretBody } from "@hub/contract/requests";
import type { Operation } from "../http/openapi";

/** The instance domain's operations (P120 W1-W2). The logo is a file: the admin uses only its URL helper. */
export const operations: Operation[] = [
  { method: "get", path: "/api/instance", operationId: "getInstance", summary: "Read the Hub instance brand", tags: ["meta"], reply: { name: "Instance", schema: instanceDto }, errors: [503] },
  { method: "get", path: "/api/instance/logo", operationId: "getInstanceLogo", summary: "The instance's logo file", tags: ["meta"], reply: { media: "image/*" }, errors: [404] },
  { method: "get", path: "/api/instance/core", operationId: "getCoreUpdate", summary: "Read the cached core update status", tags: ["meta"], reply: { name: "CoreUpdate", schema: coreUpdateDto }, errors: [404, 503] },
  { method: "post", path: "/api/instance/core/check", operationId: "checkCoreUpdate", summary: "Check the origin's tags for a core update now", tags: ["meta"], reply: { name: "CoreUpdate", schema: coreUpdateDto }, errors: [404, 429, 503] },
  { method: "get", path: "/api/instance/autostart", operationId: "getAutostart", summary: "Read whether the Hub starts at login", tags: ["connections"], reply: { name: "Autostart", schema: autostartDto }, errors: [404, 503] },
  { method: "post", path: "/api/instance/autostart", operationId: "setAutostart", summary: "Switch the Hub's start at login", tags: ["connections"], body: { name: "SetAutostartBody", schema: setAutostartBody }, reply: { name: "Autostart", schema: autostartDto }, errors: [400, 403, 404, 500] },
  { method: "get", path: "/api/connections", operationId: "listConnections", summary: "List the instance's connections", tags: ["connections"], reply: { name: "Connections", schema: connectionsDto }, errors: [503] },
  { method: "post", path: "/api/connections/:id/test", operationId: "testConnection", summary: "Test one connection now", tags: ["connections"], params: connectionIdParam, reply: { name: "Connection", schema: connectionDto }, errors: [404, 503] },
  // A credential travels one way, into state/secrets (decision 0020): the reply never carries it.
  { method: "put", path: "/api/connections/:id/secret", operationId: "setConnectionSecret", summary: "Store one connection's token", tags: ["connections"], params: connectionIdParam, body: { name: "SetSecretBody", schema: setSecretBody }, reply: { name: "Connection", schema: connectionDto }, errors: [400, 403, 404] },
  { method: "post", path: "/api/connections/:id/remove", operationId: "removeConnectionSecret", summary: "Remove one connection's token", tags: ["connections"], params: connectionIdParam, reply: { name: "Connection", schema: connectionDto }, errors: [403, 404] },
  { method: "get", path: "/api/ops/errors", operationId: "getOpsErrors", summary: "Read the recent operational errors", tags: ["meta"], reply: { name: "OpsErrors", schema: opsErrorsDto }, errors: [503] },
  { method: "get", path: "/api/ops/lines", operationId: "getOpsLines", summary: "Read the last day's operational warnings and errors", tags: ["meta"], reply: { name: "OpsLines", schema: opsLinesDto }, errors: [503] },
];
