import { useState } from 'react';
import { tokenStore } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/field';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useLogin, useSignup } from './api/auth';
import { MfaCodeForm } from './Mfa';

const done = () => { window.location.href = '/employees'; };

export function Login() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [step, setStep] = useState<'password' | 'code'>('password');
  const login = useLogin();
  const signup = useSignup();

  const pending = login.isPending || signup.isPending;
  const error = (login.error ?? signup.error) as Error | null;

  /**
   * The code is asked for here, straight after the password, when this user has
   * an authenticator AND their access in this company needs it — so a Payroll
   * Admin is not interrupted mid-form later. Someone who has not set one up yet
   * goes straight in: what needs MFA will ask for it, and offer setup, itself.
   */
  if (step === 'code') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Enter your code</CardTitle>
            <CardDescription>From the authenticator app on your phone.</CardDescription>
          </CardHeader>
          <CardContent>
            <MfaCodeForm purpose="verify" onDone={done} />
            <button
              type="button"
              onClick={() => {
                tokenStore.clear();
                login.reset();
                setStep('password');
              }}
              className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
            >
              Sign in as someone else
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);

    if (mode === 'login') {
      login.mutate(
        { email: String(f.get('email')), password: String(f.get('password')) },
        { onSuccess: (result) => (result.mfaRequired && result.mfaEnrolled ? setStep('code') : done()) },
      );
    } else {
      signup.mutate({
        companyName: String(f.get('companyName')),
        adminFirstName: String(f.get('adminFirstName')),
        adminEmail: String(f.get('email')),
        adminPassword: String(f.get('password')),
      }, { onSuccess: done });
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{mode === 'login' ? 'Sign in to PeoplePulse' : 'Set up your company'}</CardTitle>
          <CardDescription>
            {mode === 'login'
              ? 'HR, payroll, attendance and leave — in one place.'
              : 'Takes about a minute. You can invite your team afterwards.'}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <Field label="Company name" required>
                  <Input name="companyName" required placeholder="Acme Textiles Pvt Ltd" />
                </Field>
                <Field label="Your name" required>
                  <Input name="adminFirstName" required placeholder="Priya" />
                </Field>
              </>
            )}

            <Field label="Work email" required>
              <Input name="email" type="email" required placeholder="priya@company.in" />
            </Field>

            <Field
              label="Password"
              required
              hint={mode === 'signup' ? 'At least 12 characters. A phrase works well.' : undefined}
            >
              <Input name="password" type="password" required />
            </Field>

            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error.message}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? 'Just a moment…' : mode === 'login' ? 'Sign in' : 'Create company'}
            </Button>
          </form>

          <button
            type="button"
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground"
          >
            {mode === 'login'
              ? "Don't have an account? Set up your company"
              : 'Already have an account? Sign in'}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
