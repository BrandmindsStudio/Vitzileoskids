import { createContext, useContext, useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { api } from "./api";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Upload from "./pages/Upload";
import Manual from "./pages/Manual";
import Reports from "./pages/Reports";
import ReportDetail from "./pages/ReportDetail";
import Pos from "./pages/Pos";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import ProductNew from "./pages/ProductNew";

interface User {
  id: number;
  email: string;
  name: string | null;
}

const AuthContext = createContext<{ user: User | null; refresh: () => void }>({
  user: null,
  refresh: () => {},
});

export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    api
      .get<User>("/api/auth/me")
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-[var(--ink-muted)]">
        Φόρτωση…
      </div>
    );
  }

  if (!user) {
    return (
      <AuthContext.Provider value={{ user, refresh }}>
        <Login onLogin={refresh} />
      </AuthContext.Provider>
    );
  }

  return (
    <AuthContext.Provider value={{ user, refresh }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/upload" element={<Upload />} />
          <Route path="/manual" element={<Manual />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/reports/:id" element={<ReportDetail />} />
          <Route path="/pos" element={<Pos />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/new" element={<ProductNew />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AuthContext.Provider>
  );
}
