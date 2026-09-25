import { Component, type ReactNode } from "react";
import { useSession } from "./lib/session";
import { BindScreen } from "./screens/BindScreen";
import { ChatScreen } from "./screens/ChatScreen";
import { LoginScreen } from "./screens/LoginScreen";
import { StatusScreen } from "./screens/StatusScreen";

function Shell() {
  const session = useSession();
  if (session.status === "loading") {
    return <StatusScreen title="MuzzChat" body="Abriendo la sesión cifrada…" />;
  }
  if (session.status === "signed-out") {
    return <LoginScreen busy={session.busy} error={session.error} onConnect={session.signIn} />;
  }
  if (session.status === "revoked" || !session.wallet) {
    return (
      <StatusScreen
        title="Sin acceso"
        body="Esta wallet no mantiene el mínimo de MUZZ, o la revisión del saldo ya revocó la sesión."
        action="Cerrar sesión"
        onAction={() => void session.signOut()}
      />
    );
  }
  if (session.status === "needs-device") {
    return (
      <BindScreen
        wallet={session.wallet}
        busy={session.busy}
        error={session.error}
        onBind={session.bind}
        onSignOut={session.signOut}
      />
    );
  }
  return <ChatScreen wallet={session.wallet} onSignOut={session.signOut} />;
}

class AppBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }

  render() {
    if (this.state.error) return <StatusScreen title="No se puede abrir" body={this.state.error} />;
    return this.props.children;
  }
}

export function App() {
  return (
    <AppBoundary>
      <Shell />
    </AppBoundary>
  );
}
