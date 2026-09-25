import { expect, test } from "bun:test";

import { parseServerMessage } from "../src/protocol/messages";

test("call context keeps controller metadata opaque to the local runtime", () => {
  const message = parseServerMessage(JSON.stringify({
    type: "call",
    id: "call_1",
    capability: "workspace_info",
    arguments: {},
    context: {
      correlationId: "corr_1",
      accountId: "account_1",
      deviceId: "device_1",
      scopeHint: "opaque-controller-metadata",
    },
  }));

  expect(message.type).toBe("call");
  if (message.type !== "call") throw new Error("unexpected message");
  expect(message.context?.accountId).toBe("account_1");
  expect(message.context?.deviceId).toBe("device_1");
  expect(message.context?.scopeHint).toBe("opaque-controller-metadata");
});
