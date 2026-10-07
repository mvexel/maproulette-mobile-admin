/**
 * Local development against the mock backend: starts the mock on 127.0.0.1:9300 and the Vite
 * dev server on http://localhost:5173, whose /config.json points at the mock.
 *
 * Run: npm run dev:mock
 */
import { createServer } from "vite";
import { startMockBackend } from "./server.ts";

const appOrigin = "http://localhost:5173";
const mock = await startMockBackend({ adminOrigin: appOrigin }, 9300);
process.env.ADMIN_BACKEND = mock.url;
console.log(`Mock backend on ${mock.url}`);

const vite = await createServer({ server: { port: 5173, strictPort: true } });
await vite.listen();
vite.printUrls();
