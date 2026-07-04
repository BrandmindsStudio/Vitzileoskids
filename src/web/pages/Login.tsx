import { useState, type FormEvent } from "react";
import { api, ApiError } from "../api";

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { email, password });
      onLogin();
    } catch (err) {
      if (err instanceof ApiError && err.code === "rate_limited") {
        setError("Πολλές αποτυχημένες προσπάθειες. Δοκιμάστε ξανά σε 15 λεπτά.");
      } else {
        setError("Λάθος email ή κωδικός.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Vitzileos Kids</h1>
          <p className="mt-1 text-sm text-[var(--ink-2)]">Ημερήσιες πωλήσεις — Δελτία «Ζ»</p>
        </div>
        <div className="space-y-3 rounded-2xl bg-[var(--surface-1)] p-5 shadow-sm ring-1 ring-black/10">
          <label className="block">
            <span className="text-sm font-medium">Email</span>
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/15 px-3 py-3 text-base"
            />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Κωδικός</span>
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-black/15 px-3 py-3 text-base"
            />
          </label>
          {error && <p className="text-sm text-[var(--delta-down)]">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-[var(--series-1)] py-3 text-base font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Σύνδεση…" : "Σύνδεση"}
          </button>
        </div>
      </form>
    </div>
  );
}
