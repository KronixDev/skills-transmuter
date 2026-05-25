import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runMigrateCommand } from "../src/commands/migrate.js";
import fs from "fs";
import path from "path";
import os from "os";

describe("Migrate Command Options Validation", () => {
  let exitMock: any;
  let errorMock: any;
  const tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-val-test-"));

  beforeEach(() => {
    exitMock = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit called");
    });
    errorMock = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    exitMock.mockRestore();
    errorMock.mockRestore();
  });

  it("should fail validation on invalid target", async () => {
    await expect(
      runMigrateCommand(tempBaseDir, { target: "invalid-framework" as any })
    ).rejects.toThrow("process.exit called");
    
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("should fail validation on invalid strategy", async () => {
    await expect(
      runMigrateCommand(tempBaseDir, { strategy: "invalid-strat" as any })
    ).rejects.toThrow("process.exit called");
    
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("should fail validation on invalid log format", async () => {
    await expect(
      runMigrateCommand(tempBaseDir, { logFormat: "invalid-format" as any })
    ).rejects.toThrow("process.exit called");
    
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("should fail validation on invalid preset", async () => {
    await expect(
      runMigrateCommand(tempBaseDir, { preset: "invalid-preset" })
    ).rejects.toThrow("process.exit called");
    
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it("should fail validation on non-existent dir", async () => {
    const nonExistentDir = path.join(tempBaseDir, "does-not-exist");
    await expect(
      runMigrateCommand(tempBaseDir, { dir: nonExistentDir })
    ).rejects.toThrow("process.exit called");
    
    expect(exitMock).toHaveBeenCalledWith(1);
  });
});
