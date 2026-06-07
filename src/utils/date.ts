/**
 * Date utilities for formatting
 */

const MONTHS_RU: readonly string[] = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/**
 * Format date string to Russian format
 * @param dateString - Date string in ISO format (e.g., "2025-06-15T20:15:33.384604" or "2025-06-15T14:00:00")
 * @returns Formatted date (e.g., "15 июня 2025") or empty string on invalid input
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) {
    return "";
  }

  try {
    const normalizedDateString = String(dateString).trim();
    const dateMatch = normalizedDateString.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (!dateMatch) {
      return "";
    }

    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const maxDayInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

    if (month < 1 || month > 12 || day < 1 || day > maxDayInMonth) {
      return "";
    }

    return `${day} ${MONTHS_RU[month - 1]} ${year}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to format date ${dateString}: ${message}`);
    return "";
  }
}
