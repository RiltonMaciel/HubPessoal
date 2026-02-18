export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {subtitle && <div style={{ marginTop: 6 }}>{subtitle}</div>}
    </div>
  );
}
