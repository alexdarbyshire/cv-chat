import { config } from "dotenv";
import { vi } from "vitest";

// Load .env.local so DB-backed tests can reach POSTGRES_URL etc.
config({ path: ".env.local" });

// `server-only` throws on import in any non-React-Server context. Replace it
// with a no-op so server-side modules (lib/db, lib/rag) can be unit-tested.
vi.mock("server-only", () => ({}));

// Default rerank to off in unit tests so DB-backed search tests don't hit
// the live Cohere endpoint (and don't log "no provider configured" warnings
// when COHERE_API_KEY isn't set in the test env). Tests that exercise
// rerank specifically override per-call via the `rerank` option or by
// explicitly setting CV_CHAT_RERANK before importing the module.
process.env.CV_CHAT_RERANK ??= "off";
