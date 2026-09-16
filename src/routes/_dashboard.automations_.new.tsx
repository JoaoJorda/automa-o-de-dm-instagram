import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAutomation } from "@/functions/automations.functions";
import { AutomationForm, type AutomationFormValues } from "@/components/automation-form";

export const Route = createFileRoute("/_dashboard/automations_/new")({
  component: NewAutomationPage,
});

function extractPostId(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "*") return "*";
  const urlMatch = trimmed.match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return trimmed;
}

function NewAutomationPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState<"post" | "config">("post");
  const [postInput, setPostInput] = useState("");
  const [initialValues, setInitialValues] = useState<AutomationFormValues | null>(null);

  const createM = useMutation({
    mutationFn: (data: Parameters<typeof createAutomation>[0]["data"]) =>
      createAutomation({ data }),
    onSuccess: () => {
      toast.success("Automação criada!");
      qc.invalidateQueries({ queryKey: ["automations"] });
      navigate({ to: "/automations" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function handleConfirmPost() {
    const id = extractPostId(postInput);
    if (!id) return toast.error("Insira uma URL ou ID do post");
    setInitialValues({
      name: id === "*" ? "Todos os posts" : `Post ${id.slice(0, 8)}`,
      instagram_post_id: id,
      instagram_post_type: "post",
      custom_message: "",
      followup_message: "Clica aqui pra receber 👇",
      quick_replies: [],
      buttons: [],
      is_active: true,
      keyword_filter_enabled: false,
      keywords: "",
      delay_min_seconds: 30,
      delay_max_seconds: 60,
      trigger_on_dm: false,
      require_follow: false,
      follower_gate_message: "",
    });
    setStep("config");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Criar Automação</h1>
        <p className="text-sm text-muted-foreground">
          Configure a resposta automática para comentários em um post.
        </p>
      </div>

      {step === "post" && (
        <Card>
          <CardContent className="flex flex-col gap-4 py-6">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="post-url">URL ou ID do post do Instagram</Label>
              <p className="text-xs text-muted-foreground">
                Cole a URL do post ou somente o ID. Use{" "}
                <code className="rounded bg-muted px-1 text-[11px]">*</code> pra todos os posts.
              </p>
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="post-url"
                  placeholder="https://www.instagram.com/p/..."
                  value={postInput}
                  onChange={(e) => setPostInput(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleConfirmPost} disabled={!postInput.trim()}>
                Continuar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "config" && initialValues && (
        <AutomationForm
          initialValues={initialValues}
          submitLabel="Salvar"
          submitting={createM.isPending}
          onSubmit={(data) => createM.mutate(data)}
        />
      )}
    </div>
  );
}
