import React from 'react';
import { Link } from 'react-router-dom';
import { AWCLogo } from '../components/ui/AWCLogo';
import { CONNECT_URL, VAULT_URL } from '../lib/appLinks';

/** After "Sign out": where to go next. */
export const SignedOut: React.FC = () => (
  <main className="flex-1 px-6 pt-16 pb-10 flex flex-col items-center text-center">
    <AWCLogo size={88} className="mb-4" />
    <h1 className="text-2xl font-bold text-[#1A1A1A]">You’re signed out of PLCC Chat</h1>
    <p className="text-sm text-gray-500 mt-2 max-w-sm">Where would you like to go?</p>
    <div className="w-full max-w-sm mt-8 space-y-3">
      <a
        href={CONNECT_URL}
        className="w-full min-h-[56px] rounded-2xl bg-burgundy text-white font-extrabold text-base flex items-center justify-center"
      >
        Go to PLCC Connect
      </a>
      <a
        href={VAULT_URL}
        className="w-full min-h-[56px] rounded-2xl bg-wine text-cream font-extrabold text-base flex items-center justify-center"
      >
        Go to the PLCC Vault
      </a>
      <Link
        to="/sign-in"
        className="w-full min-h-[56px] rounded-2xl border-2 border-burgundy text-burgundy font-extrabold text-base flex items-center justify-center"
      >
        Sign in to PLCC Chat again
      </Link>
    </div>
  </main>
);
