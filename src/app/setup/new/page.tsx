import Link from "next/link";
import { requireOperatorPage } from "@/lib/setup/operator";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IntakeForm } from "@/components/setup/intake-form";

export default async function NewRunPage() {
  await requireOperatorPage();
  return (
    <div className="space-y-6">
      <Link href="/setup" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        All runs
      </Link>

      <Card>
        <CardHeader>
          <CardTitle>New onboarding run</CardTitle>
          <CardDescription>
            Submit intake to spin up a client. The engine generates the config, fills the agent prompt, and runs a QA go/no-go — then pauses for you at the first step that needs a human.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <IntakeForm />
        </CardContent>
      </Card>
    </div>
  );
}
