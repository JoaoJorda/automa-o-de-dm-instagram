import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Mail, Lock, User, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, loading: authLoading } = useAuth();
  const [isActive, setIsActive] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authLoading && session) navigate({ to: "/dashboard" });
  }, [authLoading, session, navigate]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(
        error.message === "Invalid login credentials" ? "Email ou senha incorretos" : error.message,
      );
      return;
    }
    navigate({ to: "/dashboard" });
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/dashboard`,
        data: { name },
      },
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    if (!data.session) {
      toast.success("Conta criada! Confira seu email para confirmar o cadastro.", {
        duration: 8000,
      });
      setIsActive(false);
      return;
    }
    toast.success("Conta criada! Entrando…");
    navigate({ to: "/dashboard" });
  }

  const inputClass =
    "w-full rounded-lg border border-input bg-muted/50 px-4 py-3 pr-12 text-sm placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <style>{`
        .ac { position: relative; width: min(850px, 100%); height: 550px; border-radius: 24px; overflow: hidden; }
        .ac .fb { position: absolute; right: 0; width: 50%; height: 100%; display: flex; align-items: center; text-align: center; padding: 40px; z-index: 1; transition: .6s ease-in-out 1.2s, visibility 0s 1s; }
        .ac.on .fb { right: 50%; }
        .ac .fb.reg { visibility: hidden; }
        .ac.on .fb.reg { visibility: visible; }
        .ac .tb { position: absolute; width: 100%; height: 100%; }
        .ac .tb::before { content: ''; position: absolute; left: -250%; width: 300%; height: 100%; background: var(--primary); border-radius: 150px; z-index: 2; transition: 1.8s ease-in-out; }
        .ac.on .tb::before { left: 50%; }
        .ac .tp { position: absolute; width: 50%; height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; z-index: 2; transition: .6s ease-in-out; }
        .ac .tp.tl { left: 0; transition-delay: 1.2s; }
        .ac.on .tp.tl { left: -50%; transition-delay: .6s; }
        .ac .tp.tr { right: -50%; transition-delay: .6s; }
        .ac.on .tp.tr { right: 0; transition-delay: 1.2s; }
        @media (max-width: 650px) {
          .ac { height: calc(100vh - 40px); width: calc(100% - 32px); }
          .ac .fb { bottom: 0; width: 100%; height: 70%; padding: 24px; }
          .ac.on .fb { right: 0; bottom: 30%; }
          .ac .tb::before { left: 0; top: -270%; width: 100%; height: 300%; border-radius: 20vw; }
          .ac.on .tb::before { left: 0; top: 70%; }
          .ac .tp { width: 100%; height: 30%; }
          .ac .tp.tl { top: 0; }
          .ac.on .tp.tl { left: 0; top: -30%; }
          .ac .tp.tr { right: 0; bottom: -30%; }
          .ac.on .tp.tr { bottom: 0; }
        }
      `}</style>

      <div className={`ac border border-border bg-card shadow-2xl ${isActive ? "on" : ""}`}>
        <div className="fb login bg-card">
          <div className="w-full">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Login</h1>
            <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
              <div className="relative">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClass}
                />
                <Mail className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <div className="relative">
                <input
                  type="password"
                  placeholder="Senha"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className={inputClass}
                />
                <Lock className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {loading && !isActive ? "Entrando..." : "Entrar"}
              </button>
            </form>
          </div>
        </div>

        <div className="fb reg bg-card">
          <div className="w-full">
            <h1 className="text-3xl font-bold tracking-tight text-foreground">Criar Conta</h1>
            <form onSubmit={handleSignUp} className="mt-6 flex flex-col gap-4">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Nome"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
                <User className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <div className="relative">
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className={inputClass}
                />
                <Mail className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <div className="relative">
                <input
                  type="password"
                  placeholder="Senha (min 6)"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className={inputClass}
                />
                <Lock className="absolute right-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-lg bg-primary py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-all"
              >
                {loading && isActive ? "Criando..." : "Criar Conta"}
              </button>
            </form>
          </div>
        </div>

        <div className="tb">
          <div className="tp tl text-primary-foreground px-8">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="size-6" />
              <span className="text-2xl font-bold">InstaDesbloqMe</span>
            </div>
            <p className="text-sm opacity-90 mb-5">Ainda não tem conta?</p>
            <button
              onClick={() => setIsActive(true)}
              className="rounded-lg border-2 border-primary-foreground bg-transparent px-8 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-foreground/10 transition-all"
            >
              Criar Conta
            </button>
          </div>
          <div className="tp tr text-primary-foreground px-8">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="size-6" />
              <span className="text-2xl font-bold">InstaDesbloqMe</span>
            </div>
            <p className="text-sm opacity-90 mb-5">Já tem uma conta?</p>
            <button
              onClick={() => setIsActive(false)}
              className="rounded-lg border-2 border-primary-foreground bg-transparent px-8 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-foreground/10 transition-all"
            >
              Entrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
