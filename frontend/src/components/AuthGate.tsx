import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { signUp, confirmSignUp, resendSignUpCode, signIn, confirmSignIn, resetPassword, confirmResetPassword } from 'aws-amplify/auth';
import { authConfigured, localDevelopment, syncBackendSession, resumeBackendSession, endAuthenticatedSession } from '../auth-client';
import App from '../App';

type Step = 'signup' | 'signin' | 'verify' | 'new-password' | 'reset-request' | 'reset-confirm';
function authError(reason: unknown) {
  if (!(reason instanceof Error)) return 'We couldn’t complete that. Please try again.';
  if (['NotAuthorizedException', 'UserNotFoundException'].includes(reason.name)) return 'Check your email and password, then try again.';
  if (reason.name === 'CodeMismatchException') return 'That verification code does not match. Please check your email.';
  if (reason.name === 'ExpiredCodeException') return 'This code has expired. Request another code.';
  if (reason.name === 'LimitExceededException' || reason.name === 'TooManyRequestsException') return 'Too many attempts. Please wait a little before trying again.';
  return reason.message;
}
function AuthForm({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [step, setStep] = useState<Step>('signup');
  const [email, setEmail] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [missingAttributes, setMissingAttributes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const titles: Record<Step, string> = { signup: 'A little closer to the wild.', signin: 'Welcome back to your field journal.', verify: 'Check your inbox.', 'new-password': 'Make this account your own.', 'reset-request': 'Let’s get you back in.', 'reset-confirm': 'Choose a new password.' };
  function changeStep(next: Step) { setStep(next); setPassword(''); setCode(''); setError(''); setNotice(''); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const username = email.trim().toLowerCase();
      if (step === 'signup') {
        const result = await signUp({ username, password, options: { userAttributes: { email: username, given_name: first.trim(), family_name: last.trim() } } });
        setPassword('');
        if (result.nextStep.signUpStep === 'CONFIRM_SIGN_UP') { setStep('verify'); setNotice('Enter the code sent to your email address.'); }
        else { setStep('signin'); setNotice('Account created. Sign in to continue.'); }
      } else if (step === 'verify') {
        await confirmSignUp({ username, confirmationCode: code.trim() });
        setStep('signin'); setCode(''); setNotice('Email verified. You can now sign in.');
      } else if (step === 'signin') {
        const result = await signIn({ username, password }); setPassword('');
        if (result.isSignedIn) await onAuthenticated();
        else if (result.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          setMissingAttributes((result.nextStep.missingAttributes ?? []).map(String)); setStep('new-password');
          setNotice('Your temporary password must be replaced before you can continue.');
        } else if (result.nextStep.signInStep === 'CONFIRM_SIGN_UP') { setStep('verify'); setNotice('Verify your email before signing in. You can request a new code below.'); }
        else if (result.nextStep.signInStep === 'RESET_PASSWORD') { setStep('reset-request'); setNotice('Reset your password to continue.'); }
        else throw new Error('This account requires an additional sign-in method. Please check the account configuration.');
      } else if (step === 'new-password') {
        const result = await confirmSignIn({ challengeResponse: password, options: { userAttributes: {
          ...(missingAttributes.includes('given_name') ? { given_name: first.trim() } : {}),
          ...(missingAttributes.includes('family_name') ? { family_name: last.trim() } : {}),
        } } });
        setPassword('');
        if (result.isSignedIn) await onAuthenticated();
        else throw new Error('An additional sign-in step is required. Please check the account configuration.');
      } else if (step === 'reset-request') {
        await resetPassword({ username }); setStep('reset-confirm'); setNotice('If the account can be recovered, a verification code will be sent to your email.');
      } else {
        await confirmResetPassword({ username, confirmationCode: code.trim(), newPassword: password });
        setPassword(''); setCode(''); setStep('signin'); setNotice('Password reset. Sign in with your new password.');
      }
    } catch (reason) { setError(authError(reason)); }
    finally { setBusy(false); }
  }
  async function resend() {
    setBusy(true); setError(''); setNotice('');
    try { await resendSignUpCode({ username: email.trim().toLowerCase() }); setNotice('A new verification code has been requested. Check your inbox.'); }
    catch (reason) { setError(authError(reason)); }
    finally { setBusy(false); }
  }
  const needsPassword = ['signup', 'signin', 'new-password', 'reset-confirm'].includes(step);
  return <div className="auth-shell"><section className="auth-story"><a className="brand" href="/"><span className="brand-mark" aria-hidden="true">❋</span><span>EcoGuard<small>FRIENDS & FOES</small></span></a><div><div className="eyebrow">OBSERVE. UNDERSTAND. PROTECT.</div><h1>Small sightings.<em>A bigger picture.</em></h1><p>A shared view of Australia’s wildlife and the pets we call family.</p></div><span className="auth-flower" aria-hidden="true">❋</span></section>
    <main className="auth-main"><div className="eyebrow">YOUR ECOGUARD COMMUNITY</div><h2>{titles[step]}</h2><p className="muted">{step === 'signup' ? 'Create an account to document sightings, explore species and help lost pets find home.' : 'Your collection and sightings are protected by your account.'}</p>
      <form onSubmit={submit}><fieldset disabled={busy}>
        <label className="field">Email<input type="email" required autoComplete="username" value={email} disabled={step === 'new-password'} onChange={event => setEmail(event.target.value)} /></label>
        {(step === 'signup' || step === 'new-password' && missingAttributes.includes('given_name')) && <label className="field">First name<input required autoComplete="given-name" value={first} onChange={event => setFirst(event.target.value)} /></label>}
        {(step === 'signup' || step === 'new-password' && missingAttributes.includes('family_name')) && <label className="field">Last name<input required autoComplete="family-name" value={last} onChange={event => setLast(event.target.value)} /></label>}
        {(step === 'verify' || step === 'reset-confirm') && <label className="field">Email verification code<input required autoComplete="one-time-code" inputMode="numeric" value={code} onChange={event => setCode(event.target.value)} /></label>}
        {needsPassword && <label className="field">{step === 'new-password' || step === 'reset-confirm' ? 'New password' : 'Password'}<input type="password" required minLength={step === 'signin' ? undefined : 8} autoComplete={step === 'signin' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} />{step !== 'signin' && <span className="hint">Use at least 8 characters, including uppercase, lowercase, a number and a symbol.</span>}</label>}
        <button className="button primary" type="submit">{busy ? 'Please wait…' : step === 'signup' ? 'Create account' : step === 'signin' ? 'Sign in' : step === 'verify' ? 'Verify email' : step === 'reset-request' ? 'Send recovery code' : 'Save new password'}<span aria-hidden="true">↗</span></button>
      </fieldset></form>
      {error && <p className="notice error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}
      <div className="auth-links">{step === 'signup' ? <button className="text-button" disabled={busy} onClick={() => changeStep('signin')}>Already a member? Sign in</button> : <button className="text-button" disabled={busy} onClick={() => changeStep('signup')}>Create an account</button>}
        {step !== 'signin' && step !== 'signup' && <button className="text-button" disabled={busy} onClick={() => changeStep('signin')}>Back to sign in</button>}
        {step === 'signin' && <button className="text-button" disabled={busy} onClick={() => changeStep('reset-request')}>Forgot password?</button>}
        {step === 'verify' && <button className="text-button" disabled={busy} onClick={() => void resend()}>Request a new verification code</button>}</div>
    </main></div>;
}
export default function AuthGate() {
  const [status, setStatus] = useState<'checking' | 'signedout' | 'signedin'>('checking');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const loggingOut = useRef(false);
  async function authenticated() {
    generation.current++;
    resumeBackendSession();
    const profile = await syncBackendSession();
    if (!profile) throw new Error('Sign-in did not produce an application session. Please try again.');
    setName(profile); setError(''); setStatus('signedin');
  }
  useEffect(() => {
    if (!authConfigured || localDevelopment) return;
    let active = true;
    const check = async () => {
      if (loggingOut.current) return;
      const current = generation.current;
      try {
        const profile = await syncBackendSession();
        if (!active || current !== generation.current || loggingOut.current) return;
        if (profile) { setName(profile); setStatus('signedin'); }
        else setStatus('signedout');
      } catch (reason) { if (active && current === generation.current && !loggingOut.current) { setError(authError(reason)); setStatus('signedout'); } }
    };
    void check();
    const timer = window.setInterval(() => { void check(); }, 60000);
    const expired = () => { setStatus('signedout'); setError('Your application session ended. Please sign in again.'); };
    window.addEventListener('ecoguard:session-expired', expired);
    return () => { active = false; clearInterval(timer); window.removeEventListener('ecoguard:session-expired', expired); };
  }, []);
  async function logout() {
    loggingOut.current = true; generation.current++;
    setError(''); setStatus('checking');
    // Clear the server cookie first; failed cleanup must not be presented as successful logout.
    try { await endAuthenticatedSession(); setName(''); setStatus('signedout'); }
    catch (reason) { setError(authError(reason)); setStatus('signedin'); }
    finally { loggingOut.current = false; }
  }
  if (localDevelopment) return <App />;
  if (!authConfigured) return <main className="auth-main"><h1>EcoGuard is getting ready.</h1><p className="muted">Authentication must be configured before this application can be used.</p></main>;
  if (status === 'checking') return <main className="empty-state" role="status"><span className="loading-ring" />Checking your session…</main>;
  if (status === 'signedin') return <>{error && <p className="notice error" role="alert">{error}</p>}<App accountName={name} onSignOut={logout} /></>;
  return <>{error && <p className="notice error" role="alert">{error}</p>}<AuthForm onAuthenticated={authenticated} /></>;
}
