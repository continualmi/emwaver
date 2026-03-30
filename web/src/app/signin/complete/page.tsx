import { Suspense } from "react";
import SignInCompleteClient from "./SignInCompleteClient";

export const dynamic = "force-dynamic";

export default function SignInCompletePage() {
  return (
    <Suspense>
      <SignInCompleteClient />
    </Suspense>
  );
}
