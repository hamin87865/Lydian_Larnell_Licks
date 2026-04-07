import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import Login from "@/pages/Login";
import Signup from "@/pages/Signup";
import MyPage from "@/pages/MyPage";
import Admin from "@/pages/Admin";
import VideoUpload from "@/pages/VideoUpload";
import MusicianProfile from "@/pages/MusicianProfile";
import Drums from "@/pages/Drums";
import Piano from "@/pages/Piano";
import Bass from "@/pages/Bass";
import Guitar from "@/pages/Guitar";
import ContentDetail from "@/pages/ContentDetail";
import Payment from "@/pages/Payment";
import MusiciansApplication from "@/pages/MusiciansApplication";
import MusicianProfilePage from "@/pages/MusicianProfilePage";
import EditProfile from "@/pages/EditProfile";
import { Navbar } from "@/components/Navbar";
import { ScrollToTop } from "@/components/ScrollToTop";
import TermsPage from "@/pages/policy/TermsPage";
import PrivacyPage from "@/pages/policy/PrivacyPage";
import RefundPage from "@/pages/policy/RefundPage";
import SettlementPage from "@/pages/policy/SettlementPage";
import BusinessPage from "@/pages/policy/BusinessPage";
import ResetPassword from "@/pages/ResetPassword";

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/mypage" component={MyPage} />
      <Route path="/musicians-application" component={MusiciansApplication} />
      <Route path="/musician-profile" component={MusicianProfilePage} />
      <Route path="/musician-profile/edit" component={EditProfile} />
      <Route path="/musician-profile/:id" component={MusicianProfilePage} />
      <Route path="/admin" component={Admin} />
      <Route path="/upload" component={VideoUpload} />
      <Route path="/musician" component={MusicianProfile} />
      <Route path="/drums" component={Drums} />
      <Route path="/piano" component={Piano} />
      <Route path="/bass" component={Bass} />
      <Route path="/guitar" component={Guitar} />
      <Route path="/content/:id" component={ContentDetail} />
      <Route path="/payment/:id" component={Payment} />
      <Route path="/terms" component={TermsPage} />
      <Route path="/privacy" component={PrivacyPage} />
      <Route path="/refund" component={RefundPage} />
      <Route path="/settlement" component={SettlementPage} />
      <Route path="/business" component={BusinessPage} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AppShell() {
  const [location] = useLocation();

  const hideNavbarRoutes = [
    "/signup",
    "/login",
    "/terms",
    "/privacy",
    "/refund",
    "/settlement",
    "/business",
    "/musician-profile/edit",
    "/reset-password",
    "/musicians-application",
  ];
  const shouldHideNavbar = hideNavbarRoutes.includes(location);

  return (
    <TooltipProvider>
      <Toaster />
      <ScrollToTop />
      {!shouldHideNavbar && <Navbar />}
      <AppRoutes />
    </TooltipProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <WouterRouter>
          <AppShell />
        </WouterRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
