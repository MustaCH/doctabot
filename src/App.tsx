import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import Login from "./pages/Login";
import Chat from "./pages/Chat";
import Onboarding from "./pages/Onboarding";
import Profile from "./pages/Profile";
import Properties from "./pages/Properties";
import Clients from "./pages/Clients";
import Dashboard from "./pages/Dashboard";
import SuperAdmin from "./pages/SuperAdmin";
import Tutorial from "./pages/Tutorial";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const Spinner = () => (
  <div className="flex min-h-screen items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
  </div>
);

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, hasProfile } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasProfile) return <Navigate to="/onboarding" replace />;
  // Existing users who never went through new onboarding flow
  if (!localStorage.getItem("alan_onboarding_done")) {
    localStorage.setItem("alan_onboarding_done", "true");
  }
  const tutorialDone = localStorage.getItem("alan_tutorial_done");
  if (!tutorialDone && window.location.pathname === "/") {
    return <Navigate to="/tutorial" replace />;
  }
  return <>{children}</>;
}

function TutorialRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, hasProfile } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (!hasProfile) return <Navigate to="/onboarding" replace />;
  const tutorialDone = localStorage.getItem("alan_tutorial_done");
  if (tutorialDone) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function OnboardingRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, hasProfile } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  const onboardingDone = localStorage.getItem("alan_onboarding_done");
  if (hasProfile && onboardingDone) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, hasProfile } = useAuth();
  if (loading) return <Spinner />;
  if (user && hasProfile) return <Navigate to="/" replace />;
  if (user && !hasProfile) return <Navigate to="/onboarding" replace />;
  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/onboarding" element={<OnboardingRoute><Onboarding /></OnboardingRoute>} />
            <Route path="/tutorial" element={<TutorialRoute><Tutorial /></TutorialRoute>} />
            <Route path="/" element={<ProtectedRoute><Chat /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/properties" element={<ProtectedRoute><Properties /></ProtectedRoute>} />
            <Route path="/clients" element={<ProtectedRoute><Clients /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/superadminpanel" element={<SuperAdmin />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
