import { useEffect, useMemo, useState, type FormEvent } from "react";
import { isWallet, normalizeWallet } from "../../shared/constants";
import { randomId } from "../../shared/envelope";
import { api } from "../lib/api";
import { usingEmulators } from "../lib/firebase";
import { loadOrCreateIdentity } from "../lib/idb";
import type { LocalMessage, LocalThread } from "../lib/idb";
import { loadChat, markThreadRead, purgeLocal, replenish, sendText, syncInbox } from "../lib/protocol";
import { formatWhen, humanError, shortWallet } from "../lib/text";

type Props = {
  wallet: string;
  onSignOut: () => Promise<void>;
};

type DraftThread = { threadId: string; peer: string };

export function ChatScreen({ wallet, onSignOut }: Props) {
  const [threads, setThreads] = useState<LocalThread[]>([]);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [draftThread, setDraftThread] = useState<DraftThread | null>(null);
  const [pane, setPane] = useState<"list" | "thread">("list");
  const [peerInput, setPeerInput] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [prekeys, setPrekeys] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  async function reload() {
    const next = await loadChat();
    setThreads(next.threads);
    setMessages(next.messages);
  }

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        await syncInbox(wallet);
        await purgeLocal();
        if (!stop) await reload();
        const status = await api.prekeyStatus();
        if (!stop) setPrekeys(status.available);
      } catch (err) {
        if (!stop) setError(humanError(err));
      }
    };
    void tick();
    const syncTimer = window.setInterval(() => void tick(), 5000);
    return () => {
      stop = true;
      window.clearInterval(syncTimer);
    };
  }, [wallet]);

  const visibleThreads = useMemo(() => {
    const list = [...threads];
    if (draftThread && !list.some((thread) => thread.threadId === draftThread.threadId)) {
      list.unshift({ threadId: draftThread.threadId, peer: draftThread.peer, updatedAt: Date.now() });
    }
    return list;
  }, [threads, draftThread]);

  const activePeer = visibleThreads.find((thread) => thread.threadId === active)?.peer ?? null;
  const activeMessages = messages
    .filter((message) => message.threadId === active)
    .sort((a, b) => a.createdAt - b.createdAt);
  const unreadKey = activeMessages
    .filter((message) => message.receiverWallet === wallet && message.readAt == null && message.kind === "ok" && !message.pending)
    .map((message) => message.messageId)
    .join(",");

  useEffect(() => {
    if (!active || !unreadKey) return;
    let cancelled = false;
    void markThreadRead(active, wallet)
      .then(async () => {
        if (!cancelled) await reload();
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(humanError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [active, unreadKey, wallet]);

  function openThread(threadId: string) {
    setActive(threadId);
    setPane("thread");
    setError(null);
  }

  function createThread(event: FormEvent) {
    event.preventDefault();
    const peer = normalizeWallet(peerInput);
    if (!isWallet(peer)) {
      setError("Escribe una dirección Ethereum válida.");
      return;
    }
    if (peer === wallet) {
      setError("No puedes abrir un hilo contigo.");
      return;
    }
    const existing = threads.find((thread) => thread.peer === peer);
    if (existing) {
      openThread(existing.threadId);
      setDraftThread(null);
    } else {
      const threadId = randomId();
      setDraftThread({ threadId, peer });
      openThread(threadId);
    }
    setPeerInput("");
    setShowNew(false);
  }

  async function onSend(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || !active || !activePeer || sending) return;
    if (body.length > 4000) {
      setError("El mensaje pasa de 4000 caracteres.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const identity = await loadOrCreateIdentity(wallet);
      await sendText({ identity, senderWallet: wallet, peer: activePeer, threadId: active, text: body });
      setText("");
      setDraftThread(null);
      await reload();
    } catch (err) {
      setError(humanError(err));
    } finally {
      setSending(false);
    }
  }

  async function topUp() {
    setError(null);
    try {
      const identity = await loadOrCreateIdentity(wallet);
      await replenish(identity, 20);
      const status = await api.prekeyStatus();
      setPrekeys(status.available);
    } catch (err) {
      setError(humanError(err));
    }
  }

  return (
    <div className="shell" data-pane={pane}>
      <aside className="sidebar">
        <header className="side-head">
          <div>
            <p className="brand">MuzzChat</p>
            <p className="muted" title={wallet}>{shortWallet(wallet)}</p>
          </div>
          <button type="button" className="primary small" onClick={() => setShowNew((value) => !value)}>
            Nueva
          </button>
        </header>
        {usingEmulators ? <p className="pill slim">Emulador local</p> : null}
        {showNew ? (
          <form className="new-chat" onSubmit={createThread}>
            <label htmlFor="peer">Wallet del destinatario</label>
            <input
              id="peer"
              value={peerInput}
              onChange={(event) => setPeerInput(event.target.value)}
              placeholder="0x…"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="primary">
              Abrir hilo
            </button>
          </form>
        ) : null}
        <ul className="thread-list">
          {visibleThreads.length === 0 ? <li className="muted empty">Sin conversaciones. El listado no muestra el texto.</li> : null}
          {visibleThreads.map((thread) => (
            <li key={thread.threadId}>
              <button
                type="button"
                className={thread.threadId === active ? "thread-button active" : "thread-button"}
                onClick={() => openThread(thread.threadId)}
              >
                <strong title={thread.peer}>{shortWallet(thread.peer)}</strong>
                <span>Cifrado</span>
                <time dateTime={new Date(thread.updatedAt).toISOString()}>{formatWhen(thread.updatedAt)}</time>
              </button>
            </li>
          ))}
        </ul>
        <footer className="side-foot">
          <p>Claves de un solo uso: {prekeys == null ? "…" : prekeys}</p>
          <button type="button" className="text-button" onClick={() => void topUp()}>
            Reponer claves
          </button>
          <button type="button" className="text-button" onClick={() => void onSignOut()}>
            Cerrar sesión
          </button>
        </footer>
      </aside>
      <section className="thread" aria-label="Conversación">
        {active && activePeer ? (
          <>
            <header className="thread-head">
              <button type="button" className="text-button back" onClick={() => setPane("list")}>
                Chats
              </button>
              <div>
                <h2 title={activePeer}>{shortWallet(activePeer)}</h2>
                <p>Hilo aleatorio. Sin vista previa del texto.</p>
              </div>
            </header>
            <div className="log">
              {activeMessages.length === 0 ? (
                <p className="muted empty-log">Todavía no hay mensajes. El texto solo se descifra en los dispositivos.</p>
              ) : null}
              {activeMessages.map((message) => (
                <article key={message.messageId} className={message.senderWallet === wallet ? "bubble mine" : "bubble"}>
                  <p>
                    {message.kind === "failed"
                      ? "No se pudo descifrar este mensaje."
                      : message.kind === "other-session"
                        ? "Enviado desde otra sesión. Aquí no está la clave efímera."
                        : message.plaintext}
                  </p>
                  <time dateTime={new Date(message.createdAt).toISOString()}>
                    {formatWhen(message.createdAt)}
                    {message.pending ? " · enviando" : ""}
                    {message.readAt ? " · leído" : ""}
                  </time>
                </article>
              ))}
            </div>
            <form className="composer" onSubmit={(event) => void onSend(event)}>
              <label className="sr" htmlFor="message">Mensaje</label>
              <textarea
                id="message"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Escribe un mensaje cifrado"
                rows={2}
                maxLength={4000}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <button type="submit" className="primary" disabled={sending || text.trim().length === 0}>
                Enviar
              </button>
            </form>
          </>
        ) : (
          <div className="thread-placeholder">
            <h2>Elige un hilo</h2>
            <p>Los leídos se borran a las 24 horas. Los no leídos, a los 7 días.</p>
          </div>
        )}
        {error ? <p className="error dock" role="alert">{error}</p> : null}
      </section>
    </div>
  );
}
