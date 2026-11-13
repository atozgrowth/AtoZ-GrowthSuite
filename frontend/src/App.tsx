import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppLayout } from "./layouts/AppLayout";
import { AccountPage } from "./pages/AccountPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { WordPressManagerPage } from "./wp-manager/WordPressManagerPage";
export default function App() { return <Routes><Route path="/login" element={<LoginPage />} /><Route path="/auth/callback" element={<AuthCallbackPage />} /><Route element={<ProtectedRoute />}><Route element={<AppLayout />}><Route index element={<Navigate to="/dashboard" replace />} /><Route path="dashboard" element={<DashboardPage />} /><Route path="wordpress" element={<WordPressManagerPage />} /><Route path="account" element={<AccountPage />} /></Route></Route><Route path="*" element={<NotFoundPage />} /></Routes>; }
