import { vi } from "vitest";
vi.mock("../lib/apiClient", () => ({
  api: { get: vi.fn() },
  setApiAccessors: vi.fn(),
}));

vi.mock("./AuthContext", () => ({
  useAuth: () => ({ status: "guest", ispId: null }),
}));

import {
  readSelectedServerId,
  writeSelectedServerId,
} from "./ServerContext";

describe("tenant-scoped server selection", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("keeps selections isolated between tenants", () => {
    writeSelectedServerId("tenant-a", "router-a");
    writeSelectedServerId("tenant-b", "router-b");

    expect(readSelectedServerId("tenant-a")).toBe("router-a");
    expect(readSelectedServerId("tenant-b")).toBe("router-b");
    expect(readSelectedServerId("tenant-c")).toBe("");
  });

  test("clearing a selection removes only that tenant's value", () => {
    writeSelectedServerId("tenant-a", "router-a");
    writeSelectedServerId("tenant-b", "router-b");

    writeSelectedServerId("tenant-a", "");

    expect(readSelectedServerId("tenant-a")).toBe("");
    expect(readSelectedServerId("tenant-b")).toBe("router-b");
  });
});
