import { config } from "dotenv";
import { vi } from "vitest";

// Load .env.local so DB-backed tests can reach POSTGRES_URL etc.
config({ path: ".env.local" });

// `server-only` throws on import in any non-React-Server context. Replace it
// with a no-op so server-side modules (lib/db, lib/rag) can be unit-tested.
vi.mock("server-only", () => ({}));
