import { ResetForm } from "../AuthForms";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return (
    <>
      <h1 className="mb-5 text-lg font-semibold">Choose a new password</h1>
      <ResetForm token={token} />
    </>
  );
}
