import { ForgotForm } from "../AuthForms";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Reset your password</h1>
      <p className="mb-5 text-sm text-muted">We&apos;ll email you a link to choose a new one.</p>
      <ForgotForm />
    </>
  );
}
