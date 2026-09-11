import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MediaRegistry } from "../src/media/media-registry.js";
import { resolveUniqueImage } from "../src/media/enrich-content.js";
import {
  UserMediaLibrary,
  writeDecodedUploads,
  loadUserMediaFromDisk,
} from "../src/media/user-media.js";

const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("user media", () => {
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(dirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    dirs.length = 0;
  });

  it("writes logo and photos to /media public paths", async () => {
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), "wg-media-"));
    dirs.push(dest);
    const library = await writeDecodedUploads(
      dest,
      { name: "mark.png", mime: "image/png", data: TINY_PNG },
      [
        { name: "store.jpg", mime: "image/jpeg", data: TINY_PNG },
        { name: "team.png", mime: "image/png", data: TINY_PNG },
      ]
    );
    // publicSrc is namespaced by the destination folder's own name — it must resolve against the
    // real static mount (`/media` -> `output/_user-media`, see `playground-server.ts`), which
    // serves one subfolder per upload session, not one flat directory. A bare `/media/logo.png`
    // collided across uploads (two sessions' logos both resolving to the same URL) before this.
    const prefix = `/media/${path.basename(dest)}`;
    expect(library.logo?.publicSrc).toBe(`${prefix}/logo.png`);
    expect(library.photos.map((p) => p.publicSrc)).toEqual([`${prefix}/photo-01.jpg`, `${prefix}/photo-02.png`]);
    expect(library.takePhoto()?.publicSrc).toBe(`${prefix}/photo-01.jpg`);
    expect(library.takePhoto()?.publicSrc).toBe(`${prefix}/photo-02.png`);
    expect(library.takePhoto()).toBeUndefined();
  });

  it("loads photos from a folder", async () => {
    const srcDir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-photos-"));
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), "wg-media-"));
    dirs.push(srcDir, dest);
    await fs.writeFile(path.join(srcDir, "a.png"), Buffer.from(TINY_PNG, "base64"));
    const library = await loadUserMediaFromDisk({ photosDir: srcDir, destDir: dest });
    expect(library.photos).toHaveLength(1);
    expect(library.photos[0]?.filename).toBe("photo-01.png");
  });

  it("uses uploaded photos before stock URLs", async () => {
    const dest = await fs.mkdtemp(path.join(os.tmpdir(), "wg-media-"));
    dirs.push(dest);
    const library = new UserMediaLibrary();
    library.photos.push({
      kind: "photo",
      filename: "photo-01.jpg",
      absolutePath: path.join(dest, "photo-01.jpg"),
      publicSrc: "/media/photo-01.jpg",
      mime: "image/jpeg",
    });
    const registry = new MediaRegistry();
    registry.userMedia = library;
    const src = await resolveUniqueImage(
      "salon interior",
      "test-key",
      registry,
      "home_hero",
      "home_hero",
      "home",
      800,
      600
    );
    expect(src).toBe("/media/photo-01.jpg");
    const second = await resolveUniqueImage(
      "another room",
      "test-key-2",
      registry,
      "home_gallery",
      "home_gallery",
      "home",
      800,
      600
    );
    expect(second).toMatch(/^https:\/\//);
  });
});
