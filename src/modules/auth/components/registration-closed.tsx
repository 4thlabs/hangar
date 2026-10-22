import { Link } from "waku";
import { buttonVariants } from "#modules/common/ui/button.tsx";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "#modules/common/ui/card.tsx";

/** What /register shows once the first account exists: there is nothing left to sign up for. */
export function RegistrationClosed() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Registration is closed</CardTitle>
        <CardDescription>This Hangar already has its account. Sign in with it instead.</CardDescription>
      </CardHeader>
      <CardFooter>
        <Link to="/login" className={buttonVariants({ className: "w-full" })}>
          Sign in
        </Link>
      </CardFooter>
    </Card>
  );
}
