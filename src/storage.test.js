import { storage } from "./utils/storage";

describe("storage auth helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("setAuth merges fields without dropping existing values", () => {
    storage.setAuth({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      ispId: "tenant-1",
      user: { id: "user-1" },
    });

    storage.setAuth({ accessToken: "access-2" });

    expect(storage.getAccess()).toBe("access-2");
    expect(storage.getRefresh()).toBe("refresh-1");
    expect(storage.getIspId()).toBe("tenant-1");
    expect(storage.getUser()).toEqual({ id: "user-1" });
  });

  test("clear removes persisted auth state", () => {
    storage.setAuth({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      ispId: "tenant-1",
    });

    storage.clear();

    expect(storage.getAll()).toEqual({});
    expect(storage.getAccess()).toBeNull();
    expect(storage.getRefresh()).toBeNull();
    expect(storage.getIspId()).toBeNull();
  });
});
