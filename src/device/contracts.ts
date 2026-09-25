export const DEVICE_CAPABILITIES = [
  "workspace_info",
  "list_files",
  "read_file",
  "read_image",
  "file_info",
  "make_directory",
  "write_file",
  "edit_file",
  "apply_patch",
  "write_binary",
  "write_image",
  "move_file",
  "delete_file",
  "run_program",
  "run_command",
  "terminal_start",
  "terminal_list",
  "terminal_logs",
  "terminal_stop",
] as const;

export type DeviceCapabilityName = (typeof DEVICE_CAPABILITIES)[number];

/**
 * Transport-neutral capability request.
 * Controller metadata is intentionally outside `arguments` and is not part of
 * the local execution contract.
 */
export interface DeviceCapabilityRequest {
  id: string;
  capability: DeviceCapabilityName;
  arguments: Record<string, unknown>;
}

export interface DeviceCapabilityError {
  code: string;
  message: string;
}

export type DeviceCapabilityResponse =
  | {
      id: string;
      ok: true;
      result: unknown;
    }
  | {
      id: string;
      ok: false;
      error: DeviceCapabilityError;
    };

export function deviceError(error: unknown, code = "DEVICE_EXECUTION_ERROR"): DeviceCapabilityError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}
