import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  parseJsonbEdges,
  parseJsonbNodes,
  validateFlow,
  type FlowEdge,
  type FlowNode,
} from "@/lib/flow-model";
import { compileTree, parseTree } from "@/lib/flow-tree";

export interface FlowInput {
  id?: string;
  name: string;
  trigger_type: "comment" | "dm";
  instagram_post_id?: string;
  instagram_post_type?: string;
  keyword_filter_enabled?: boolean;
  keywords?: string[];
  require_follow?: boolean;
  follower_gate_message?: string;
  /** Árvore canônica de edição (formato do builder). */
  tree?: unknown;
  /** Grafo COMPILADO que o motor executa — derivado da tree no save. */
  nodes?: FlowNode[];
  edges?: FlowEdge[];
  is_active?: boolean;
}

function validate(input: FlowInput): FlowInput {
  if (!input.name?.trim() || input.name.length > 200) throw new Error("Nome inválido");
  if (input.trigger_type !== "comment" && input.trigger_type !== "dm") {
    throw new Error("Tipo de gatilho inválido");
  }
  const keywords = (input.keywords ?? []).map((k) => k.trim().toLowerCase()).filter(Boolean);
  if (input.trigger_type === "dm" && keywords.length === 0 && input.is_active) {
    throw new Error("Gatilho de DM precisa de pelo menos 1 palavra-chave.");
  }
  if (input.keyword_filter_enabled && keywords.length === 0 && input.is_active) {
    throw new Error("Informe ao menos uma palavra-chave ou desative o filtro.");
  }
  // A árvore é a fonte canônica. Compilar novamente no servidor impede que um
  // client desatualizado (ou uma chamada manual) salve grafo diferente do que o
  // builder exibe. O fallback nodes/edges mantém compatibilidade com rows/API
  // anteriores à introdução da árvore.
  const tree = input.tree == null ? undefined : parseTree(input.tree);
  const compiled = tree ? compileTree(tree) : null;
  return {
    ...input,
    name: input.name.trim(),
    instagram_post_id: input.instagram_post_id?.trim() || "*",
    instagram_post_type: input.instagram_post_type || "post",
    keywords,
    require_follow: !!input.require_follow,
    follower_gate_message: (input.follower_gate_message ?? "").trim().slice(0, 500),
    tree,
    nodes: compiled?.nodes ?? parseJsonbNodes(input.nodes ?? []),
    edges: compiled?.edges ?? parseJsonbEdges(input.edges ?? []),
  };
}

/** Ativar exige grafo válido — as regras vêm das restrições da plataforma. */
function assertActivatable(nodes: FlowNode[], edges: FlowEdge[], triggerType: string): void {
  const issues = validateFlow(nodes, edges, triggerType);
  if (issues.length > 0) {
    throw new Error(`Flow inválido pra ativar: ${issues.map((i) => i.message).join(" | ")}`);
  }
}

export const listFlows = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("flows")
      .select(
        "id,name,is_active,trigger_type,instagram_post_id,keywords,total_sent,total_failed,total_clicks,updated_at,created_at",
      )
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { flows: data ?? [] };
  });

export const getFlow = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("flows")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Flow não encontrado");
    return { flow: row };
  });

export const createFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FlowInput) => validate(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (data.is_active) {
      assertActivatable(data.nodes ?? [], data.edges ?? [], data.trigger_type);
    }
    const { data: row, error } = await supabase
      .from("flows")
      .insert({
        user_id: userId,
        name: data.name,
        trigger_type: data.trigger_type,
        instagram_post_id: data.instagram_post_id,
        instagram_post_type: data.instagram_post_type,
        keyword_filter_enabled: !!data.keyword_filter_enabled,
        keywords: data.keywords ?? [],
        require_follow: data.require_follow ?? false,
        follower_gate_message: data.follower_gate_message || null,
        tree: (data.tree ?? null) as never,
        nodes: (data.nodes ?? []) as never,
        edges: (data.edges ?? []) as never,
        is_active: !!data.is_active,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { flow: row };
  });

export const updateFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: FlowInput & { id: string }) => ({ ...validate(input), id: input.id }))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.is_active) {
      assertActivatable(data.nodes ?? [], data.edges ?? [], data.trigger_type);
    }
    const { data: row, error } = await supabase
      .from("flows")
      .update({
        name: data.name,
        trigger_type: data.trigger_type,
        instagram_post_id: data.instagram_post_id,
        instagram_post_type: data.instagram_post_type,
        keyword_filter_enabled: !!data.keyword_filter_enabled,
        keywords: data.keywords ?? [],
        require_follow: data.require_follow ?? false,
        follower_gate_message: data.follower_gate_message || null,
        tree: (data.tree ?? null) as never,
        nodes: (data.nodes ?? []) as never,
        edges: (data.edges ?? []) as never,
        is_active: !!data.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    // Save que deixa o flow INATIVO encerra as esperas (sessão de flow
    // inativo é morta por definição; a posse foi provada pelo update RLS).
    // Com o flow ativo, sessões seguem: nós removidos se auto-curam no motor
    // e matá-las aqui interromperia esperas vivas a cada save de config.
    if (!row.is_active) {
      const { completeFlowSessions } = await import("@/server/flow-engine.server");
      await completeFlowSessions(data.id);
    }
    return { flow: row };
  });

export const toggleFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; is_active: boolean }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    if (data.is_active) {
      const { data: row, error } = await supabase
        .from("flows")
        .select("tree,nodes,edges,trigger_type,keyword_filter_enabled,keywords,updated_at")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("Flow não encontrado");
      if (row.trigger_type === "dm" && (row.keywords ?? []).length === 0) {
        throw new Error("Gatilho de DM precisa de pelo menos 1 palavra-chave.");
      }
      if (row.keyword_filter_enabled && (row.keywords ?? []).length === 0) {
        throw new Error("Informe ao menos uma palavra-chave ou desative o filtro.");
      }
      // Valida o grafo RECOMPILADO da árvore canônica — grafos salvos antes
      // dos handles estáveis reprovariam as regras novas mesmo funcionando
      // (opções sem id + arestas qr-<uuid>). A recompilação hidrata os ids;
      // sem tree (row antiga da API), cai no grafo armazenado.
      const tree = row.tree == null ? undefined : parseTree(row.tree);
      const compiled = tree ? compileTree(tree) : null;
      const nodes = compiled?.nodes ?? parseJsonbNodes(row.nodes);
      const edges = compiled?.edges ?? parseJsonbEdges(row.edges);
      assertActivatable(nodes, edges, row.trigger_type);
      // CAS no updated_at: se um save concorrente trocou o grafo entre a
      // validação e o update, não ativa às cegas — o usuário tenta de novo.
      // Quando recompilou, persiste o grafo validado (heal) — o que o motor
      // executa passa a ser exatamente o que foi validado.
      const { data: swapped, error: casError } = await supabase
        .from("flows")
        .update(
          compiled
            ? { is_active: true, nodes: nodes as never, edges: edges as never }
            : { is_active: true },
        )
        .eq("id", data.id)
        .eq("updated_at", row.updated_at)
        .select("id");
      if (casError) throw new Error(casError.message);
      if (!swapped || swapped.length === 0) {
        throw new Error("O flow mudou enquanto era ativado — recarregue e tente de novo.");
      }
      return { success: true };
    }
    const { data: paused, error } = await supabase
      .from("flows")
      .update({ is_active: false })
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    // O cleanup abaixo roda com service role — só depois de provar posse via
    // RLS (0 rows = flow de outro usuário ou inexistente; sem isso, qualquer
    // autenticado mataria sessões ativas de outro tenant).
    if (!paused || paused.length === 0) throw new Error("Flow não encontrado");
    // Pausou: encerra as esperas ativas (não podem ressuscitar na reativação).
    const { completeFlowSessions } = await import("@/server/flow-engine.server");
    await completeFlowSessions(data.id);
    return { success: true };
  });

export const deleteFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => input)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: deleted, error } = await supabase
      .from("flows")
      .delete()
      .eq("id", data.id)
      .select("id");
    if (error) throw new Error(error.message);
    if (!deleted || deleted.length === 0) throw new Error("Flow não encontrado");
    return { success: true };
  });
