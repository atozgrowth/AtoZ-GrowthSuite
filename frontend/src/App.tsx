import { Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppLayout } from "./layouts/AppLayout";
import { AccountPage } from "./pages/AccountPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { ModulePage } from "./pages/ModulePage";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { WordPressManagerPage } from "./wp-manager/WordPressManagerPage";
import { AdminBoundary, WorkspaceBoundary, WorkspaceRedirect } from "./workspace/WorkspaceRoutes";
export default function App() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} /><Route path="/signup" element={<LoginPage />} /><Route path="/auth/callback" element={<AuthCallbackPage />} />
    <Route element={<ProtectedRoute />}>
      <Route index element={<WorkspaceRedirect />} />
      <Route path="dashboard" element={<WorkspaceRedirect />} /><Route path="wordpress" element={<WorkspaceRedirect page="wordpress" />} /><Route path="account" element={<WorkspaceRedirect page="account" />} />
      <Route path="workspace/:workspaceId" element={<WorkspaceBoundary />}><Route element={<AppLayout />}>
        <Route index element={<WorkspaceRedirect />} /><Route path="dashboard" element={<DashboardPage />} /><Route path="wordpress" element={<WordPressManagerPage />} /><Route path="account" element={<AccountPage />} /><Route path="modules/:moduleId" element={<ModulePage />} />
      </Route></Route>
      <Route element={<AppLayout />}><Route element={<AdminBoundary />}><Route path="admin" element={<AdminDashboardPage />} /></Route></Route>
    </Route><Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
