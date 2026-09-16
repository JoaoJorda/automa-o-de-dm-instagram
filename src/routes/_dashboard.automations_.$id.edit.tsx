import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { getAutomation, updateAutomation } from "@/functions/automations.functions";
import { AutomationForm, type AutomationFormValues } from "@/components/automation-form";

export const Route = createFileRoute("/_dashboard/automations_/$id/edit")({
  component: EditAutomationPage,
});

function EditAutomationPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["automation", id],
    queryFn: () => getAutomation({ data: { id } }),
  });

  const updateM = useMutation({
    mutationFn: (input: Parameters<typeof updateAutomation>[0]["data"]) =>
      updateAutomation({ data: input }),
    onSuccess: () => {
      toast.success("Automação atualizada!");
      qc.invalidateQueries({ queryKey: ["automations"] });
      navigate({ to: "/automations" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <p className="text-sm text-destructive">{error?.message || "Automação não encontrada"}</p>
      </div>
    );
  }

  const a = data.automation;
  const initialValues: AutomationFormValues = {
    name: a.name,
    instagram_post_id: a.instagram_post_id,
    instagram_post_type: a.instagram_post_type === "story" ? "story" : "post",
    custom_message: a.custom_message || "",
    followup_message: a.followup_message || "",
    quick_replies: Array.isArray(a.quick_replies)
      ? (a.quick_replies as { title: string; payload: string }[])
      : [],
    buttons: Array.isArray(a.buttons)
      ? (a.buttons as { type: string; title: string; payload: string }[])
      : [],
    is_active: a.is_active,
    keyword_filter_enabled: a.keyword_filter_enabled,
    keywords: (a.keywords ?? []).join(", "),
    delay_min_seconds: a.delay_min_seconds,
    delay_max_seconds: a.delay_max_seconds,
    trigger_on_dm: (a as { trigger_on_dm?: boolean }).trigger_on_dm ?? false,
    require_follow: (a as { require_follow?: boolean }).require_follow ?? false,
    follower_gate_message:
      (a as { follower_gate_message?: string | null }).follower_gate_message ?? "",
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Editar Automação</h1>
        <p className="text-sm text-muted-foreground">
          Atualize a configuração da resposta automática.
        </p>
      </div>
      <AutomationForm
        initialValues={initialValues}
        submitLabel="Salvar alterações"
        submitting={updateM.isPending}
        onSubmit={(input) => updateM.mutate({ ...input, id })}
      />
    </div>
  );
}
