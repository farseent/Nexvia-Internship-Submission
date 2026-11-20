import type { Metadata } from 'next';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = { title: 'Sign in · CoNote' };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <LoginForm />
    </>
  );
}
