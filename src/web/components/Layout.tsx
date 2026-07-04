import type { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../App";

const tabs = [
  { to: "/", label: "Αρχική", icon: "📊" },
  { to: "/upload", label: "Φωτογραφία Ζ", icon: "📷" },
  { to: "/manual", label: "Χειροκίνητα", icon: "✍️" },
  { to: "/reports", label: "Αναφορές", icon: "📁" },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();

  const logout = async () => {
    await api.post("/api/auth/logout");
    refresh();
    navigate("/");
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col">
      <header className="flex items-center justify-between px-4 pb-2 pt-4">
        <h1 className="text-lg font-bold">Vitzileos Kids</h1>
        <button
          onClick={logout}
          className="rounded-lg px-3 py-2 text-sm text-[var(--ink-2)] active:bg-black/5"
          title={user?.email}
        >
          Έξοδος
        </button>
      </header>

      <main className="flex-1 px-4 pb-28">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-[var(--surface-1)] pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-3xl">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === "/"}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] ${
                  isActive ? "font-semibold text-[var(--series-1)]" : "text-[var(--ink-2)]"
                }`
              }
            >
              <span className="text-xl leading-none">{t.icon}</span>
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
