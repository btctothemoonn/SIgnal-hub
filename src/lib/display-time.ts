function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatDisplayTime(isoString: string, now = new Date()) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  const dayDiff = Math.floor(
    (startOfLocalDay(now) - startOfLocalDay(date)) / 86_400_000,
  );

  if (dayDiff === 0) {
    return `今天 ${time}`;
  }

  if (dayDiff === 1) {
    return `昨天 ${time}`;
  }

  return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${time}`;
}
