import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const from = path.join(process.cwd(), "node_modules", "@mediapipe", "tasks-vision", "wasm");
const to = path.join(process.cwd(), "public", "mediapipe", "wasm");

await mkdir(to, { recursive: true });
await cp(from, to, { recursive: true });

