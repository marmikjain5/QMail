import { Shield, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LoginPage() {
  const handleGoogleLogin = () => {
    window.location.href = 'http://localhost:3000/api/auth/google/start';
  };

  const handleMicrosoftLogin = () => {
    window.location.href = 'http://localhost:3000/api/auth/microsoft/start';
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <Shield className="h-12 w-12 text-cyan-400" />
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-white">
          QuMail
        </h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          Quantum-Secured Email Platform
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-4 shadow sm:rounded-lg sm:px-10 border border-slate-800">
          <div className="space-y-4">
            <Button
              className="w-full flex justify-center items-center gap-2 bg-white text-slate-900 hover:bg-slate-100"
              onClick={handleGoogleLogin}
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Sign in with Google
            </Button>

            <Button
              className="w-full flex justify-center items-center gap-2 bg-[#2F2F2F] text-white hover:bg-[#3F3F3F]"
              onClick={handleMicrosoftLogin}
            >
              <svg className="h-5 w-5" viewBox="0 0 21 21">
                <rect x="1" y="1" width="9" height="9" fill="#f25022" />
                <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
                <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
              </svg>
              Sign in with Microsoft
            </Button>
          </div>

          <div className="mt-8 pt-6 border-t border-slate-800">
            <h3 className="text-sm font-medium text-slate-300 mb-4 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              Security Guarantees
            </h3>
            <ul className="text-xs text-slate-500 space-y-2">
              <li>• Information-theoretic security with OTP</li>
              <li>• AES-256-GCM authenticated encryption</li>
              <li>• ML-driven continuous anomaly detection</li>
              <li>• Blockchain-anchored attachment provenance</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
