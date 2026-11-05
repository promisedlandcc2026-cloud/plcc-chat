import React, { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { HuddleLiveProvider } from './context/HuddleLiveContext';
import { MemberGate } from './components/auth/MemberGate';
import { LazyRoute } from './components/routing/LazyRoute';

/**
 * PLCC Chat — standalone chat + Live Huddle for Promised Land Christian Center.
 *
 * Everything goes through the PLCC Canaan (same rooms, messages and huddles as
 * Vault Chat and PLCC Connect). Paths match Connect so shared links keep working.
 */
const MemberSignIn = lazy(() =>
  import('./pages/MemberSignIn').then((m) => ({ default: m.MemberSignIn }))
);
import SsoHandoff from './pages/SsoHandoff';
const AuthCallback = lazy(() =>
  import('./pages/AuthCallback').then((m) => ({ default: m.AuthCallback }))
);
const SignedOut = lazy(() => import('./pages/SignedOut').then((m) => ({ default: m.SignedOut })));
const ChatHome = lazy(() => import('./pages/ChatHome').then((m) => ({ default: m.ChatHome })));
const ShareToChat = lazy(() => import('./pages/ShareToChat').then((m) => ({ default: m.ShareToChat })));

/** Phone-width column on phones; full-width two-pane chat on desktop (see pages/ChatHome). */
const AppShell: React.FC = () => (
  <div className="min-h-screen max-w-[500px] lg:max-w-[1400px] mx-auto bg-eggshell shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_12px_40px_rgba(0,0,0,0.06)] flex flex-col relative">
    <Routes>
      <Route path="/" element={<Navigate to="/community/chat" replace />} />
      <Route path="/community" element={<Navigate to="/community/chat" replace />} />
      <Route
        path="/sign-in"
        element={
          <LazyRoute label="Loading sign-in…" sectionLabel="sign-in">
            <div className="w-full max-w-[500px] mx-auto flex-1 flex flex-col">
              <MemberSignIn />
            </div>
          </LazyRoute>
        }
      />
      <Route
        path="/signed-out"
        element={
          <LazyRoute label="Signing out…" sectionLabel="sign-out">
            <div className="w-full max-w-[500px] mx-auto flex-1 flex flex-col">
              <SignedOut />
            </div>
          </LazyRoute>
        }
      />
      <Route path="/auth/sso" element={<SsoHandoff fallback="/community/chat" signInPath="/sign-in" />} />
      <Route
        path="/auth/callback"
        element={
          <LazyRoute label="Finishing sign-in…" sectionLabel="sign-in">
            <div className="w-full max-w-[500px] mx-auto flex-1 flex flex-col">
              <AuthCallback />
            </div>
          </LazyRoute>
        }
      />
      <Route
        path="/community/chat"
        element={
          <MemberGate requireAccess="approved_member">
            <LazyRoute label="Loading Chat…" sectionLabel="chat">
              <ChatHome />
            </LazyRoute>
          </MemberGate>
        }
      />
      <Route
        path="/community/chat/:channelId"
        element={
          <MemberGate requireAccess="approved_member">
            <LazyRoute label="Loading Chat…" sectionLabel="chat">
              <ChatHome />
            </LazyRoute>
          </MemberGate>
        }
      />
      <Route
        path="/share"
        element={
          <MemberGate requireAccess="approved_member">
            <LazyRoute label="Opening…" sectionLabel="share">
              <ShareToChat />
            </LazyRoute>
          </MemberGate>
        }
      />
      <Route path="*" element={<Navigate to="/community/chat" replace />} />
    </Routes>
  </div>
);

const App: React.FC = () => (
  <BrowserRouter>
    <AuthProvider>
      <HuddleLiveProvider>
        <AppShell />
      </HuddleLiveProvider>
    </AuthProvider>
  </BrowserRouter>
);

export default App;
