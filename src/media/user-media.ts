import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export type UserMediaKind = "logo" | "photo";

export interface UserMediaAsset {
  kind: UserMediaKind;
  filename: string;
  absolutePath: string;
  publicSrc: string;
  mime: string;
}

export interface UserMediaSnapshot {
  logoSrc?: string;
  files: UserMediaAsset[];
}

export interface DecodedUpload {
  name: string;
  mime: string;
  data: string;
}

export class UserMediaLibrary {
  logo?: UserMediaAsset;
  photos: UserMediaAsset[] = [];
  private photoCursor = 0;

  takePhoto(): UserMediaAsset | undefined {
    if (this.photoCursor >= this.photos.length) return undefined;
    return this.photos[this.photoCursor++];
  }

  remainingPhotos(): number {
    return Math.max(0, this.photos.length - this.photoCursor);
  }

  snapshot(): UserMediaSnapshot {
    const files = [...(this.logo ? [this.logo] : []), ...this.photos];
    return { logoSrc: this.logo?.publicSrc, files };
  }
}

function safeExt(name: string, mime: string): string {
  const fromName = path.extname(name).toLowerCase();
  if (ALLOWED_EXT.has(fromName)) return fromName === ".jpeg" ? ".jpg" : fromName;
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  return ".jpg";
}

function publicName(kind: UserMediaKind, index: number, ext: string): string {
  if (kind === "logo") return `logo${ext}`;
  return `photo-${String(index + 1).padStart(2, "0")}${ext}`;
}

export async function writeDecodedUploads(
  destDir: string,
  logo?: DecodedUpload,
  photos: DecodedUpload[] = []
): Promise<UserMediaLibrary> {
  await fs.mkdir(destDir, { recursive: true });
  const library = new UserMediaLibrary();
  // `publicSrc` must resolve against the static mount at `/media` -> `output/_user-media` (see
  // `playground-server.ts`), which serves every session's subfolder, not one flat directory — a
  // bare `/media/<filename>` collided across sessions/uploads (two logos both named `logo.png`
  // resolved to the same URL) and, before that mount existed at all, 404'd outright. The session
  // folder name is `destDir`'s own basename, so this needs nothing new threaded through.
  const publicPrefix = `/media/${path.basename(destDir)}`;

  if (logo?.data) {
    const ext = safeExt(logo.name, logo.mime);
    const filename = publicName("logo", 0, ext);
    const absolutePath = path.join(destDir, filename);
    await fs.writeFile(absolutePath, Buffer.from(logo.data, "base64"));
    library.logo = {
      kind: "logo",
      filename,
      absolutePath,
      publicSrc: `${publicPrefix}/${filename}`,
      mime: logo.mime || EXT_MIME[ext] || "image/jpeg",
    };
  }

  const limited = photos.filter((p) => p?.data).slice(0, 8);
  for (let i = 0; i < limited.length; i++) {
    const photo = limited[i]!;
    const ext = safeExt(photo.name, photo.mime);
    const filename = publicName("photo", i, ext);
    const absolutePath = path.join(destDir, filename);
    await fs.writeFile(absolutePath, Buffer.from(photo.data, "base64"));
    library.photos.push({
      kind: "photo",
      filename,
      absolutePath,
      publicSrc: `${publicPrefix}/${filename}`,
      mime: photo.mime || EXT_MIME[ext] || "image/jpeg",
    });
  }

  return library;
}

export async function loadUserMediaFromDisk(options: {
  logoPath?: string;
  photosDir?: string;
  destDir: string;
}): Promise<UserMediaLibrary> {
  await fs.mkdir(options.destDir, { recursive: true });
  const library = new UserMediaLibrary();
  const publicPrefix = `/media/${path.basename(options.destDir)}`;

  if (options.logoPath) {
    const src = path.resolve(options.logoPath);
    const ext = safeExt(src, "");
    const filename = publicName("logo", 0, ext);
    const absolutePath = path.join(options.destDir, filename);
    await fs.copyFile(src, absolutePath);
    library.logo = {
      kind: "logo",
      filename,
      absolutePath,
      publicSrc: `${publicPrefix}/${filename}`,
      mime: EXT_MIME[ext] || "image/png",
    };
  }

  if (options.photosDir) {
    const dir = path.resolve(options.photosDir);
    const names = (await fs.readdir(dir))
      .filter((name) => ALLOWED_EXT.has(path.extname(name).toLowerCase()))
      .sort()
      .slice(0, 8);
    for (let i = 0; i < names.length; i++) {
      const src = path.join(dir, names[i]!);
      const ext = safeExt(names[i]!, "");
      const filename = publicName("photo", i, ext);
      const absolutePath = path.join(options.destDir, filename);
      await fs.copyFile(src, absolutePath);
      library.photos.push({
        kind: "photo",
        filename,
        absolutePath,
        publicSrc: `${publicPrefix}/${filename}`,
        mime: EXT_MIME[ext] || "image/jpeg",
      });
    }
  }

  return library;
}

export function emptyMediaSessionDir(sessionId?: string): string {
  return path.resolve("output", "_user-media", sessionId ?? randomUUID());
}

export function isResolvedImageSrc(src: unknown): boolean {
  if (typeof src !== "string" || !src.trim()) return false;
  return src.startsWith("https://") || src.startsWith("/media/");
}
