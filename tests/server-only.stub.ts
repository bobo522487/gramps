// Vitest resolves the "server-only" package's default export, which throws at
// import time. Map it to this no-op so unit tests can import server modules.
