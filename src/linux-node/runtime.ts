import { hostname } from "node:os";

import { buildWorkspaceAnnouncements } from "../client/workspaces";
import { LithiumDeviceClient, type DeviceClientOptions, type DeviceClientSnapshot } from "../device/client";
import { DEVICE_CAPABILITIES } from "../device/contracts";
import { DeviceCapabilityDispatcher } from "../device/dispatcher";
import { DeviceRuntime } from "../device/runtime";
import { TerminalManager } from "../terminal/manager";
import type { LithiumLinuxNodeConfig } from "./config";

export interface LithiumLinuxNodeRuntimeOptions {
  config: LithiumLinuxNodeConfig;
  credential: string;
  hostname?: string;
  architecture?: string;
  webSocketFactory?: DeviceClientOptions["webSocketFactory"];
}

export class LithiumLinuxNodeRuntime {
  readonly terminalManager: TerminalManager;
  readonly client: LithiumDeviceClient;

  constructor(private readonly options: LithiumLinuxNodeRuntimeOptions) {
    this.terminalManager = new TerminalManager(options.config);
    const runtime = new DeviceRuntime(options.config, this.terminalManager);
    const dispatcher = new DeviceCapabilityDispatcher(runtime);
    const capabilities = DEVICE_CAPABILITIES
      .filter((name) => name !== "run_command" || options.config.enableUnsafeShell)
      .map((name) => ({
        name,
        ...(name === "run_program" || name === "run_command" ? { cancellable: true } : {}),
        ...(name === "terminal_logs" ? { supportsStreaming: true } : {}),
      }));
    const workspaces = buildWorkspaceAnnouncements(options.config, capabilities, "linux");

    this.client = new LithiumDeviceClient({
      serverUrl: options.config.serverUrl,
      credential: options.credential,
      clientVersion: options.config.clientVersion,
      platform: "linux",
      architecture: options.architecture ?? process.arch,
      hostname: options.hostname ?? options.config.deviceName ?? hostname(),
      dispatcher,
      capabilities,
      workspaces: [...workspaces],
      ...(options.webSocketFactory ? { webSocketFactory: options.webSocketFactory } : {}),
    });
  }

  start(): void {
    this.client.start();
  }

  snapshot(): DeviceClientSnapshot {
    return this.client.snapshot();
  }

  async stop(): Promise<void> {
    this.client.stop();
    await this.terminalManager.shutdown();
  }
}
