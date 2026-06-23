import express from "express";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

export async function writeSiteOutput(
  outputDir: string,
  htmlPages: Record<string, string>
): Promise<string> {
  await mkdir(outputDir, { recursive: true });
  for (const [slug, html] of Object.entries(htmlPages)) {
    await writeFile(path.join(outputDir, `${slug}.html`), html, "utf-8");
  }
  await writeFile(
    path.join(outputDir, "index.html"),
    htmlPages.home ?? htmlPages[Object.keys(htmlPages)[0]!] ?? "<html><body>No pages</body></html>",
    "utf-8"
  );
  return outputDir;
}

export function startPreviewServer(
  outputDir: string,
  port = 3456
): Promise<{ url: string; close: () => void }> {
  const app = express();
  app.use(express.static(outputDir));

  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      resolve({
        url: `http://localhost:${port}`,
        close: () => server.close(),
      });
    });
  });
}
