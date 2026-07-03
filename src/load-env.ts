import { config } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// .env wins over shell exports (e.g. stale OPENROUTER_API_KEY in ~/.zshrc)
config({ path: path.join(root, ".env"), override: true });
