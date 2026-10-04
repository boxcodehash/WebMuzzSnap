type Props = {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
};

export function StatusScreen({ title, body, action, onAction }: Props) {
  return (
    <main className="gate">
      <section className="gate-card">
        <p className="eyebrow">MuzzChat</p>
        <h1>{title}</h1>
        <p className="lede">{body}</p>
        {action && onAction ? (
          <button type="button" className="primary" onClick={onAction}>
            {action}
          </button>
        ) : null}
      </section>
    </main>
  );
}
