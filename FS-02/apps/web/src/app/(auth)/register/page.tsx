import type { Metadata } from 'next';
import { RegisterForm } from '@/components/register-form';

export const metadata: Metadata = { title: 'Create account · CoNote' };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <RegisterForm />
    </>
  );
}
