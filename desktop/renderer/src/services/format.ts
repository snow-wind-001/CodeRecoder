const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

export function formatDate(timestamp: number | null | undefined): string {
  if (!timestamp) return '暂无记录';
  const now = new Date();
  const value = new Date(timestamp);
  if (value.toDateString() === now.toDateString()) {
    return `今天 ${value.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    })}`;
  }
  return dateFormatter.format(value);
}

export function formatRelative(timestamp: number | null | undefined): string {
  if (!timestamp) return '尚未创建';
  const delta = Date.now() - timestamp;
  if (delta < 45_000) return '刚刚';
  if (delta < 60 * 60_000) return `${Math.max(1, Math.floor(delta / 60_000))} 分钟前`;
  if (delta < 24 * 60 * 60_000) return `${Math.floor(delta / (60 * 60_000))} 小时前`;
  return formatDate(timestamp);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function shortHash(hash: string): string {
  if (hash.length < 12) return hash;
  return `${hash.slice(0, 5)}…${hash.slice(-4)}`;
}

export function triggerLabel(trigger: string): string {
  const labels: Record<string, string> = {
    activation: '激活基线',
    automatic: '自动检查点',
    manual: '手动备份',
    'pre-restore': '恢复前安全备份',
    reconciliation: '周期对账'
  };
  return labels[trigger] ?? trigger;
}
