/**
 * Facade: dispatch operations bound to `cwd`.
 */

import { teamDispatchDir } from "../../utils/paths.js";
import {
  enqueueDispatchRequest,
  listDispatchRequests,
  markDispatchRequestDelivered,
  markDispatchRequestNotified,
  readDispatchRequest,
} from "../state/dispatch.js";
import type {
  DispatchRequest,
  DispatchRequestInput,
  DispatchRequestKind,
  DispatchRequestStatus,
} from "../state/types.js";

export async function enqueueDispatch(
  cwd: string,
  input: DispatchRequestInput,
): Promise<{ request: DispatchRequest; deduped: boolean }> {
  return enqueueDispatchRequest(teamDispatchDir(cwd), input);
}

export async function getDispatch(
  cwd: string,
  requestId: string,
): Promise<DispatchRequest | null> {
  return readDispatchRequest(teamDispatchDir(cwd), requestId);
}

export async function listDispatches(
  cwd: string,
  opts?: {
    status?: DispatchRequestStatus;
    kind?: DispatchRequestKind;
    to_worker?: string;
    limit?: number;
  },
): Promise<DispatchRequest[]> {
  return listDispatchRequests(teamDispatchDir(cwd), opts);
}

export async function markDispatchNotified(
  cwd: string,
  requestId: string,
  patch?: Partial<DispatchRequest>,
): Promise<DispatchRequest | null> {
  return markDispatchRequestNotified(teamDispatchDir(cwd), requestId, patch);
}

export async function markDispatchDelivered(
  cwd: string,
  requestId: string,
  patch?: Partial<DispatchRequest>,
): Promise<DispatchRequest | null> {
  return markDispatchRequestDelivered(teamDispatchDir(cwd), requestId, patch);
}
