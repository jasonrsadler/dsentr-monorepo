interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, limit, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);

  return (
    <div className="flex items-center justify-between text-sm text-slate-300">
      <div>
        Page {safePage} of {totalPages} - {total} total
      </div>
      <div className="flex items-center gap-2">
        <button
          className="btn-ghost disabled:opacity-40"
          disabled={safePage <= 1}
          onClick={() => onPageChange(Math.max(1, safePage - 1))}
        >
          Previous
        </button>
        <button
          className="btn-ghost disabled:opacity-40"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, safePage + 1))}
        >
          Next
        </button>
      </div>
    </div>
  );
}
