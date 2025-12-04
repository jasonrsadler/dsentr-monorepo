import { PaginatedResponse } from "./types";

export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<PaginatedResponse<T>>,
  pageSize = 100,
): Promise<T[]> {
  const effectivePageSize = Math.max(1, pageSize);
  const firstPage = await fetchPage(1, effectivePageSize);
  const combined = [...firstPage.data];
  const totalPages = Math.ceil(firstPage.total / effectivePageSize);

  if (totalPages > 1) {
    const remainingPages = await Promise.all(
      Array.from({ length: totalPages - 1 }, (_, idx) =>
        fetchPage(idx + 2, effectivePageSize),
      ),
    );
    remainingPages.forEach((page) => combined.push(...page.data));
  }

  return combined;
}
