import { describe, expect, it } from "vitest";
import { gunzipSync } from "zlib";
import { isGzipBytes, prepareStorageBody } from "../src/hosting/gzip-storage.js";

describe("gzip-storage", () => {
  it("gzips html when enabled", () => {
    const raw = Buffer.from("<!DOCTYPE html><html></html>", "utf8");
    const out = prepareStorageBody("index.html", raw, true);
    expect(out.contentType).toBe("application/octet-stream");
    expect(isGzipBytes(out.body.buffer)).toBe(true);
    expect(gunzipSync(out.body).toString()).toBe(raw.toString());
  });

  it("leaves css unchanged", () => {
    const raw = Buffer.from("body{}", "utf8");
    const out = prepareStorageBody("app.css", raw, true);
    expect(out.body.equals(raw)).toBe(true);
  });
});
