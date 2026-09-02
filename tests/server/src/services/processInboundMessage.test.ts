import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@server-root/prisma", () => ({
  prisma: {
    inboundMessage: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "@server-root/prisma";
import { processInboundMessage } from "@server/services/processInboundMessage";

const mockFindUnique = prisma.inboundMessage.findUnique as unknown as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.inboundMessage.update as unknown as ReturnType<typeof vi.fn>;

const baseMessage = {
  id: "msg-1",
  channel: "EMAIL",
  sender: "jane@example.com",
  content: "Hello there",
  threadId: "thread-1",
  processed: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindUnique.mockResolvedValue({ ...baseMessage });
  mockUpdate.mockResolvedValue({ ...baseMessage, processed: true });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("processInboundMessage", () => {
  it("marks an unprocessed message as processed", async () => {
    await processInboundMessage("msg-1");
    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "msg-1" }, data: { processed: true } });
  });

  it("does nothing when the message doesn't exist", async () => {
    mockFindUnique.mockResolvedValue(null);
    await processInboundMessage("nope");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("nope"));
  });

  it("does nothing when the message is already processed", async () => {
    mockFindUnique.mockResolvedValue({ ...baseMessage, processed: true });
    await processInboundMessage("msg-1");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("never throws, even when the lookup fails", async () => {
    mockFindUnique.mockRejectedValue(new Error("db down"));
    await expect(processInboundMessage("msg-1")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("msg-1"), "db down");
  });

  it("never throws, even when the update fails", async () => {
    mockUpdate.mockRejectedValue(new Error("update failed"));
    await expect(processInboundMessage("msg-1")).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("msg-1"), "update failed");
  });

  it("looks up the message by the given id", async () => {
    await processInboundMessage("msg-1");
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: "msg-1" } });
  });
});
