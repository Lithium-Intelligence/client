import type { DeviceCapabilityName } from "./contracts";
import { DeviceCapabilityDispatcher } from "./dispatcher";
import type { DeviceRuntime } from "./runtime";

export interface DeviceInvocationContext {
  requestId?: string;
  reason?: string;
  projectId?: string;
  boardId?: string;
  cardId?: string;
  taskId?: string;
  actorId?: string;
  deviceId?: string;
  workspaceId?: string;
}

export interface DeviceCapabilityInvoker {
  invoke(
    capability: DeviceCapabilityName,
    args: Record<string, unknown>,
    context?: DeviceInvocationContext,
  ): Promise<unknown>;
}

export function localDeviceCapabilityInvoker(runtime: DeviceRuntime): DeviceCapabilityInvoker {
  const dispatcher = new DeviceCapabilityDispatcher(runtime);
  return {
    invoke(capability, args) {
      return dispatcher.execute(capability, args);
    },
  };
}
